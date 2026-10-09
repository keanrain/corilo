import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import { startHost } from '../host/server.mjs';
import { createReadTool, createWriteTool, createEditTool } from '@earendil-works/pi-coding-agent';
async function fixture(t, options = {}) {
  const root = await mkdtemp(os.tmpdir() + '/corilo-test-');
  await mkdir(root+'/notes'); await writeFile(root+'/notes/笔记.md', '原始内容\n');
  const host = await startHost({ vault: root+'/notes', configDir: root+'/config', ...options });
  t.after(async () => { await host.close(); await rm(root, { recursive: true, force: true }); });
  const request = (route, { data, ...options } = {}) => fetch(host.origin + route, {
    ...options, headers: { 'X-Corilo-Token': host.token, ...(data ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    ...(data ? { body: JSON.stringify(data), method: 'POST' } : {}),
  });
  return { root, host, request };
}
test('real Pi SDK and UI HTTP share the same disk; local history captures edits', async t => {
  const { host, request, root } = await fixture(t);
  assert.equal((await (await request('/api/state')).json()).model.startsWith('deepseek/'), true);
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
test('capture makes a real file and commit without a model call; unavailable model preserves request', async t => {
  const { request, root } = await fixture(t);
  const response = await request('/api/capture',{data:{text:'只保存原话'}}); assert.equal(response.status,200);
  const result = await response.json(); assert.equal(await readFile(root+'/notes/'+result.path,'utf8'),'只保存原话');
  const state = await (await request('/api/state')).json(); assert.deepEqual(state.messages,[]);
  if (!process.env.DEEPSEEK_API_KEY) assert.equal((await request('/api/agent/prompt',{data:{text:'hello'}})).status,400);
});
test('Pi configuration uses its own default auth storage and persists credentials (no network model call)', async t => {
  const { request, root, host } = await fixture(t);
  assert.equal((await request('/api/model',{data:{apiKey:'synthetic-test-not-a-real-key'}})).status,200);
  const auth = JSON.parse(await readFile(root+'/config/pi/auth.json','utf8'));
  assert.equal(auth.deepseek.type,'api_key'); assert.equal(auth.deepseek.key,'synthetic-test-not-a-real-key');
  assert.doesNotMatch(await host.vault.git(['ls-files']),/auth/);
});
test('rename collision preserves both source and destination', async t => {
  const { root, request } = await fixture(t);
  await writeFile(root+'/notes/目标.md','目标内容');
  assert.equal((await request('/api/fs/rename',{data:{from:'笔记.md',to:'目标.md'}})).status,409);
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
  await assert.rejects(startHost({vault:root+'/notes',configDir:root+'/config2'}),/占用/);
});
