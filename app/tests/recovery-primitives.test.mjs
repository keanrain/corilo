import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { RunRecovery, Runs } from '../cloud/runs.mjs';
import { DockerWorkerRecovery, DockerWorkers } from '../cloud/docker-workers.mjs';
import { RunModelRecovery, RunModelOutlet } from '../cloud/run-model-outlet.mjs';

const temp = async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corilo-recovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
};

test('recovery capabilities do not expose submission, claiming, worker start or model preparation', async t => {
  const root = await temp(t);
  const runs = new RunRecovery({});
  for (const name of ['conversation','submit','claim','heartbeat','finish']) assert.equal(runs[name], undefined);
  assert.equal(typeof runs.reconcile, 'function');
  assert.equal(typeof runs.recoveryCandidates, 'function');
  const workers = new DockerWorkerRecovery({ journalRoot: root });
  assert.equal(workers.start, undefined);
  assert.equal(workers.directory, undefined);
  const model = new RunModelRecovery({ grants: { revokeRun: async () => {} }, socketRoot: root });
  await assert.rejects(model.prepare({ id: randomUUID() }), /disabled in recovery/);
  assert.equal(model.limits, undefined); assert.equal(model.relayOptions, undefined);
  // Execution types still require real execution configuration.
  assert.throws(() => new Runs({}), /Invalid maxRunning/);
  assert.throws(() => new DockerWorkers({ journalRoot: root }), /Immutable worker image/);
  assert.throws(() => new RunModelOutlet({ grants: model.grants, socketRoot: root }), /Explicit per-run/);
});

test('recovery-only worker confirms known deletion and retains unknown create outcomes', async t => {
  const root = await temp(t), known = randomUUID(), unknown = randomUUID();
  let exists = true;
  const requests = [];
  const engine = { async request(method, route) {
    requests.push({ method, route });
    if (method === 'DELETE') { exists = false; return null; }
    assert.equal(method, 'GET', 'recovery must never create or start containers');
    if (!exists || route.includes('corilo-run-')) throw Object.assign(new Error('not found'), { status:404 });
    return { Id:'known-container', Config:{Labels:{'corilo.run':known,'corilo.controller':root}} };
  } };
  const workers = new DockerWorkerRecovery({ engine, journalRoot:root });
  for (const id of [known, unknown]) await fs.mkdir(path.join(root,id));
  await workers.save(known,{runId:known,controller:root,name:'corilo-run-'+known,containerId:'known-container',phase:'running'});
  await workers.save(unknown,{runId:unknown,controller:root,name:'corilo-run-'+unknown,phase:'creating'});
  assert.equal(await workers.stop(unknown),false);
  assert.equal((await workers.journal(unknown)).phase,'creating');
  assert.equal(await workers.stop(known),true);
  assert.equal((await workers.journal(known)).phase,'removed');
  assert.equal(requests.filter(r=>r.method==='DELETE').length,1);
  assert.ok(requests.every(r=>['GET','DELETE'].includes(r.method)));
  assert.equal(await workers.stop(known),true,'acknowledged removal can be recovered again');
});

test('recovery cannot infer termination from a missing journal in a fresh control root', async t => {
  const root=await temp(t), id=randomUUID();let requests=0;
  const workers=new DockerWorkerRecovery({journalRoot:root,engine:{async request(){requests++;throw new Error('unexpected transport');}}});
  await assert.rejects(workers.stop(id),/journal missing; termination unconfirmed/);
  assert.deepEqual(await fs.readdir(root),[],'recovery must not fabricate a removed journal');
  assert.equal(requests,0,'an absent Docker inspect would not exclude a delayed create');
});

test('copied or mismatched recovery journals cannot bypass the controller root ownership', async t => {
  const root=await temp(t), id=randomUUID();let requests=0;
  await fs.mkdir(path.join(root,id));
  const workers=new DockerWorkerRecovery({journalRoot:root,engine:{async request(){requests++;throw new Error('unexpected transport');}}});
  const expected={runId:id,controller:root,name:'corilo-run-'+id,phase:'running',containerId:'known-container'};
  for (const change of [{controller:root+'-old'}, {runId:randomUUID()}, {name:'corilo-run-'+randomUUID()}, {phase:'unknown'}]) {
    await workers.save(id,{...expected,...change});
    await assert.rejects(workers.stop(id),/journal ownership mismatch/);
  }
  assert.equal(requests,0);
});

test('model recovery revokes without provider credentials and removes only scoped known socket', async t => {
  const root = await temp(t), id = randomUUID(), directory = path.join(root,id);
  await fs.mkdir(directory,{mode:0o700});
  const socketPath=path.join(directory,'m.sock');
  const server=net.createServer(socket=>socket.destroy());
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});
  await fs.chmod(socketPath,0o600);
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const revoked=[];
  const model=new RunModelRecovery({socketRoot:root,grants:{revokeRun:async runId=>revoked.push(runId)}});
  await model.revoke(id);
  assert.deepEqual(revoked,[id]);
  await assert.rejects(fs.lstat(directory),e=>e.code==='ENOENT');
  await model.revoke(id);await model.close();
  const unknown=randomUUID(), unknownDirectory=path.join(root,unknown);
  await fs.mkdir(unknownDirectory,{mode:0o700});await fs.writeFile(path.join(unknownDirectory,'keep.txt'),'operator evidence');
  const other=new RunModelRecovery({socketRoot:root,grants:{revokeRun:async()=>{}}});
  await assert.rejects(other.revoke(unknown),e=>e.code==='ENOTEMPTY');
  assert.equal(await fs.readFile(path.join(unknownDirectory,'keep.txt'),'utf8'),'operator evidence');
});
