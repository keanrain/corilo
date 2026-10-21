import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Accounts } from '../cloud/accounts.mjs';
import { Runs } from '../cloud/runs.mjs';
import { DockerWorkers, DockerEngine } from '../cloud/docker-workers.mjs';
import { ExecutionController } from '../cloud/execution-controller.mjs';
import { CloudHosts } from '../cloud/hosts.mjs';
import { startScheduler } from '../cloud/scheduler.mjs';
if(!process.env.CORILO_TEST_DATABASE_URL || !process.env.CORILO_TEST_WORKER_IMAGE)throw new Error('Disposable PostgreSQL and immutable worker image required');
const until = async predicate => {
  const deadline=Date.now()+30000;
  while(Date.now()<deadline) { if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,40)); }
  throw new Error('Scheduler fixture timed out');
};

test('scheduler runs real isolated Pi tools and shutdown stops complete worker before releasing file gate', {timeout:90000}, async t=> {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'corilo-scheduled-'));
  const accounts=new Accounts(process.env.CORILO_TEST_DATABASE_URL);await accounts.migrate();
  const runs=new Runs(accounts.pool,{maxRunning:1,maxQueued:4,leaseSeconds:30,maxRunSeconds:120});
  const email=randomUUID()+'@example.test';
  const owner=await accounts.session(await accounts.login({subject:randomUUID(),email},await accounts.invite(email)));
  const conversationId=await runs.conversation(owner.id);
  const registry=new CloudHosts({pool:accounts.pool,dataRoot:path.join(root,'data')});
  const host=await registry.forAccount(owner.id), base=path.join(root,'data',owner.vault_id);
  await fs.writeFile(path.join(base,'knowledge','note.md'),'original');
  await fs.copyFile('app/tests/worker-probe.mjs',path.join(base,'pi','probe.mjs'));
  const engine=new DockerEngine();let starts=0;
  const workers=new DockerWorkers({engine:{request:async(method,route,data)=>{
    if(route.startsWith('/containers/create'))data={...data,Entrypoint:['node','/pi/probe.mjs']};
    if(route.endsWith('/start'))starts++;
    return engine.request(method,route,data);
  }},image:process.env.CORILO_TEST_WORKER_IMAGE,dataRoot:path.join(root,'data'),journalRoot:path.join(root,'journal'),
    uid:process.getuid(),gid:process.getgid(),memoryMiB:256,cpuMillis:500,pids:32,tmpMiB:8});
  const controller=()=>new ExecutionController({runs,workers,hostFor:claim=>registry.forRun(claim),pollMs:30});
  const errors=[];let scheduler;const ids=[];
  t.after(async()=>{await scheduler?.close();for(const id of ids)await workers.stop(id);await registry.close();await accounts.close();await fs.rm(root,{recursive:true,force:true});});
  const first=await runs.submit(owner.id,{conversationId,key:'scheduled',prompt:'tools'});ids.push(first.id);
  scheduler=await startScheduler({controller:controller(),pollMs:30,retryMs:100,onError:event=>errors.push(event.code)});
  await until(async()=> (await runs.get(owner.id,first.id)).state==='completed');
  await until(()=>host.activeRunId()===null);
  assert.equal(await fs.readFile(path.join(base,'knowledge','note.md'),'utf8'),'edited in isolated Pi');
  assert.equal((await workers.status(first.id)).present,false);
  const hold=await runs.submit(owner.id,{conversationId,key:'shutdown',prompt:'hold'});ids.push(hold.id);
  const tickPath=path.join(base,'knowledge','ticks.txt');
  await until(async()=>!!await fs.stat(tickPath).catch(()=>null));
  assert.equal(host.activeRunId(),hold.id);
  await scheduler.close();assert.equal(scheduler.status().phase,'closed');
  assert.equal((await runs.get(owner.id,hold.id)).state,'stopped');
  assert.equal((await workers.status(hold.id)).present,false);
  assert.equal(host.activeRunId(),null);
  const ticks=await fs.readFile(tickPath,'utf8');await new Promise(resolve=>setTimeout(resolve,160));
  assert.equal(await fs.readFile(tickPath,'utf8'),ticks,'shutdown terminates shell descendants');
  assert.deepEqual(errors,[]);assert.equal(starts,2);
  scheduler=await startScheduler({controller:controller(),pollMs:30,retryMs:100});
  await until(()=>scheduler.status().phase==='idle');
  await scheduler.close();assert.equal(starts,2,'restart must not replay completed/stopped prompts');
});
