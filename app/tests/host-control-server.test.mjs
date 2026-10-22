import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { startHostControl } from '../cloud/host-control.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(t, overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'corilo-hcs-'));
  const socketPath = path.join(root, 'control.sock'), token = randomBytes(32).toString('hex'), id = randomUUID();
  const row = { id, owner_id: randomUUID(), vault_id: randomUUID(), conversation_id: randomUUID(), state: 'running' };
  const state = { gate: null, queries: 0, begins: 0 };
  const pool = { async query(sql, args) { state.queries++; assert.deepEqual(args, [id]); return { rows: [row] }; } };
  const host = {
    activeRunId() { return state.gate; },
    async beginRun(runId) { state.begins++; state.gate = runId; },
    async checkpointRun(runId) { assert.equal(state.gate, runId); },
    async releaseRun(runId) { assert.equal(state.gate, runId); state.gate = null; },
  };
  const hosts = { async forRun(claim) {
    assert.deepEqual(claim, { id, ownerId: row.owner_id, vaultId: row.vault_id, conversationId: row.conversation_id });
    return host;
  } };
  Object.assign(pool, overrides.pool); Object.assign(host, overrides.host);
  const server = await startHostControl({ pool, hosts, socketPath, token });
  t.after(async () => { await server.close(); await rm(root, { recursive: true, force: true }); });
  return { root, socketPath, token, id, row, state, host, pool, server };
}
function request(fixture, operation, extra = {}) {
  let connection;
  const response = new Promise((resolve, reject) => {
    connection = http.request({ socketPath: fixture.socketPath, method: 'POST', path: `/runs/${fixture.id}/${operation}`,
      headers: { Authorization: `Bearer ${fixture.token}`, 'Content-Type': 'application/json', Connection: 'close', ...extra.headers } }, incoming => {
      const parts = []; incoming.on('data', part => parts.push(part)); incoming.once('error', reject);
      incoming.once('end', () => resolve({ status: incoming.statusCode, text: Buffer.concat(parts).toString() }));
    });
    connection.once('error', reject); connection.end(extra.body ?? '{}');
  });
  return { connection, response };
}

test('host control retains a begun gate and drains disconnected authorized mutation before close', { timeout: 10000 }, async t => {
  const entered = deferred(), finish = deferred();
  t.after(() => finish.resolve());
  const f = await fixture(t);
  f.host.beginRun = async id => { f.state.begins++; entered.resolve(); await finish.promise; f.state.gate = id; };
  const call = request(f, 'begin');
  const disconnected = call.response.then(() => false, () => true);
  await entered.promise;
  call.connection.destroy(new Error('Synthetic lost acknowledgement'));
  assert.equal(await disconnected, true);
  let closed = false;
  const closing = f.server.close().then(() => { closed = true; });
  await pause(30); assert.equal(closed, false, 'HTTP disconnect must not cancel or outlive host mutation');
  finish.resolve(); await closing;
  assert.equal(f.state.gate, f.id); assert.equal(f.state.begins, 1);
  await assert.rejects(lstat(f.socketPath), error => error.code === 'ENOENT');
});

test('host control serializes duplicate begin and checks durable state after queue waiting', { timeout: 10000 }, async t => {
  const entered = deferred(), finish = deferred();
  t.after(() => finish.resolve());
  const f = await fixture(t);
  f.host.beginRun = async id => { f.state.begins++; entered.resolve(); await finish.promise; f.state.gate = id; };
  const first = request(f, 'begin'); await entered.promise;
  const duplicate = request(f, 'begin');
  await pause(50);
  assert.equal(f.state.queries, 1, 'queued authorization cannot cache the earlier running state');
  f.row.state = 'completed'; finish.resolve();
  assert.equal((await first.response).status, 200);
  assert.equal((await duplicate.response).status, 409);
  assert.equal(f.state.begins, 1);
  assert.equal((await request(f, 'release').response).status, 200);
  assert.equal(f.state.gate, null);
  assert.equal((await request(f, 'begin').response).status, 409, 'terminal replay cannot reopen a gate');
  // An old terminal run must never clear a different run's gate in its vault.
  f.state.gate = randomUUID();
  assert.equal((await request(f, 'release').response).status, 409);
  assert.notEqual(f.state.gate, null);
});

test('host control refuses existing socket path without modifying it and hides raw diagnostics', async t => {
  const f = await fixture(t);
  const existing = path.join(f.root, 'existing.sock'); await writeFile(existing, 'preserve existing file');
  await assert.rejects(startHostControl({ pool: f.pool, hosts: { forRun() {} }, socketPath: existing, token: f.token }), /already exists/);
  assert.equal(await readFile(existing, 'utf8'), 'preserve existing file');
  f.pool.query = async () => { throw new Error('PRIVATE_DATABASE_PASSWORD_AND_PATH'); };
  const result = await request(f, 'status').response;
  assert.equal(result.status, 503);
  assert.deepEqual(JSON.parse(result.text), { error: 'Host control unavailable' });
  assert.ok(!result.text.includes('PRIVATE'));
});
