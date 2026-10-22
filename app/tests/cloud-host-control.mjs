import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { Accounts } from '../cloud/accounts.mjs';
import { Runs } from '../cloud/runs.mjs';
import { HostControlClient } from '../cloud/host-control-client.mjs';
import { gatewayChild } from './cloud-gateway-fixture.mjs';
if(!process.env.CORILO_TEST_DATABASE_URL)throw new Error('Disposable PostgreSQL required');
const post=(socketPath,token,route,body={},extra={})=>new Promise((resolve,reject)=>{
  const req=http.request({socketPath,path:route,method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...extra}},res=>{
    let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,text}));res.on('error',reject);
  });req.on('error',reject);req.end(JSON.stringify(body));
});

test('independent gateway host control authenticates, derives run ownership and fences lifecycle operations',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'corilo-hc-'));
  const accounts=new Accounts(process.env.CORILO_TEST_DATABASE_URL);await accounts.migrate();
  const dataRoot=path.join(root,'data'),controlDir=path.join(root,'ipc');await fs.mkdir(controlDir,{mode:0o700});
  const socketPath=path.join(controlDir,'h.sock'),token=randomBytes(32).toString('hex');
  let gateway=await gatewayChild({dataRoot,socketPath,token});
  t.after(async()=>{await gateway.close();await accounts.close();await fs.rm(root,{recursive:true,force:true});});
  assert.equal((await fs.stat(socketPath)).mode&0o777,0o600);
  const email=randomUUID()+'@example.test';
  const session=await accounts.login({subject:randomUUID(),email},await accounts.invite(email));
  const owner=await accounts.session(session);
  const runs=new Runs(accounts.pool,{maxRunning:1,maxQueued:2,leaseSeconds:30,maxRunSeconds:120});
  const conversationId=await runs.conversation(owner.id);
  const run=await runs.submit(owner.id,{conversationId,key:'ipc',prompt:'never execute fixture'});
  const route=op=>'/runs/'+run.id+'/'+op;
  assert.equal((await post(socketPath,'0'.repeat(64),route('begin'))).status,401);
  assert.equal((await post(socketPath,token,route('begin'),{ownerId:owner.id})).status,400);
  assert.equal((await post(socketPath,token,route('begin'),{}, {Origin:gateway.address})).status,400);
  assert.equal((await post(socketPath,token,route('begin')+'?path=/tmp')).status,404);
  assert.equal((await post(socketPath,token,route('begin'))).status,409,'queued tasks cannot hold file gate');
  const claim=await runs.claim();assert.equal(claim.id,run.id);
  const client=new HostControlClient({socketPath,token});const host=await client.forRun(claim);
  await host.beginRun(run.id);await host.beginRun(run.id);
  assert.equal(await host.activeRunId(),run.id);
  assert.equal((await post(socketPath,token,route('release'))).status,409,'running task cannot release gate');
  const publicRequest=(route,body)=>fetch(gateway.address+route,{method:body?'POST':'GET',headers:{Cookie:`__Host-corilo-session=${session}`,Origin:gateway.address},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await publicRequest('/api/capture',{text:'blocked'})).status,409);
  assert.equal((await publicRequest(route('release'),{})).status,405,'public gateway does not forward privileged control');
  assert.equal((await publicRequest('/api/agent/prompt',{text:'disabled'})).status,503);
  await gateway.close();gateway=await gatewayChild({dataRoot,socketPath,token});
  assert.equal(await host.activeRunId(),run.id,'remote adapter reconnects after graceful restart');
  await accounts.pool.query('UPDATE corilo_private.accounts SET disabled=true WHERE id=$1',[owner.id]);
  await host.checkpointRun(run.id); // Trusted fixture: no worker was ever created.
  await runs.finish(run.id,claim.token,'stopped');
  await host.releaseRun(run.id);await host.releaseRun(run.id);
  assert.equal(await host.activeRunId(),null,'disabled account recovery releases exact run');
  assert.equal((await post(socketPath,token,route('begin'))).status,409,'late begin cannot recreate terminal gate');
  const invalid=await post(socketPath,token,'/runs/'+randomUUID()+'/status');assert.equal(invalid.status,404);
  assert.ok(!invalid.text.includes(token));assert.ok(!invalid.text.includes(dataRoot));
  // A late old release must never clear another run's gate in the same vault.
  await accounts.pool.query('UPDATE corilo_private.accounts SET disabled=false WHERE id=$1',[owner.id]);
  const next=await runs.submit(owner.id,{conversationId,key:'next',prompt:'no worker'});const nextClaim=await runs.claim();
  const nextHost=await client.forRun(nextClaim);await nextHost.beginRun(next.id);
  assert.equal((await post(socketPath,token,route('release'))).status,409);
  assert.equal(await nextHost.activeRunId(),next.id);
  await nextHost.checkpointRun(next.id);await runs.finish(next.id,nextClaim.token,'completed');await nextHost.releaseRun(next.id);
});
