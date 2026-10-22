import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { HostControlClient } from '../cloud/host-control-client.mjs';

async function fixture(t, handler) {
  const root=await mkdtemp(path.join(os.tmpdir(),'corilo-host-client-'));
  const socketPath=path.join(root,'control.sock'), token=randomBytes(32).toString('hex');
  const server=http.createServer(handler);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});});
  return {socketPath,token,client:new HostControlClient({socketPath,token})};
}
const failsSafely = error => error.message === 'File host control outcome unconfirmed' && !error.cause;

test('host control client sends only fixed authenticated operations and binds the run facade',async t=>{
  const id=randomUUID(),seen=[];let active=true,expectedToken;
  const {client,token}=await fixture(t,async(req,res)=>{
    assert.equal(req.method,'POST');assert.equal(req.headers.authorization,'Bearer '+expectedToken);
    assert.equal(req.headers.origin,undefined);assert.equal(req.headers['content-type'],'application/json');
    const parts=[];for await(const part of req)parts.push(part);
    assert.equal(Buffer.concat(parts).toString(),'{}');seen.push(req.url);
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify(req.url.endsWith('/status')?{active}:{ok:true}));
  });expectedToken=token;
  const host=client.forRun({id,ownerId:'not sent',vaultId:'not sent',conversationId:'not sent'});
  await host.beginRun(id);await host.checkpointRun(id);await host.releaseRun(id);
  assert.equal(await host.activeRunId(),id);active=false;assert.equal(await host.activeRunId(),null);
  assert.deepEqual(seen,['begin','checkpoint','release','status','status'].map(action=>`/runs/${id}/${action}`));
  await assert.rejects(host.beginRun(randomUUID()),/identity mismatch/);
  assert.equal(seen.length,5);assert.ok(!JSON.stringify(client).includes(token));
  assert.throws(()=>client.forRun({id:'../escape'}),/identity/);
});

test('host control client rejects malformed, oversized, redirected and sensitive error responses',async t=>{
  let next;
  const {client}=await fixture(t,(req,res)=>next(req,res));
  const id=randomUUID(),host=client.forRun({id});
  const json = value => (req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(value);};
  for(const value of ['{','null','[]','{"ok":false}','{"ok":true,"token":"PRIVATE"}','{"active":true}','{"ok":true}'+ ' '.repeat(4096)]) {
    next=json(value);await assert.rejects(host.beginRun(id),failsSafely);
  }
  next=json('{"active":"yes"}');await assert.rejects(host.activeRunId(),failsSafely);
  next=(req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('{"ok":true}');};
  await assert.rejects(host.beginRun(id),failsSafely);
  let redirects=0;
  next=(req,res)=>{redirects++;res.writeHead(302,{Location:'/private-target'});res.end();};
  await assert.rejects(host.beginRun(id),failsSafely);assert.equal(redirects,1);
  next=(req,res)=>{res.writeHead(403,{'Content-Type':'application/json'});res.end('{"error":"PRIVATE_CREDENTIAL_AND_PATH"}');};
  await assert.rejects(host.beginRun(id),failsSafely);
});

test('host control client never retries an acknowledgement loss and enforces total response deadline',async t=>{
  let requests=0,handler=(req,res)=>{requests++;req.socket.destroy();};
  const setup=await fixture(t,(req,res)=>handler(req,res));
  const host=setup.client.forRun({id:randomUUID()});
  await assert.rejects(host.beginRun(randomUUID()),/identity mismatch/);assert.equal(requests,0);
  const id=randomUUID();await assert.rejects(setup.client.forRun({id}).beginRun(id),failsSafely);
  await new Promise(resolve=>setTimeout(resolve,40));assert.equal(requests,1,'no retry after unknown outcome');
  handler=(req,res)=>{
    requests++;res.writeHead(200,{'Content-Type':'application/json'});res.write(' ');
    const interval=setInterval(()=>res.write(' '),5);res.once('close',()=>clearInterval(interval));
  };
  const bounded=new HostControlClient({...setup,timeoutMs:80});
  const started=Date.now();await assert.rejects(bounded.forRun({id}).beginRun(id),failsSafely);
  assert.ok(Date.now()-started<1500,'continuous traffic must not extend deadline');assert.equal(requests,2);
});

test('host control client validates configuration and sanitizes connection failures',async()=>{
  for(const options of [{}, {socketPath:'relative',token:'a'.repeat(64)}, {socketPath:'/tmp/control',token:'bad'},
    {socketPath:'/tmp/control',token:'a'.repeat(64),timeoutMs:0}, {socketPath:'/tmp/'+ 'x'.repeat(101),token:'a'.repeat(64)}])
    assert.throws(()=>new HostControlClient(options),/configuration/);
  const client=new HostControlClient({socketPath:'/tmp/missing-'+randomUUID(),token:randomBytes(32).toString('hex'),timeoutMs:100});
  const id=randomUUID();await assert.rejects(client.forRun({id}).beginRun(id),failsSafely);
});
