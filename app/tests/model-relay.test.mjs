import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { startModelRelay } from '../cloud/model-relay.mjs';

const token='a'.repeat(64),secret='synthetic-platform-secret', model='deepseek-flash';
const options={apiKey:secret,allowedModels:[model],maxRequestBytes:4096,maxResponseBytes:8192,maxDurationMs:2000,maxConcurrent:2,checkIntervalMs:20};
const body={model,messages:[{role:'user',content:'synthetic note'}],max_tokens:100,stream:true,stream_options:{include_usage:true}};
const post=(relay,value=body,headers={})=>fetch(relay.origin+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,...headers},body:JSON.stringify(value)});
async function fixture(t,handler,overrides={}) {
  const upstream=http.createServer(handler);upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const reservations=[];let active=true;
  const grants={reserve:async(value,request)=>{assert.equal(value,token);reservations.push(request);},assertActive:async()=>{if(!active)throw Object.assign(new Error('private grant state'),{status:401});}};
  const relay=await startModelRelay({...options,grants,upstreamUrl:`http://127.0.0.1:${upstream.address().port}/chat/completions`,...overrides});
  t.after(async()=>{await relay.close();upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));});
  return {relay,reservations,revoke:()=>{active=false;}};
}
const chunk={id:'synthetic',choices:[{index:0,delta:{content:'hello'},finish_reason:null}]};

test('relay streams bounded DeepSeek protocol and only sends platform credentials upstream',async t=>{
  let headers,payload;
  const {relay,reservations}=await fixture(t,async(req,res)=>{
    headers=req.headers;let data='';for await(const part of req)data+=part;payload=JSON.parse(data);
    res.writeHead(200,{'Content-Type':'text/event-stream','Set-Cookie':'upstream-secret=1','X-Debug-Authorization':secret});
    const first='data: '+JSON.stringify(chunk)+'\n\n';res.write(first.slice(0,17));res.write(first.slice(17));
    res.end('data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\ndata: [DONE]\n\n');
  });
  const response=await post(relay,body,{'X-Forwarded-For':'private','X-Upstream-Url':'https://evil.invalid'});
  assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),null);assert.equal(response.headers.get('x-debug-authorization'),null);
  const text=await response.text();assert.ok(text.includes('hello'));assert.ok(text.endsWith('data: [DONE]\n\n'));assert.ok(!text.includes(secret));
  assert.equal(headers.authorization,'Bearer '+secret);assert.equal(headers['x-forwarded-for'],undefined);assert.equal(headers['x-upstream-url'],undefined);
  assert.deepEqual(payload,body);assert.deepEqual(reservations,[{model,maxTokens:100}]);
});

test('relay accepts tool/reasoning messages and nonstream JSON without exposing headers',async t=>{
  const {relay}=await fixture(t,(req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'done'}}]}));});
  const response=await post(relay,{...body,stream:false,messages:[{role:'assistant',content:null,reasoning_content:'',tool_calls:[{id:'call',type:'function',function:{name:'read',arguments:'{}'}}]},{role:'tool',tool_call_id:'call',content:'note'}],tools:[{type:'function',function:{name:'read',parameters:{type:'object'}}}],thinking:{type:'enabled'},reasoning_effort:'high'});
  assert.equal(response.status,200);assert.equal((await response.json()).choices[0].message.content,'done');
});

test('relay rejects unsupported fields/models, arbitrary image URLs, missing max tokens, authorization and exhausted grants before upstream',async t=>{
  let calls=0;const {relay,reservations}=await fixture(t,()=>{calls++;});
  for(const value of [{...body,provider:{url:'https://evil.invalid'}},{...body,model:'wrong'},{...body,max_tokens:undefined},{...body,messages:[{role:'user',content:[{type:'image_url',image_url:{url:'http://internal'}}]}]}])assert.equal((await post(relay,value)).status,400);
  assert.equal((await post(relay,body,{Authorization:'Bearer bad'})).status,401);assert.equal(calls,0);assert.equal(reservations.length,0);
  const denied=await fixture(t,()=>{calls++;},{grants:{reserve:async()=>{throw Object.assign(new Error(secret),{status:429});},assertActive:async()=>{}}});
  const response=await post(denied.relay);assert.equal(response.status,429);assert.ok(!(await response.text()).includes(secret));assert.equal(calls,0);
});

