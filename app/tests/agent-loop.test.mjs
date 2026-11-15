import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { startHost } from '../host/server.mjs';

test('real Pi loop executes default file tools against a local scripted model transport', async t => {
  const root = await mkdtemp(os.tmpdir()+'/corilo-loop-');
  let calls = 0; const requests = [];
  // This is a protocol fixture, not a real model or a product local-model feature.
  const model = http.createServer(async (req,res) => {
    let body=''; for await(const part of req) body+=part;
    const input=JSON.parse(body); requests.push(input); calls++;
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const delta = calls === 1
      ? {role:'assistant',tool_calls:[{index:0,id:'call_read',type:'function',function:{name:'read',arguments:JSON.stringify({path:'note.md'})}}]}
      : calls === 2
      ? {role:'assistant',tool_calls:[{index:0,id:'call_edit',type:'function',function:{name:'edit',arguments:JSON.stringify({path:'note.md',edits:[{oldText:'original',newText:'changed by Pi'}]})}}]}
      : {role:'assistant',content:'已修改 note.md'};
    const chunk={id:'fixture-'+calls,object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason:null}]};
    res.write('data: '+JSON.stringify(chunk)+'\n\n');
    res.write('data: '+JSON.stringify({...chunk,choices:[{index:0,delta:{},finish_reason:calls<3?'tool_calls':'stop'}]})+'\n\n');
    res.end('data: [DONE]\n\n');
  });
  await new Promise(r=>model.listen(0,'127.0.0.1',r));
  let host;
  t.after(async()=>{ if(host)await host.close(); model.closeAllConnections(); await new Promise(r=>model.close(r)); await rm(root,{recursive:true,force:true}); });
  await mkdir(root+'/notes'); await writeFile(root+'/notes/note.md','original\n');
  await mkdir(root+'/pi',{recursive:true});
  await writeFile(root+'/pi/models.json',JSON.stringify({providers:{fixture:{baseUrl:`http://127.0.0.1:${model.address().port}/v1`,api:'openai-completions',models:[{id:'fixture',contextWindow:32000,maxTokens:2048}]}}}));
  await writeFile(root+'/pi/settings.json',JSON.stringify({defaultProvider:'fixture',defaultModel:'fixture',defaultThinkingLevel:'off'}));
  const originalAuth = JSON.stringify({fixture:{type:'api_key',key:'synthetic-fixture'}});
  await writeFile(root+'/pi/auth.json',originalAuth);
  const originalSettings = await readFile(root+'/pi/settings.json','utf8');
  const originalModels = await readFile(root+'/pi/models.json','utf8');
  host=await startHost({vault:root+'/notes',configDir:root+'/config',piAgentDir:root+'/pi'});
  assert.deepEqual(host.agent.session.getActiveToolNames().sort(),['bash','edit','read','write']);
  const headers={'X-Corilo-Token':host.token,'Content-Type':'application/json'};
  assert.equal((await fetch(host.origin+'/api/agent/prompt',{method:'POST',headers,body:JSON.stringify({text:'Read note.md and change original to changed by Pi.'})})).status,202);
  let state;
  for(let i=0;i<200;i++){
    state=await(await fetch(host.origin+'/api/state',{headers})).json();
    if(!state.busy)break;
    await new Promise(r=>setTimeout(r,30));
  }
  assert.equal(state.busy,false); assert.equal(state.outcome,'completed',state.error);
  assert.equal(calls,3);
  assert.ok(requests[1].messages.some(m=>m.role==='tool' && JSON.stringify(m.content).includes('original')));
  assert.equal(await readFile(root+'/notes/note.md','utf8'),'changed by Pi\n');
  assert.ok(state.messages.some(m=>m.text.includes('已修改')));
  assert.ok(state.changed.includes('note.md'));
  assert.equal(await host.vault.git(['show','HEAD~1:note.md']),'original\n');
  await host.close(); host=null;
  host=await startHost({vault:root+'/notes',configDir:root+'/config',piAgentDir:root+'/pi'});
  assert.ok(host.agent.messages().some(m=>m.text.includes('已修改')),'Pi session restores after host restart');
  assert.equal(calls,3,'restart does not replay model requests');
  assert.equal(await readFile(root+'/pi/settings.json','utf8'),originalSettings);
  assert.equal(await readFile(root+'/pi/auth.json','utf8'),originalAuth);
  assert.equal(await readFile(root+'/pi/models.json','utf8'),originalModels);
  await assert.rejects(readFile(root+'/config/pi/models.json'),{code:'ENOENT'});
});
