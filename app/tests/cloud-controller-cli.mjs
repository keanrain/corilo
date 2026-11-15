import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { Accounts } from '../cloud/accounts.mjs';
import { Runs } from '../cloud/runs.mjs';
import { ModelGrants } from '../cloud/model-grants.mjs';
import { DockerEngine, DockerWorkers } from '../cloud/docker-workers.mjs';
import { HostControlClient } from '../cloud/host-control-client.mjs';
import { gatewayChild } from './cloud-gateway-fixture.mjs';
if(!process.env.CORILO_TEST_DATABASE_URL || !process.env.CORILO_TEST_WORKER_IMAGE)throw new Error('Disposable PostgreSQL and immutable worker image required');
const until=async predicate=>{
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,40));}
  throw new Error('Controller fixture timed out');
};
function launch(env,args=[]){
  const child=spawn(process.execPath,['app/cloud/controller-cli.mjs',...args],{env,stdio:['ignore','pipe','pipe']});
  const timer=setTimeout(()=>child.kill('SIGKILL'),30000);
  let output='';
  for(const stream of [child.stdout,child.stderr])stream.on('data',part=>{output+=part;if(output.length>32768)child.kill('SIGKILL');});
  const done=new Promise((resolve,reject)=>{child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',(code,signal)=>{clearTimeout(timer);resolve({code,signal,output});});});
  return {child,done,output:()=>output};
}

test('formal recovery CLI stops real worker, revokes grant and leaves queued work untouched', {timeout:90000},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'corilo-cli-'));
  const accounts=new Accounts(process.env.CORILO_TEST_DATABASE_URL);await accounts.migrate();
  const dataRoot=path.join(root,'data'),journalRoot=path.join(root,'journal'),socketRoot=path.join(root,'model'),ipcRoot=path.join(root,'ipc');
  for(const dir of [dataRoot,journalRoot,socketRoot,ipcRoot])await fs.mkdir(dir,{mode:0o700});
  const control={dataRoot,socketPath:path.join(ipcRoot,'h.sock'),token:randomBytes(32).toString('hex')};
  const gateway=await gatewayChild(control),client=new HostControlClient(control);
  const runs=new Runs(accounts.pool,{maxRunning:1,maxQueued:4,leaseSeconds:30,maxRunSeconds:120});
  const grants=new ModelGrants(accounts.pool),engine=new DockerEngine();
  const workers=new DockerWorkers({engine:{request:(method,route,spec)=>engine.request(method,route,route.startsWith('/containers/create')?{...spec,Entrypoint:['node','/pi/probe.mjs']}:spec)},
    image:process.env.CORILO_TEST_WORKER_IMAGE,dataRoot,journalRoot,uid:process.getuid(),gid:process.getgid(),memoryMiB:256,cpuMillis:500,pids:32,tmpMiB:8});
  const ids=[],processes=[];
  t.after(async()=>{
    for(const process of processes){if(process.child.exitCode===null && process.child.signalCode===null)process.child.kill('SIGTERM');await process.done;}
    for(const id of ids)await workers.stop(id);
    await gateway.close();await accounts.close();await fs.rm(root,{recursive:true,force:true});
  });
  const owner=async()=>{const email=randomUUID()+'@example.test';return accounts.session(await accounts.login({subject:randomUUID(),email},await accounts.invite(email)));};
  const a=await owner(),b=await owner(),conversationId=await runs.conversation(a.id),cb=await runs.conversation(b.id);
  const run=await runs.submit(a.id,{conversationId,key:'abandoned',prompt:'hold'});ids.push(run.id);
  const claim=await runs.claim();assert.equal(claim.id,run.id);
  const host=client.forRun(claim);await host.beginRun(run.id);
  const base=path.join(dataRoot,a.vault_id);
  await fs.copyFile('app/tests/worker-probe.mjs',path.join(base,'pi','probe.mjs'));
  const grant=await grants.issue(claim,{model:'synthetic',maxRequests:3,maxOutputTokens:100,maxTokensPerRequest:50,ttlSeconds:120});
  await workers.start(claim,async()=>true);
  const ticks=path.join(base,'knowledge','ticks.txt');await until(async()=>!!await fs.stat(ticks).catch(()=>null));
  const queued=await runs.submit(b.id,{conversationId:cb,key:'not-admitted',prompt:'must never execute'});
  await accounts.pool.query("UPDATE corilo_private.runs SET lease_until=now()-interval '1 second' WHERE id=$1",[run.id]);
  const env={...process.env,DATABASE_URL:process.env.CORILO_TEST_DATABASE_URL,CORILO_CLOUD_DATA:dataRoot,CORILO_CONTROLLER_STATE:journalRoot,
    CORILO_MODEL_SOCKET_ROOT:socketRoot,CORILO_HOST_CONTROL_SOCKET:control.socketPath,CORILO_HOST_CONTROL_TOKEN:control.token,
    CORILO_CONTROLLER_POLL_MS:'50',CORILO_CONTROLLER_RETRY_MS:'100'};
  // No image, execution limits, provider credentials or model are supplied to recovery.
  delete env.DEEPSEEK_API_KEY;delete env.OPENAI_API_KEY;delete env.CORILO_TEST_WORKER_IMAGE;
  const wrongJournal=path.join(root,'wrong-journal');await fs.mkdir(wrongJournal,{mode:0o700});
  const wrong=launch({...env,CORILO_CONTROLLER_STATE:wrongJournal},['--once']);processes.push(wrong);
  const wrongResult=await wrong.done;assert.notEqual(wrongResult.code,0,'missing journal cannot prove a worker stopped');
  assert.equal((await workers.status(run.id)).running,true);
  assert.equal(await host.activeRunId(),run.id,'wrong controller state must retain write gate');
  assert.equal((await runs.get(a.id,run.id)).state,'stopping');
  await assert.rejects(fs.stat(path.join(wrongJournal,run.id)),error=>error.code==='ENOENT','recovery must not manufacture a removed journal');
  const once=launch(env,['--once']);processes.push(once);const recovered=await once.done;
  assert.equal(recovered.code,0,recovered.output);assert.match(recovered.output,/controller_recovery_pass_complete/);
  assert.equal((await runs.get(a.id,run.id)).state,'interrupted');
  assert.equal((await workers.status(run.id)).present,false);
  assert.equal(await host.activeRunId(),null);
  const revoked=(await accounts.pool.query('SELECT revoked_at FROM corilo_private.model_grants WHERE run_id=$1',[run.id])).rows[0];assert.ok(revoked.revoked_at);
  await assert.rejects(grants.assertActive(grant.token));
  const before=await fs.readFile(ticks,'utf8');await new Promise(resolve=>setTimeout(resolve,150));assert.equal(await fs.readFile(ticks,'utf8'),before);
  assert.equal((await runs.get(b.id,queued.id)).state,'queued');
  const daemon=launch(env);processes.push(daemon);await until(()=>daemon.output().includes('controller_recovery_loop_started')||daemon.child.exitCode!==null);
  assert.equal(daemon.child.exitCode,null,daemon.output());
  const contender=launch(env,['--once']);processes.push(contender);const rejected=await contender.done;
  assert.notEqual(rejected.code,0,'second controller cannot own same journal');
  await new Promise(resolve=>setTimeout(resolve,200));assert.equal((await runs.get(b.id,queued.id)).state,'queued');
  daemon.child.kill('SIGTERM');const stopped=await daemon.done;assert.equal(stopped.code,0,stopped.output);
  const repeat=launch(env,['--once']);processes.push(repeat);assert.equal((await repeat.done).code,0);
  assert.equal((await runs.get(b.id,queued.id)).state,'queued','restart never admits pending work');
  for(const child of processes){assert.ok(!child.output().includes(control.token));assert.ok(!child.output().includes('must never execute'));assert.ok(!child.output().includes(process.env.CORILO_TEST_DATABASE_URL));}
  await runs.stop(b.id,queued.id);
});