test('relay redacts HTTP errors, redirects and HTTP 200 SSE error events with no retries',async t=>{
  for(const kind of ['error','redirect','sse-error','named-error','late-error']) {
    let calls=0;
    const {relay,reservations}=await fixture(t,(req,res)=>{
      calls++;
      if(kind==='error') {res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:secret}));}
      else if(kind==='redirect') {res.writeHead(307,{Location:'http://127.0.0.1:9/'+secret});res.end();}
      else if(kind==='named-error') {res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('event: error\ndata: '+JSON.stringify({choices:[],message:secret})+'\n\n');}
      else {res.writeHead(200,{'Content-Type':'text/event-stream'});if(kind==='late-error')res.write('data: '+JSON.stringify(chunk)+'\n\n');res.end('data: '+JSON.stringify({error:{message:secret}})+'\n\n');}
    });
    const response=await post(relay),text=await response.text();assert.ok(!text.includes(secret));assert.ok(text.includes('Model request unavailable'));
    assert.equal(response.status,kind==='late-error'?200:502);assert.equal(calls,1);assert.equal(reservations.length,1);
  }
});

test('relay aborts upstream on grant revocation and client disconnect',async t=>{
  for(const mode of ['revoke','disconnect']) {
    let ended;const closed=new Promise(resolve=>{ended=resolve;});
    const {relay,revoke}=await fixture(t,(req,res)=>{
      res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: '+JSON.stringify(chunk)+'\n\n');res.once('close',ended);
    });
    const response=await post(relay),reader=response.body.getReader();await reader.read();
    if(mode==='revoke') {revoke();const next=await reader.read();assert.ok(new TextDecoder().decode(next.value).includes('Model request unavailable'));}
    else await reader.cancel();
    await Promise.race([closed,new Promise((_,reject)=>setTimeout(()=>reject(new Error('upstream not aborted')),1000))]);
  }
});

test('relay enforces response bytes, total duration, complete SSE and concurrent requests',async t=>{
  for(const mode of ['bytes','timeout','truncated']) {
    const {relay}=await fixture(t,(req,res)=>{
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      if(mode==='bytes')res.end('data: '+JSON.stringify({choices:[{delta:{content:'x'.repeat(9000)}}]})+'\n\n');
      if(mode==='truncated')res.end('data: '+JSON.stringify(chunk)+'\n\n');
    },{maxDurationMs:150});
    const response=await post(relay),text=await response.text();assert.ok(text.includes('Model request unavailable'));
    assert.ok(!text.includes('[DONE]'));
  }
  let release;const held=new Promise(resolve=>{release=resolve;});
  const {relay}=await fixture(t,async(req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: '+JSON.stringify(chunk)+'\n\n');await held;res.end('data: [DONE]\n\n');},{maxConcurrent:1});
  const first=await post(relay);assert.equal((await post(relay)).status,503);release();await first.text();
});


test('incomplete upload timeout releases the concurrent slot without client cooperation',async t=>{
  let calls=0;
  const {relay}=await fixture(t,(req,res)=>{calls++;res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: [DONE]\n\n');},{maxDurationMs:100,maxConcurrent:1});
  const slow=http.request(relay.origin+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,'Content-Length':'1000'}});
  t.after(()=>slow.destroy());
  const response=new Promise((resolve,reject)=>{slow.once('response',resolve);slow.once('error',reject);});
  slow.write('{');
  const timedOut=await response;assert.equal(timedOut.statusCode,504);timedOut.resume();await once(timedOut,'end');
  await new Promise(resolve=>setTimeout(resolve,20));
  const next=await post(relay);assert.equal(next.status,200);await next.text();assert.equal(calls,1);
});


test('oversized uploads cannot reserve budget or reach upstream',async t=>{
  let calls=0;const {relay,reservations}=await fixture(t,()=>{calls++;});
  const response=await post(relay,{...body,messages:[{role:'user',content:'x'.repeat(5000)}]});
  assert.equal(response.status,413);assert.equal(calls,0);assert.equal(reservations.length,0);
});
