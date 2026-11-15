import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import { startHost } from '../host/server.mjs';
import { createReadTool, createWriteTool, createEditTool } from '@earendil-works/pi-coding-agent';
async function fixture(t, options = {}) {
  const root = await mkdtemp(os.tmpdir() + '/corilo-test-');
  await mkdir(root+'/notes'); await writeFile(root+'/notes/笔记.md', '原始内容\n');
  const host = await startHost({ vault: root+'/notes', configDir: root+'/config', piAgentDir: root+'/pi', ...options });
  t.after(async () => { await host.close(); await rm(root, { recursive: true, force: true }); });
  const request = (route, { data, ...options } = {}) => fetch(host.origin + route, {
    ...options, headers: { 'X-Corilo-Token': host.token, ...(data ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    ...(data ? { body: JSON.stringify(data), method: 'POST' } : {}),
  });
  return { root, host, request };
}
test('real Pi SDK and UI HTTP share the same disk; local history captures edits', async t => {
  const { host, request, root } = await fixture(t);
  const response = await request('/api/fs/read?path=笔记.md');
  assert.equal(await response.text(), '原始内容\n');
  const write = await request('/api/fs/write?path=笔记.md', {method:'PUT',headers:{'If-Match':response.headers.get('X-Corilo-Etag')},body:'页面保存\n'});
  assert.equal(write.status,200);
  const toolResult = await createReadTool(host.vault.root).execute('read-1',{path:'笔记.md'},undefined);
  assert.ok(toolResult.content.some(c => c.text?.includes('页面保存')));
  await createEditTool(host.vault.root).execute('edit-1',{path:'笔记.md',edits:[{oldText:'页面保存',newText:'Pi 修改'}]},undefined);
  assert.equal(await (await request('/api/fs/read?path=笔记.md')).text(),'Pi 修改\n');
  await createWriteTool(host.vault.root).execute('write-1',{path:'新笔记.md',content:'真实 Pi 默认工具'},undefined);
  assert.equal(await (await request('/api/fs/read?path=新笔记.md')).text(),'真实 Pi 默认工具');
  assert.equal((await request('/api/checkpoint',{data:{}})).status,200);
  assert.match(await host.vault.git(['show','HEAD~1:笔记.md']),/原始内容/);
  assert.equal(await readFile(root+'/notes/笔记.md','utf8'),'Pi 修改\n');
  assert.doesNotMatch(await host.vault.git(['ls-files']),/auth|sessions|corilo-host/);
});
test('stale editor save conflicts without overwriting external changes', async t => {
  const { request, root } = await fixture(t);
  const old = await request('/api/fs/read?path=笔记.md');
  await writeFile(root+'/notes/笔记.md','外部修改');
  const response = await request('/api/fs/write?path=笔记.md',{method:'PUT',headers:{'If-Match':old.headers.get('X-Corilo-Etag')},body:'过期草稿'});
  assert.equal(response.status,409); assert.equal(await readFile(root+'/notes/笔记.md','utf8'),'外部修改');
});
test('host rejects untrusted origins, missing credentials, traversal and symlink escape', async t => {
  const { request, host, root } = await fixture(t);
  assert.equal((await fetch(host.origin+'/api/state')).status,401);
  assert.equal((await request('/api/state',{headers:{Origin:'https://evil.invalid'}})).status,403);
  assert.equal((await request('/api/fs/read?path=../config/pi/auth.json')).status,400);
  assert.equal((await request('/api/fs/read?path=.git/config')).status,400);
  await writeFile(root+'/outside','not accessible'); await symlink(root+'/outside',root+'/notes/link.md');
  assert.equal((await request('/api/fs/read?path=link.md')).status,400);
  assert.equal((await request('/api/fs/create',{data:{path:'CON.md',kind:'file'}})).status,400);
  assert.equal((await request('/api/fs/create',{data:{path:'Note.md',kind:'file'}})).status,200);
  assert.equal((await request('/api/fs/create',{data:{path:'note.md',kind:'file'}})).status,409);
});
test('capture makes a real file and commit without a model call', async t => {
  const { request, root } = await fixture(t);
  const response = await request('/api/capture',{data:{text:'只保存原话'}}); assert.equal(response.status,200);
  const result = await response.json(); assert.equal(await readFile(root+'/notes/'+result.path,'utf8'),'只保存原话');
  const state = await (await request('/api/state')).json(); assert.deepEqual(state.messages,[]);
});
test('Corilo has no model credential endpoint or duplicate auth files', async t => {
  const { request, root } = await fixture(t);
  assert.equal((await request('/api/model',{data:{apiKey:'synthetic-fixture'}})).status,404);
  await assert.rejects(readFile(root+'/config/pi/auth.json'), {code:'ENOENT'});
  assert.deepEqual(JSON.parse(await readFile(root+'/pi/auth.json','utf8')), {});
});
test('rename collision preserves both source and destination', async t => {
  const { root, request } = await fixture(t);
  await writeFile(root+'/notes/目标.md','目标内容');
  assert.equal((await request('/api/fs/rename',{data:{from:'笔记.md',to:'目标.md',expected:(await (await request('/api/fs/stat?path=笔记.md')).json()).version}})).status,409);
  assert.equal(await readFile(root+'/notes/笔记.md','utf8'),'原始内容\n');
  assert.equal(await readFile(root+'/notes/目标.md','utf8'),'目标内容');
});
test('host scheduler keeps UI writes out of an active agent run and checkpoints partial changes', async t => {
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  // Scheduling test double only; the real Pi file tools are exercised separately above.
  const agentFactory = vault => ({ init:async()=>{},messages:()=>[],close:async()=>{},stop:async()=>release(),
    prompt:async()=> { await hold; await writeFile(vault.root+'/partial.md','部分已完成'); throw new Error('injected tool failure'); } });
  const { request, root, host } = await fixture(t,{agentFactory});
  assert.equal((await request('/api/agent/prompt',{data:{text:'test'}})).status,202);
  assert.equal((await request('/api/fs/create',{data:{path:'blocked.md',kind:'file'}})).status,409);
  assert.equal((await request('/api/agent/prompt',{data:{text:'duplicate'}})).status,409);
  release();
  let state;
  for(let i=0;i<100;i++){ state=await (await request('/api/state')).json(); if(!state.busy)break; await new Promise(r=>setTimeout(r,20)); }
  assert.equal(state.busy,false); assert.equal(state.outcome,'failed'); assert.match(state.error,/injected/);
  assert.ok(state.changed.includes('partial.md'));
  assert.equal(await readFile(root+'/notes/partial.md','utf8'),'部分已完成');
  assert.match(await host.vault.git(['show','HEAD:partial.md']),/部分已完成/);
});
test('second host cannot open the same vault', async t => {
  const { root } = await fixture(t);
  await assert.rejects(startHost({vault:root+'/notes',configDir:root+'/config2',piAgentDir:root+'/pi'}),/占用/);
});

test('Pi config inside the vault is rejected before any Git history is created', async t => {
  const root=await mkdtemp(os.tmpdir()+'/corilo-placement-');
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(root+'/notes/pi',{recursive:true});
  await writeFile(root+'/notes/pi/auth.json','{"fixture":{"type":"api_key","key":"synthetic"}}');
  await assert.rejects(startHost({vault:root+'/notes',configDir:root+'/config',piAgentDir:root+'/notes/pi'}),/Pi 配置目录/);
  await assert.rejects(readFile(root+'/notes/.git/HEAD'),{code:'ENOENT'});
});

test('sync serializes writes and agent starts while state remains readable', async t => {
  let release, entered;
  const hold=new Promise(r=>{release=r;}), started=new Promise(r=>{entered=r;});
  const syncFactory=()=>({phase:'pending',init:async()=>{},state:()=>({phase:'syncing',conflicts:[]}),run:async()=>{entered(); await hold; return {};}});
  const {request}=await fixture(t,{syncFactory});
  const running=request('/api/sync/run',{data:{}}); await started;
  try {
    assert.equal((await request('/api/state')).status,200);
    assert.equal((await (await request('/api/state')).json()).syncing,true);
    assert.equal((await request('/api/fs/create',{data:{path:'blocked.md',kind:'file'}})).status,409);
    assert.equal((await request('/api/agent/prompt',{data:{text:'blocked'}})).status,409);
    assert.equal((await request('/api/sync/run',{data:{}})).status,409);
  } finally { release(); }
  assert.equal((await running).status,200);
  assert.equal((await request('/api/fs/create',{data:{path:'allowed.md',kind:'file'}})).status,200);
});

test('knowledge export preserves original files and empty directories without exporting host secrets', async t => {
  const { root, request, host } = await fixture(t);
  await mkdir(root+'/notes/附件'); await mkdir(root+'/notes/空目录');
  const binary = Buffer.from([0, 1, 255, 42]);
  await writeFile(root+'/notes/附件/原图.bin', binary);
  await writeFile(root+'/notes/.private', 'hidden-secret');
  await writeFile(root+'/config/secret', 'host-secret');
  assert.equal((await fetch(host.origin+'/api/export/knowledge')).status, 401);
  assert.equal((await request('/api/export/knowledge', { headers: { Origin: 'https://evil.invalid' } })).status, 403);
  const response = await request('/api/export/knowledge');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/zip');
  const { unzipSync } = await import('fflate');
  const archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
  assert.equal(Buffer.from(archive['knowledge/笔记.md']).toString(), '原始内容\n');
  assert.deepEqual(Buffer.from(archive['knowledge/附件/原图.bin']), binary);
  assert.ok(archive['knowledge/空目录/']);
  assert.deepEqual(Object.keys(archive).sort(), ['README.txt','knowledge/','knowledge/空目录/','knowledge/笔记.md','knowledge/附件/','knowledge/附件/原图.bin','manifest.json'].sort());
  const manifest = JSON.parse(Buffer.from(archive['manifest.json']).toString());
  const { createHash } = await import('node:crypto');
  for (const file of manifest.files) {
    const data = archive['knowledge/'+file.path];
    assert.equal(data.length, file.bytes);
    assert.equal(createHash('sha256').update(data).digest('hex'), file.sha256);
  }
  assert.ok(manifest.excluded.includes('conversations'));
  await symlink(root+'/config/secret', root+'/notes/leak.txt');
  assert.equal((await request('/api/export/knowledge')).status, 400);
});

test('knowledge export rejects capacity limits and refuses an active agent', async t => {
  const { root, host, request } = await fixture(t);
  const { exportKnowledge } = await import('../host/export.mjs');
  await assert.rejects(exportKnowledge(host.vault, { maxBytes: 1 }), e => e.status === 413);
  await assert.rejects(exportKnowledge(host.vault, { maxEntries: 0 }), e => e.status === 413);
  let release;
  host.agent.ensureReady = async () => {};
  host.agent.prompt = () => new Promise(resolve => { release = resolve; });
  host.agent.stop = async () => release?.();
  assert.equal((await request('/api/agent/prompt', { data: { text: 'export concurrency check' } })).status, 202);
  assert.equal((await request('/api/export/knowledge')).status, 409);
  await request('/api/agent/stop', { data: {} });
});

test('destructive operations require the observed file/tree version and serialize competing moves', async t => {
  const { request, root } = await fixture(t);
  const stat = async p => (await request('/api/fs/stat?path='+encodeURIComponent(p))).json();
  const old = (await stat('笔记.md')).version;
  for (const [route,data] of [['remove',{path:'笔记.md'}],['rename',{from:'笔记.md',to:'moved.md'}]])
    assert.equal((await request('/api/fs/'+route,{data})).status,409);
  await writeFile(root+'/notes/笔记.md','另一设备的新内容');
  assert.equal((await request('/api/fs/remove',{data:{path:'笔记.md',expected:old}})).status,409);
  assert.equal((await request('/api/fs/rename',{data:{from:'笔记.md',to:'moved.md',expected:old}})).status,409);
  assert.equal(await readFile(root+'/notes/笔记.md','utf8'),'另一设备的新内容');
  await mkdir(root+'/notes/目录'); await writeFile(root+'/notes/目录/child.md','原文');
  const tree = (await stat('目录')).version;
  await writeFile(root+'/notes/目录/child.md','已更新');
  assert.equal((await request('/api/fs/remove',{data:{path:'目录',recursive:true,expected:tree}})).status,409);
  assert.equal((await request('/api/fs/rename',{data:{from:'目录',to:'目录2',expected:tree}})).status,409);
  const updated = (await stat('目录')).version;
  await writeFile(root+'/notes/目录/added.md','新增');
  assert.equal((await request('/api/fs/remove',{data:{path:'目录',recursive:true,expected:updated}})).status,409);
  const expected = (await stat('目录')).version;
  const results = await Promise.all(['目录2','目录3'].map(to => request('/api/fs/rename',{data:{from:'目录',to,expected}})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,404]);
  const target = results[0].status === 200 ? '目录2':'目录3';
  assert.equal(await readFile(root+'/notes/'+target+'/child.md','utf8'),'已更新');
  assert.equal((await request('/api/fs/remove',{data:{path:target,recursive:true,expected:(await stat(target)).version}})).status,200);
  await assert.rejects(readFile(root+'/notes/'+target+'/child.md'),{code:'ENOENT'});
});

test('Linux host restarts after SIGKILL without stealing a live lock', {skip:process.platform!=='linux'}, async t => {
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const root = await mkdtemp(os.tmpdir()+'/corilo-crash-');
  const options={mode:'cloud-files',vault:root+'/notes',configDir:root+'/config',piAgentDir:root+'/pi'};
  const child=spawn(process.execPath,['--input-type=module','-e',
    `import { startHost } from './app/host/server.mjs'; await startHost(JSON.parse(process.argv[1])); console.log('READY');`,JSON.stringify(options)],{stdio:['ignore','pipe','pipe']});
  let recovered;
  t.after(async()=>{ if(child.exitCode===null && child.signalCode===null) { const done=once(child,'exit'); child.kill('SIGKILL'); await done; } await recovered?.close(); await rm(root,{recursive:true,force:true}); });
  await new Promise((resolve,reject)=>{ child.stdout.once('data',resolve); child.once('error',reject); child.once('exit',()=>reject(new Error('child exited before startup'))); });
  await assert.rejects(startHost(options),/占用/);
  const done=once(child,'exit'); child.kill('SIGKILL'); await done;
  const attempts=await Promise.allSettled([startHost(options),startHost(options)]);
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
  recovered=attempts.find(r=>r.status==='fulfilled').value;
  assert.equal((await fetch(recovered.origin+'/api/state',{headers:{'X-Corilo-Token':recovered.token}})).status,200);
  assert.doesNotMatch(await recovered.vault.git(['ls-files']),/corilo-host/);
});


test('Linux file host refuses ambiguous or legacy crash markers', {skip:process.platform!=='linux'}, async t => {
  const root=await mkdtemp(os.tmpdir()+'/corilo-unknown-lock-');
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(root+'/notes');
  const options={mode:'cloud-files',vault:root+'/notes',configDir:root+'/config',piAgentDir:root+'/pi'};
  for (const marker of ['', 'unknown', '2147483647', 'cloud-files:'+process.pid]) {
    await writeFile(root+'/notes/.corilo-host.lock',marker);
    await assert.rejects(startHost(options),/占用/);
    assert.equal(await readFile(root+'/notes/.corilo-host.lock','utf8'),marker);
  }
});
