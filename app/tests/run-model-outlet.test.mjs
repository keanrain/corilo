import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RunModelOutlet } from '../cloud/run-model-outlet.mjs';
import { ExecutionController } from '../cloud/execution-controller.mjs';

const limits={model:'deepseek-flash',maxRequests:2,maxOutputTokens:200,maxTokensPerRequest:100,ttlSeconds:30};
const relayOptions={apiKey:'synthetic-platform-secret',maxRequestBytes:4096,maxResponseBytes:4096,maxDurationMs:1000,maxConcurrent:1,checkIntervalMs:20,
  fetchImpl:async()=>new Response('data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}})};
const post=(socketPath,token)=>new Promise((resolve,reject)=>{
  const req=http.request({socketPath,path:'/v1/chat/completions',method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token}},res=>{
    res.resume();res.once('end',()=>resolve(res.statusCode));
  });req.once('error',reject);req.end(JSON.stringify({model:limits.model,max_tokens:100,stream:true,messages:[{role:'user',content:'synthetic'}]}));
});

test('per-run Unix outlet rejects peer grants before reservation and closes even when revocation DB fails',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'corilo-outlet-'));
  const claim={id:randomUUID(),ownerId:randomUUID(),vaultId:randomUUID()}, token='a'.repeat(64), peer='b'.repeat(64);
  let reserved=0,failRevoke=false;
  const grants={issue:async()=>({token}),reserve:async()=>{reserved++;return {runId:claim.id,ownerId:claim.ownerId,vaultId:claim.vaultId};},
    assertActive:async()=>({runId:claim.id,ownerId:claim.ownerId,vaultId:claim.vaultId}),revokeRun:async()=>{if(failRevoke)throw new Error('DB unavailable');}};
  const outlet=new RunModelOutlet({grants,socketRoot:root,limits,relayOptions});
  t.after(async()=>{failRevoke=false;await outlet.close();await fs.rm(root,{recursive:true,force:true});});
  const binding=await outlet.prepare(claim);
  assert.equal((await fs.stat(binding.socketPath)).mode&0o777,0o600);
  assert.equal(await post(binding.socketPath,peer),401);assert.equal(reserved,0);
  assert.equal(await post(binding.socketPath,token),200);assert.equal(reserved,1);
  failRevoke=true;await assert.rejects(outlet.revoke(claim.id),/DB unavailable/);
  await assert.rejects(post(binding.socketPath,token));
  failRevoke=false;await outlet.revoke(claim.id);
  await assert.rejects(fs.stat(path.dirname(binding.socketPath)),{code:'ENOENT'});
});

test('outlet revokes uncertain issuance and recovery does not remove unknown files',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'corilo-outlet-')),id=randomUUID();let revoked=0;
  const grants={issue:async()=>{throw new Error('Lost issuance response');},reserve:async()=>{},assertActive:async()=>{},revokeRun:async()=>{revoked++;}};
  const outlet=new RunModelOutlet({grants,socketRoot:root,limits,relayOptions});
  t.after(async()=>{await fs.rm(root,{recursive:true,force:true});});
  await assert.rejects(outlet.prepare({id}),/Lost issuance response/);assert.equal(revoked,1);
  await assert.rejects(fs.stat(path.join(root,id)),{code:'ENOENT'});
  await fs.mkdir(path.join(root,id),{mode:0o700});await fs.writeFile(path.join(root,id,'keep.txt'),'preserve');
  await assert.rejects(outlet.revoke(id),{code:'ENOTEMPTY'});
  assert.equal(await fs.readFile(path.join(root,id,'keep.txt'),'utf8'),'preserve');
});

test('controller attempts container stop on model revocation failure without releasing file gate',async()=>{
  const id=randomUUID(),calls=[];
  const controller=new ExecutionController({runs:{claim:async()=>({id}),heartbeat:async()=>({continue:true}),finish:async()=>{calls.push('finish');}},
    hostFor:async()=>({beginRun:async()=>{calls.push('begin');},checkpointRun:async()=>{calls.push('checkpoint');},releaseRun:async()=>{calls.push('release');}}),
    workers:{start:async()=>{calls.push('start');},status:async()=>({running:false,exitCode:0}),stop:async()=>{calls.push('stop');return true;}},
    modelOutlet:{prepare:async()=>({token:'synthetic'}),revoke:async()=>{calls.push('revoke');throw new Error('DB unavailable');},close:async()=>{}}});
  await assert.rejects(controller.execute(),/revocation unconfirmed/);
  assert.deepEqual(calls,['begin','start','revoke','stop']);
});
