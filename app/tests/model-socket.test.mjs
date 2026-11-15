import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { startModelRelay } from '../cloud/model-relay.mjs';

const token='a'.repeat(64);
const config={apiKey:'synthetic-platform-secret',allowedModels:['deepseek-flash'],maxRequestBytes:4096,maxResponseBytes:4096,maxDurationMs:1000,maxConcurrent:1};
test('relay Unix listener is private, serves model path only and leaves existing paths intact',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'corilo-socket-'));
  let relay,calls=0;
  t.after(async()=>{await relay?.close();await fs.rm(dir,{recursive:true,force:true});});
  const socketPath=path.join(dir,'m.sock');
  const options={...config,socketPath,grants:{reserve:async received=>{assert.equal(received,token);calls++;},assertActive:async()=>{}},
    fetchImpl:async()=>new Response('data: {"choices":[]}\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}})};
  await fs.writeFile(socketPath,'must remain');
  await assert.rejects(startModelRelay(options),/already exists/);
  assert.equal(await fs.readFile(socketPath,'utf8'),'must remain');await fs.unlink(socketPath);
  relay=await startModelRelay(options);
  assert.equal(relay.origin,null);assert.equal((await fs.stat(socketPath)).mode&0o777,0o600);
  const request=route=>new Promise((resolve,reject)=>{
    const req=http.request({socketPath,path:route,method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token}},res=>{
      let text='';res.setEncoding('utf8');res.on('data',part=>text+=part);res.on('end',()=>resolve({status:res.statusCode,text}));res.on('error',reject);
    });req.on('error',reject);req.end(JSON.stringify({model:'deepseek-flash',messages:[{role:'user',content:'synthetic'}],max_tokens:8,stream:true}));
  });
  assert.equal((await request('/v1/chat/completions')).status,200);
  assert.equal((await request('/containers/json')).status,404);assert.equal(calls,1);
  await relay.close();relay=null;await assert.rejects(fs.lstat(socketPath),{code:'ENOENT'});
  await fs.chmod(dir,0o755);await assert.rejects(startModelRelay(options),/Private canonical/);
});
