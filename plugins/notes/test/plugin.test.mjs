import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import Tools from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline';
import * as notes from '../index.mjs';

test('published Cordis and Harness pipeline load notes tools, validate calls and unload registrations', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'corilo-plugin-'));
  const ctx=new Context();
  t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});});
  await ctx.plugin(SystemPrompt);await ctx.plugin(Tools);
  const fiber=await ctx.plugin(notes,{root});
  assert.equal(ctx.tools.definitions().length,7);
  const pipeline=new ToolExecutionPipeline(ctx);
  let callId=0;
  const call=async(name,args,signal=new AbortController().signal)=>{
    const prepared=await pipeline.prepare({callId:String(++callId),name,arguments:args,signal});
    const dispatched=prepared.kind==='dispatch'?await pipeline.dispatch(prepared.exec):prepared;
    return pipeline.complete(prepared.exec,dispatched);
  };
  const saved=await call('corilo_notes_save',{path:'项目/测试.md',text:'原文',expected:null});
  assert.equal(saved.isError,false,JSON.stringify(saved));
  const listed=await call('corilo_notes_list',{});
  assert.deepEqual(listed.value.items.map(x=>x.path),['项目/测试.md']);
  const read=await call('corilo_notes_read',{path:'项目/测试.md'});
  assert.equal(read.value.text,'原文');
  const updated=await call('corilo_notes_save',{path:read.value.path,text:'更新',expected:read.value.version});
  assert.equal(updated.isError,false,JSON.stringify(updated));
  const browsed=await call('corilo_notes_browse',{});
  assert.equal(browsed.isError,false);assert.equal(browsed.value.items[0].path,read.value.path);
  const searched=await call('corilo_notes_search',{query:'更新'});
  assert.equal(searched.isError,false);assert.ok(searched.value.items.some(x=>x.path===read.value.path && x.kind==='content'));
  const conflict=await call('corilo_notes_save',{path:read.value.path,text:'不能覆盖',expected:read.value.version});
  assert.equal(conflict.isError,true);
  assert.equal(await readFile(path.join(root,read.value.path),'utf8'),'更新');
  assert.ok(!ctx.tools.definitions().some(x=>x.name==='corilo_notes_capture'));
  assert.equal((await call('corilo_notes_read',{path:123})).isError,true);
  assert.equal((await call('corilo_notes_read',{path:'../private.md'})).isError,true);
  const abort=new AbortController();abort.abort();
  assert.equal((await call('corilo_notes_save',{path:'cancelled.md',text:'no',expected:null},abort.signal)).isError,true);
  const renamed=await call('corilo_notes_rename',{path:read.value.path,to:'项目/已重命名.md',expected:updated.value.version});
  assert.equal(renamed.isError,false,JSON.stringify(renamed));
  assert.equal(renamed.value.path,'项目/已重命名.md');
  assert.equal(await readFile(path.join(root,renamed.value.path),'utf8'),'更新');
  assert.equal((await call('corilo_notes_read',{path:read.value.path})).isError,true);
  assert.equal((await call('corilo_notes_rename',{path:renamed.value.path,to:'other.md',expected:updated.value.version})).isError,true);
  const created=await call('corilo_notes_create',{});
  assert.equal(created.isError,false,JSON.stringify(created));
  assert.equal(created.value.path,'未命名.md');
  assert.equal(created.value.text,'');
  assert.equal(await readFile(path.join(root,created.value.path),'utf8'),'');
  const seeded=await call('corilo_notes_create',{text:'\uFEFF初始原话\r\n  空白  '});
  assert.equal(seeded.isError,false,JSON.stringify(seeded));
  assert.equal(seeded.value.path,'未命名 2.md');
  assert.equal(await readFile(path.join(root,seeded.value.path),'utf8'),'\uFEFF初始原话\r\n  空白  ');
  assert.equal((await call('corilo_notes_create',{},abort.signal)).isError,true);
  const final=await call('corilo_notes_list',{});
  assert.equal(final.value.items.length,3);
  await fiber.dispose();
  assert.equal(ctx.tools.definitions().length,0,'unloading cleans up real registry effects');
  assert.equal((await call('corilo_notes_list',{})).isError,true);
});

const waitFor = async (check, label) => {
  for (let n = 0; n < 100; n++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error(`Timed out waiting for ${label}`);
};
const bootWithWorkspaceController = async (t, controller, extra = {}) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'corilo-workspace-'));
  const ctx = new Context();
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); });
  await ctx.plugin(SystemPrompt); await ctx.plugin(Tools);
  if (controller) ctx.provide('workspaceController', controller);
  await ctx.plugin(notes, { root, ...extra });
  return { ctx, root };
};

test('registers the notes root as a DSH workspace through the optional workspaceController', async t => {
  const calls = [];
  const { ctx, root } = await bootWithWorkspaceController(t, { create: async request => { calls.push(request); return { workspace: { id: 'w' }, created: true }; } });
  await waitFor(() => calls.length > 0, 'workspace create');
  assert.deepEqual(calls, [{ path: root }]);
  assert.equal(ctx.tools.definitions().length, 7);
});

test('registers the workspace for the classic interface too', async t => {
  const calls = [];
  await bootWithWorkspaceController(t, { create: async request => { calls.push(request); return { workspace: {}, created: false }; } }, { interface: 'classic' });
  await waitFor(() => calls.length === 1, 'workspace create');
});

test('works unchanged when workspaceController is absent', async t => {
  const { ctx } = await bootWithWorkspaceController(t, null);
  assert.equal(ctx.tools.definitions().length, 7);
});

test('a failing workspace registration only warns and keeps the tools', async t => {
  let attempted = 0;
  const { ctx } = await bootWithWorkspaceController(t, { create: async () => { attempted++; throw new Error('boom'); } });
  await waitFor(() => attempted > 0, 'workspace create attempt');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(ctx.tools.definitions().length, 7);
  const sync = await bootWithWorkspaceController(t, { create() { throw new Error('sync boom'); } });
  assert.equal(sync.ctx.tools.definitions().length, 7);
});
