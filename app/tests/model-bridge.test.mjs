import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startModelBridge, prepareModelConfig } from '../cloud/worker/model-bridge.mjs';

const token='a'.repeat(64), payload={model:'deepseek-flash',messages:[{role:'user',content:'synthetic'}],stream:true,max_tokens:100};
const post=(bridge,body=payload,headers={})=>fetch(bridge.origin+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,...headers},body:JSON.stringify(body)});
async function fixture(t,handler,limits={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'corilo-bridge-')),socketPath=path.join(root,'relay.sock');
  const relay=http.createServer(handler);await new Promise(resolve=>relay.listen(socketPath,resolve));
  const bridge=await startModelBridge({socketPath,maxDurationMs:1000,...limits});
  t.after(async()=>{await bridge.close();relay.closeAllConnections();await new Promise(resolve=>relay.close(resolve));await fs.rm(root,{recursive:true,force:true});});
  return bridge;
}

test('fixed socket bridge forwards native model streaming with only allowed headers',async t=>{
  let received;
  const bridge=await fixture(t,async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    received={method:req.method,url:req.url,headers:req.headers,body:JSON.parse(body)};
    res.writeHead(200,{'Content-Type':'text/event-stream','Set-Cookie':'not-forwarded','X-Private':'not-forwarded'});
    res.write('data: {"choices":[]}\n\n');res.end('data: [DONE]\n\n');
  });
  const response=await post(bridge,payload,{'X-Upstream-Url':'https://invalid.example','Cookie':'private=1'});
  assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),null);assert.equal(response.headers.get('x-private'),null);
  assert.ok((await response.text()).endsWith('data: [DONE]\n\n'));
  assert.equal(received.method,'POST');assert.equal(received.url,'/v1/chat/completions');assert.equal(received.headers.authorization,'Bearer '+token);
  assert.equal(received.headers.cookie,undefined);assert.equal(received.headers['x-upstream-url'],undefined);assert.deepEqual(received.body,payload);
});

test('bridge rejects alternative routes, invalid credentials, encoded bodies, oversized requests and CONNECT',async t=>{
  let calls=0;const bridge=await fixture(t,()=>{calls++;},{maxRequestBytes:1024});
  for(const route of ['/','/v1/models','/v1/chat/completions?url=other','http://example.test/v1/chat/completions']) {
    const request=http.request(new URL(bridge.origin),{path:route,method:'POST'});const response=once(request,'response');request.end();const [res]=await response;res.resume();assert.equal(res.statusCode,404);
  }
  assert.equal((await post(bridge,payload,{Authorization:'Bearer wrong'})).status,401);
  assert.equal((await post(bridge,payload,{'Content-Encoding':'gzip'})).status,400);
  assert.equal((await post(bridge,{...payload,extra:'x'.repeat(2000)})).status,413);
  const target=new URL(bridge.origin),socket=net.connect({host:'127.0.0.1',port:Number(target.port)});await once(socket,'connect');
  const closed=once(socket,'close');socket.write('CONNECT example.test:443 HTTP/1.1\r\nHost: example.test\r\n\r\n');await closed;
  assert.equal(calls,0);
});

test('bridge cancels socket request when client disconnects and bounds incomplete uploads',async t=>{
  let closed;const stopped=new Promise(resolve=>{closed=resolve;});let calls=0;
  const bridge=await fixture(t,(req,res)=>{calls++;res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: {}\n\n');res.once('close',closed);},{maxDurationMs:150,maxConcurrent:1});
  const response=await post(bridge),reader=response.body.getReader();await reader.read();await reader.cancel();
  await Promise.race([stopped,new Promise((_,reject)=>setTimeout(()=>reject(new Error('socket request remained alive')),500))]);
  await new Promise(resolve=>setTimeout(resolve,20));
  const slow=http.request(bridge.origin+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,'Content-Length':'1000'}});
  t.after(()=>slow.destroy());const timeoutResponse=once(slow,'response');slow.write('{');
  const [timeout]=await timeoutResponse;assert.equal(timeout.statusCode,504);timeout.resume();await once(timeout,'end');
  await new Promise(resolve=>setTimeout(resolve,20));
  const next=await post(bridge);assert.equal(next.status,200);await next.body.cancel();assert.equal(calls,2);
});

test('bridge times out an endless socket stream after headers without leaking its slot',async t=>{
  let ended;const closed=new Promise(resolve=>{ended=resolve;});let calls=0;
  const bridge=await fixture(t,(_req,res)=>{
    calls++;res.writeHead(200,{'Content-Type':'text/event-stream'});
    if(calls===1) {res.write('data: {}\n\n');res.once('close',ended);}
    else res.end('data: [DONE]\n\n');
  },{maxDurationMs:100,maxConcurrent:1});
  const response=await post(bridge);assert.equal(response.status,200);
  await assert.rejects(response.text());await closed;
  await new Promise(resolve=>setTimeout(resolve,20));
  const next=await post(bridge);assert.equal(next.status,200);assert.ok((await next.text()).includes('[DONE]'));
});

test('bridge refuses redirects and cuts oversized socket responses',async t=>{
  const redirect=await fixture(t,(_req,res)=>{res.writeHead(302,{Location:'http://example.test', 'Content-Type':'application/json'});res.end('{}');});
  assert.equal((await post(redirect)).status,502);
  const huge=await fixture(t,(_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('x'.repeat(4000));},{maxResponseBytes:1024});
  await assert.rejects(async()=>{const response=await post(huge);await response.text();});
});

test('ephemeral Pi native configuration contains only the run grant and selected plain behavior settings',async t=>{
  const source=await fs.mkdtemp(path.join(os.tmpdir(),'corilo-config-source-'));let projected;
  t.after(async()=>{await fs.rm(source,{recursive:true,force:true});if(projected)await fs.rm(projected,{recursive:true,force:true});});
  const settings={defaultProvider:'other',defaultModel:'old',defaultThinkingLevel:'low',compaction:{enabled:false},retry:{enabled:false},extensions:['/private/code'],packages:['forbidden'],arbitrarySecret:'do-not-copy'};
  await fs.writeFile(path.join(source,'settings.json'),JSON.stringify(settings));
  await fs.writeFile(path.join(source,'auth.json'),'do-not-read-source-credentials');await fs.writeFile(path.join(source,'models.json'),'do-not-copy-source-models');
  projected=await prepareModelConfig({model:'deepseek-flash',token,maxTokens:1024},'http://127.0.0.1:12345',source);
  const config=JSON.parse(await fs.readFile(path.join(projected,'settings.json'),'utf8'));
  assert.deepEqual(config,{defaultProvider:'deepseek',defaultModel:'deepseek-flash',cacheWarming:'off',defaultThinkingLevel:'low',compaction:{enabled:false},retry:{enabled:false}});
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(projected,'auth.json'),'utf8')),{deepseek:{type:'api_key',key:token}});
  const models=JSON.parse(await fs.readFile(path.join(projected,'models.json'),'utf8'));assert.equal(models.providers.deepseek.baseUrl,'http://127.0.0.1:12345/v1');assert.equal(models.providers.deepseek.modelOverrides['deepseek-flash'].maxTokens,1024);
  assert.equal((await fs.stat(path.join(projected,'auth.json'))).mode&0o777,0o600);
  assert.equal(await fs.readFile(path.join(source,'auth.json'),'utf8'),'do-not-read-source-credentials');
  await assert.rejects(prepareModelConfig({model:'deepseek-flash',token,maxTokens:1024},'http://example.test',source));
});
