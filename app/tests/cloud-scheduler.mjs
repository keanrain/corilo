import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { ExecutionController } from '../cloud/execution-controller.mjs';
import { randomUUID } from 'node:crypto';
import { Accounts } from '../cloud/accounts.mjs';
import { Runs } from '../cloud/runs.mjs';
import { startScheduler } from '../cloud/scheduler.mjs';
if (!process.env.CORILO_TEST_DATABASE_URL) throw new Error('CORILO_TEST_DATABASE_URL must point to a disposable PostgreSQL database');
const waitFor = async predicate => {
  const until = Date.now() + 5000;
  while (!await predicate()) {
    if (Date.now() > until) throw new Error('Scheduler condition timed out');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

test('scheduler admission, recovery backoff and shutdown use persistent runs without replay', async t => {
  const accounts = new Accounts(process.env.CORILO_TEST_DATABASE_URL);
  await accounts.migrate(); t.after(() => accounts.close());
  const runs = new Runs(accounts.pool, { maxRunning: 2, maxQueued: 5, leaseSeconds: 10, maxRunSeconds: 60 });
  const owners = [], tasks = [];
  for (let i = 0; i < 3; i++) {
    const email = randomUUID()+'@example.test';
    const session = await accounts.login({ subject: randomUUID(), email }, await accounts.invite(email));
    const owner = (await accounts.session(session)).id; owners.push(owner);
    const conversationId = await runs.conversation(owner);
    tasks.push(await runs.submit(owner, { conversationId, key: 'one', prompt: 'Synthetic scheduler fixture' }));
  }
  const events = [], claims = [], errors = [];
  let active = 0, maximum = 0, recoveries = 0, closed = false, init = 0, failRecovery = true;
  const pending = new Set();
  const controller = {
    async init() { init++; events.push('init'); },
    async recover() {
      assert.equal(active, 0); recoveries++; events.push('recover');
      if (failRecovery) throw new Error('PRIVATE_DATABASE_DETAIL');
      for (const candidate of await runs.recoveryCandidates()) await runs.reconcile(candidate.id, async () => true);
    },
    async executeNext() {
      assert.equal(closed, false); events.push('execute');
      const claim = await runs.claim(); if (!claim) return null;
      claims.push(claim.id); active++; maximum = Math.max(active, maximum);
      try {
        await new Promise(resolve => pending.add(resolve));
        return await runs.finish(claim.id, claim.token, closed ? 'stopped' : 'completed');
      } finally { active--; }
    },
    async close() { closed = true; for (const resolve of pending) resolve(); },
  };
  const scheduler = await startScheduler({ controller, concurrency: 2, pollMs: 20, retryMs: 100, onError: value => errors.push(value) });
  t.after(() => scheduler.close());
  await waitFor(() => errors.length === 1);
  assert.equal(claims.length, 0, 'failed recovery forbids admission');
  await new Promise(resolve => setTimeout(resolve, 40)); assert.equal(recoveries, 1, 'retry is bounded');
  failRecovery = false;
  await waitFor(() => active === 2);
  assert.equal(init, 1); assert.equal(maximum, 2); assert.deepEqual(events.slice(0, 2), ['init', 'recover']);
  const close1 = scheduler.close(), close2 = scheduler.close(); assert.equal(close1, close2);
  await close1;
  assert.equal(scheduler.status().phase, 'closed'); assert.equal(active, 0);
  assert.equal(claims.length, 2); assert.equal(new Set(claims).size, 2);
  assert.deepEqual(errors, [{ code: 'recovery_failed' }]);
  assert.equal((await runs.get(owners[2], tasks[2].id)).state, 'queued', 'shutdown must not claim queued remainder');
  await runs.stop(owners[2], tasks[2].id);
});

test('scheduler retains failed execution until fenced recovery and reports shutdown failure safely', async t => {
  const accounts = new Accounts(process.env.CORILO_TEST_DATABASE_URL);
  await accounts.migrate(); t.after(() => accounts.close());
  const runs = new Runs(accounts.pool, { maxRunning: 1, maxQueued: 2, leaseSeconds: 10, maxRunSeconds: 60 });
  const email = randomUUID()+'@example.test';
  const session = await accounts.login({ subject: randomUUID(), email }, await accounts.invite(email));
  const owner = (await accounts.session(session)).id;
  const conversationId = await runs.conversation(owner);
  const run = await runs.submit(owner, { conversationId, key: 'one', prompt: 'Do not replay' });
  let claims = 0, recovered = false, closing = false;
  const errors = [];
  const controller = {
    async init() {},
    async recover() {
      for (const candidate of await runs.recoveryCandidates()) {
        await runs.reconcile(candidate.id, async () => true); recovered = true;
      }
    },
    async executeNext() {
      assert.equal(closing, false);
      const claim = await runs.claim(); if (!claim) return null;
      claims++;
      await accounts.pool.query("UPDATE corilo_private.runs SET lease_until=now()-interval '1 second' WHERE id=$1", [claim.id]);
      throw new Error('PRIVATE_DOCKER_DETAIL');
    },
    async close() { closing = true; throw new Error('PRIVATE_SHUTDOWN_DETAIL'); },
  };
  const scheduler = await startScheduler({ controller, concurrency: 1, pollMs: 20, retryMs: 100, onError: value => errors.push(value) });
  t.after(() => scheduler.close().catch(() => {}));
  await waitFor(() => errors.some(error => error.code === 'execution_failed'));
  assert.equal((await runs.get(owner, run.id)).state, 'running', 'failure alone does not release the slot');
  await waitFor(() => recovered);
  assert.equal((await runs.get(owner, run.id)).state, 'interrupted'); assert.equal(claims, 1);
  await assert.rejects(scheduler.close(), error => error.message === 'Scheduler shutdown unconfirmed');
  assert.equal(scheduler.status().phase, 'failed');
  assert.deepEqual(errors, [{ code: 'execution_failed' }, { code: 'shutdown_failed' }]);
});

test('shutdown keeps controller ownership until in-flight recovery finishes', async () => {
  let finishRecovery, entered = false, closed = false, executions = 0;
  const controller = {
    async init() {},
    async recover() { entered = true; await new Promise(resolve => { finishRecovery = resolve; }); assert.equal(closed, false); },
    async executeNext() { executions++; },
    async close() { closed = true; },
  };
  const scheduler = await startScheduler({ controller, pollMs: 20, retryMs: 100 });
  await waitFor(() => entered);
  const closing = scheduler.close();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(closed, false, 'recovery must retain process ownership');
  finishRecovery(); await closing;
  assert.equal(closed, true); assert.equal(executions, 0);
});


test('controller shutdown exposes unconfirmed worker stop without releasing persistent task state', async t => {
  const accounts = new Accounts(process.env.CORILO_TEST_DATABASE_URL);
  await accounts.migrate();
  const journalRoot = await mkdtemp(tmpdir()+'/corilo-controller-close-');
  t.after(async () => { await accounts.close(); await rm(journalRoot, { recursive: true, force: true }); });
  const runs = new Runs(accounts.pool, { maxRunning: 1, maxQueued: 2, leaseSeconds: 10, maxRunSeconds: 60 });
  const email = randomUUID()+'@example.test';
  const session = await accounts.login({ subject: randomUUID(), email }, await accounts.invite(email));
  const owner = (await accounts.session(session)).id;
  const conversationId = await runs.conversation(owner);
  const run = await runs.submit(owner, { conversationId, key: 'close', prompt: 'Synthetic close fixture' });
  let started = false, gate = false;
  const controller = new ExecutionController({ runs, pollMs: 20,
    workers: { journalRoot, async start() { started = true; }, async status() { return { running: true }; },
      async stop() { throw new Error('PRIVATE_STOP_DIAGNOSTIC'); } },
    hostFor: async () => ({ async beginRun() { gate = true; }, async checkpointRun() {}, async releaseRun() { gate = false; } }),
  });
  await controller.init();
  const execution = controller.executeNext().then(() => false, () => true);
  await waitFor(() => started);
  await assert.rejects(controller.close(), error => error.message === 'Controller shutdown unconfirmed; recovery required');
  assert.equal(await execution, true); assert.equal(gate, true); assert.equal(controller.lock, null);
  assert.equal((await runs.get(owner, run.id)).state, 'running');
  // Synthetic worker only: terminalize fixture explicitly after asserting retention.
  await accounts.pool.query("UPDATE corilo_private.runs SET lease_until=now()-interval '1 second' WHERE id=$1", [run.id]);
  await runs.reconcile(run.id, async () => true);
});

test('scheduler cannot report closed when execution fails during shutdown', async () => {
  let failTask, started = false;
  const errors = [];
  const controller = {
    async init() {}, async recover() {},
    async executeNext() { started = true; await new Promise((resolve, reject) => { failTask = reject; }); },
    async close() { failTask(new Error('PRIVATE_STOP_ERROR')); },
  };
  const scheduler = await startScheduler({ controller, pollMs: 20, retryMs: 100, onError: error => errors.push(error) });
  await waitFor(() => started);
  await assert.rejects(scheduler.close(), /Scheduler shutdown unconfirmed/);
  assert.equal(scheduler.status().phase, 'failed');
  assert.deepEqual(errors, [{ code: 'execution_failed' }, { code: 'shutdown_failed' }]);
});


test('scheduler reports shutdown failure when in-flight recovery fails while closing', async () => {
  let rejectRecovery, entered = false, closed = false;
  const errors = [];
  const controller = {
    async init() {},
    async recover() { entered = true; await new Promise((resolve, reject) => { rejectRecovery = reject; }); },
    async executeNext() { assert.fail('shutdown must not admit work'); },
    async close() { closed = true; },
  };
  const scheduler = await startScheduler({ controller, pollMs: 20, retryMs: 100, onError: error => errors.push(error) });
  await waitFor(() => entered);
  const closing = scheduler.close();
  rejectRecovery(new Error('PRIVATE_RECOVERY_ERROR'));
  await assert.rejects(closing, /Scheduler shutdown unconfirmed/);
  assert.equal(closed, true); assert.equal(scheduler.status().phase, 'failed');
  assert.deepEqual(errors, [{ code: 'recovery_failed' }, { code: 'shutdown_failed' }]);
});

test('recovery-only scheduler never calls execution admission', async () => {
  let recovered=0,closed=false;
  const controller={async init(){},async recover(){recovered++;},async executeNext(){throw new Error('must never claim');},async close(){closed=true;}};
  const errors=[];
  const scheduler=await startScheduler({controller,recoveryOnly:true,pollMs:20,retryMs:100,onError:error=>errors.push(error)});
  await waitFor(()=>recovered>=2);await scheduler.close();
  assert.equal(scheduler.status().recoveryOnly,true);assert.equal(closed,true);assert.deepEqual(errors,[]);
});
