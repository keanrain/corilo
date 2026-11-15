import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Context } from '@deepseek-ai/cordis';
import Tools from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline';
import * as todos from '../index.mjs';
import { TodoStore } from '../storage.mjs';

test('published Cordis pipeline manages personal todos with idempotency, versions and clean unload', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'corilo-todos-pipeline-'));
  const ctx = new Context();
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); });
  await ctx.plugin(SystemPrompt); await ctx.plugin(Tools);
  const fiber = await ctx.plugin(todos, { root });
  assert.equal(ctx.tools.definitions().length, 5);
  const pipeline = new ToolExecutionPipeline(ctx);
  let callId = 0;
  const call = async (name, args, signal = new AbortController().signal) => {
    const prepared = await pipeline.prepare({ callId: String(++callId), name, arguments: args, signal });
    return pipeline.complete(prepared.exec, prepared.kind === 'dispatch' ? await pipeline.dispatch(prepared.exec) : prepared);
  };
  const args = { requestId: randomUUID(), title: '个人事项：读文章', body: '明天自己处理' };
  const created = await call('corilo_todos_create', args);
  assert.equal(created.isError, false, JSON.stringify(created));
  assert.equal(created.value.status, 'open');
  const repeated = await call('corilo_todos_create', args);
  assert.deepEqual(repeated.value, created.value);
  assert.equal((await call('corilo_todos_list', {})).value.items.length, 1);
  const read = (await call('corilo_todos_read', { id: created.value.id })).value;
  assert.equal(Object.hasOwn(read, 'notePath'), false);
  const complete = { requestId: randomUUID(), id: read.id, expected: read.version, patch: { status: 'done' } };
  const done = await call('corilo_todos_update', complete);
  assert.equal(done.isError, false, JSON.stringify(done));
  assert.equal(done.value.status, 'done');
  assert.deepEqual((await call('corilo_todos_update', complete)).value, done.value);
  assert.equal((await call('corilo_todos_update', { ...complete, requestId: randomUUID(), patch: { title: '旧版本不能覆盖' } })).isError, true);
  assert.equal((await call('corilo_todos_read', { id: 123 })).isError, true);
  assert.equal((await call('corilo_todos_update', { ...complete, patch: { reminders: true } })).isError, true);
  const cancelled = await call('corilo_todos_update', { requestId: randomUUID(), id: read.id, expected: done.value.version, patch: { status: 'cancelled' } });
  assert.equal(cancelled.isError, true);
  const linked = await call('corilo_todos_update', { requestId: randomUUID(), id: read.id, expected: done.value.version, patch: { notePath: 'old.md' } });
  assert.equal(linked.isError, true);
  const exported = await call('corilo_todos_export', {});
  assert.equal(exported.value.format, 'corilo-todos-v1');
  assert.equal(exported.value.items[0].status, 'done');
  const abort = new AbortController(); abort.abort();
  assert.equal((await call('corilo_todos_create', { requestId: randomUUID(), title: '已取消调用' }, abort.signal)).isError, true);
  await fiber.dispose();
  assert.equal(ctx.tools.definitions().length, 0);
  assert.equal((await call('corilo_todos_list', {})).isError, true);
  // Unload releases SQLite; a fresh service can read the committed records.
  const reopened = await TodoStore.open(root);
  try { assert.equal((await reopened.get(read.id)).status, 'done'); }
  finally { await reopened.close(); }
});
