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
import { startHost } from '../host/server.mjs';
if(!process.env.CORILO_TEST_DATABASE_URL || !process.env.CORILO_TEST_WORKER_IMAGE)throw new Error('Disposable PostgreSQL and immutable worker image required');

test('real Docker + PostgreSQL + default Pi tools, file gate and complete container stop',async t=> {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'corilo-worker-'));
  const accounts=new Accounts(process.env.CORILO_TEST_DATABASE_URL); await accounts.migrate();
  const runs=new Runs(accounts.pool,{maxRunning:1,maxQueued:4,leaseSeconds:30,maxRunSeconds:120});
  const email=randomUUID()+'@example.test';
  const token=await accounts.login({subject:randomUUID(),email},await accounts.invite(email));
  const owner=await accounts.session(token), conversationId=await runs.conversation(owner.id);
  const base=path.join(root,owner.vault_id), state=path.join(base,'state','conversations',conversationId);
  await fs.mkdir(state,{recursive:true});
  let host=await startHost({mode:'cloud-files',vault:path.join(base,'knowledge'),configDir:path.join(base,'state'),piAgentDir:path.join(base,'pi')});
  await fs.writeFile(path.join(base,'knowledge/note.md'),'original');
  await fs.copyFile('app/tests/worker-probe.mjs',path.join(base,'pi/probe.mjs'));
  const engine=new DockerEngine();
  let beforeCreate, starts=0, useProductionEntry=false;
  const probeEngine={request:async(method,route,data)=>{
    // Only tests substitute the entrypoint; runtime settings/mounts use production code.
    if(route.startsWith('/containers/create')) {
      assert.equal(data.HostConfig.NetworkMode,'none');
      assert.equal(data.HostConfig.Memory,256*1024*1024);assert.equal(data.HostConfig.PidsLimit,32);
      assert.deepEqual(data.HostConfig.CapDrop,['ALL']);assert.equal(data.HostConfig.ReadonlyRootfs,true);
      if(!useProductionEntry)data={...data,Entrypoint:['node','/pi/probe.mjs']};
      if(beforeCreate)await beforeCreate(method,route,data);
    }
    if(route.endsWith('/start'))starts++;
    return engine.request(method,route,data);
  }};
  const workers=new DockerWorkers({engine:probeEngine,image:process.env.CORILO_TEST_WORKER_IMAGE,dataRoot:root,journalRoot:path.join(root,'control'),
    uid:process.getuid(),gid:process.getgid(),memoryMiB:256,cpuMillis:500,pids:32,tmpMiB:8});
  let controller=new ExecutionController({runs,workers,hostFor:async()=>host,pollMs:30});
  await controller.init();
  const allRuns=[];
  t.after(async()=>{await controller.close(); for(const id of allRuns)await workers.stop(id).catch(()=>{}); await host.close();await accounts.close();await fs.rm(root,{recursive:true,force:true});});
  const second=new ExecutionController({runs,workers,hostFor:async()=>host});
  await assert.rejects(second.init(),/already active/);
  const request=(route,body)=>fetch(host.origin+route,{method:body?'POST':'GET',headers:{'X-Corilo-Token':host.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const run=await runs.submit(owner.id,{conversationId,key:'tools',prompt:'tools'}); allRuns.push(run.id);
  const result=await controller.executeNext();
  assert.equal(result.state,'completed',await fs.readFile(path.join(state,'probe-error.txt'),'utf8').catch(()=>''));
  assert.equal(await fs.readFile(path.join(base,'knowledge/note.md'),'utf8'),'edited in isolated Pi');
  assert.equal(JSON.parse(await fs.readFile(path.join(state,'probe.json'),'utf8')).defaultTools,true);
  assert.equal((await (await request('/api/state')).json()).busy,false);
  assert.equal((await workers.status(run.id)).present,false);
  const hold=await runs.submit(owner.id,{conversationId,key:'hold',prompt:'hold'});allRuns.push(hold.id);
  const task=controller.executeNext();
  for(let i=0;i<500;i++) { if(await fs.stat(path.join(base,'knowledge/ticks.txt')).catch(()=>null))break; await new Promise(r=>setTimeout(r,30)); }
  assert.ok(await fs.stat(path.join(base,'knowledge/ticks.txt')).catch(()=>null), JSON.stringify({status:await runs.get(owner.id,hold.id),error:await fs.readFile(path.join(state,'probe-error.txt'),'utf8').catch(()=>''),ended:await fs.readFile(path.join(state,'hold-ended.json'),'utf8').catch(()=>''),started:await fs.readFile(path.join(state,'hold-started.txt'),'utf8').catch(()=>''),journal:await workers.journal(hold.id)}));
  assert.equal((await request('/api/capture',{text:'blocked while external worker runs'})).status,409);
  assert.equal((await request('/api/export/knowledge')).status,409);
  await runs.stop(owner.id,hold.id);
  assert.equal((await task).state,'stopped');
  const ticks=await fs.readFile(path.join(base,'knowledge/ticks.txt'),'utf8');
  await new Promise(r=>setTimeout(r,150));
  assert.equal(await fs.readFile(path.join(base,'knowledge/ticks.txt'),'utf8'),ticks,'shell descendants stopped');
  assert.equal((await request('/api/capture',{text:'unblocked after confirmed stop'})).status,200);
  // Stop committed while create is in flight must prevent a late start.
  let unblock,entered;
  const waiting=new Promise(r=>{entered=r;});const held=new Promise(r=>{unblock=r;});
  beforeCreate=async()=>{entered();await held;};
  const delayed=await runs.submit(owner.id,{conversationId,key:'delayed',prompt:'hold'});allRuns.push(delayed.id);
  const count=starts, delayedTask=controller.executeNext();await waiting;
  await runs.stop(owner.id,delayed.id);
  assert.equal(await runs.claim(),null);unblock();
  assert.equal((await delayedTask).state,'stopped');assert.equal(starts,count);
  beforeCreate=null;
  // Lost create response: absence is not safe release; later actual Docker create is reconciled.
  let lateCreate;
  beforeCreate=async(method,route,data)=>{lateCreate=()=>engine.request(method,route,data);throw new Error('Synthetic transport disconnect before create acknowledgement');};
  const uncertain=await runs.submit(owner.id,{conversationId,key:'uncertain',prompt:'hold'});allRuns.push(uncertain.id);
  await assert.rejects(controller.executeNext(),/unconfirmed/);
  assert.equal((await request('/api/capture',{text:'must remain held'})).status,409);
  assert.deepEqual(await controller.recover(),[]); // live lease is not itself recoverable
  await lateCreate();beforeCreate=null;
  await accounts.pool.query("UPDATE corilo_private.runs SET lease_until=now()-interval '1 second' WHERE id=$1",[uncertain.id]);
  assert.equal((await controller.recover())[0].state,'interrupted');assert.equal(starts,count);
  // Restart file host with a persistent gate: it cannot checkpoint/write before reconciliation.
  const pending=await runs.submit(owner.id,{conversationId,key:'recover',prompt:'hold'});allRuns.push(pending.id);
  const claim=await runs.claim(); await host.beginRun(claim.id);
  await workers.start(claim,async()=>true);
  await host.close();
  host=await startHost({mode:'cloud-files',vault:path.join(base,'knowledge'),configDir:path.join(base,'state'),piAgentDir:path.join(base,'pi')});
  assert.equal((await request('/api/capture',{text:'blocked after host restart'})).status,409);
  await controller.close();
  controller=new ExecutionController({runs,workers,hostFor:async()=>host});await controller.init();
  await accounts.pool.query("UPDATE corilo_private.runs SET lease_until=now()-interval '1 second' WHERE id=$1",[claim.id]);
  assert.equal((await controller.recover())[0].state,'interrupted');
  assert.equal((await request('/api/capture',{text:'recovered without prompt replay'})).status,200);
  const terminal=await runs.submit(owner.id,{conversationId,key:'terminal-gate',prompt:'tools'});allRuns.push(terminal.id);
  const tc=await runs.claim();await host.beginRun(tc.id);
  // Simulate confirmed no worker and a terminal DB commit before release acknowledgement.
  assert.equal(await workers.stop(tc.id),true);
  await runs.finish(tc.id,tc.token,'failed');
  assert.equal((await controller.recover())[0].id,tc.id);
  assert.equal(host.activeRunId(),null);
  // Actual production entrypoint with no provider credentials must fail, not report completion.
  useProductionEntry=true;
  const noModel=await runs.submit(owner.id,{conversationId,key:'no-model',prompt:'hello'});allRuns.push(noModel.id);
  assert.equal((await controller.executeNext()).state,'failed');
  assert.equal(host.activeRunId(),null);

});
