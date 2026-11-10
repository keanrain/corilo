import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TodoStore } from '../storage.mjs';
import { coreTodos } from '../core.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'corilo-current-todos-'));
  const store = await TodoStore.open(root);
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  return { store, core: coreTodos(store) };
}

test('core interface removes retired capabilities while preserving legacy records and associations', async t => {
  const { store, core } = await fixture(t);
  const linked = await store.create({ requestId: randomUUID(), title: '旧关联', notePath: '资料/原文.md' });
  const old = await store.create({ requestId: randomUUID(), title: '旧取消记录', body: '原样保留' });
  const cancelled = await store.update({ requestId: randomUUID(), id: old.id, expected: old.version, patch: { status: 'cancelled' } });
  const listed = await core.list({ status: 'all' });
  assert.deepEqual(listed.items.map(item => item.id), [linked.id]);
  assert.equal(Object.hasOwn(await core.get(linked.id), 'notePath'), false);
  const update = { requestId: randomUUID(), id: linked.id, expected: linked.version, patch: { body: '只改说明' } };
  const changed = await core.update(update);
  assert.deepEqual(await core.update(update), changed, 'original UUID still replays its receipt');
  assert.equal((await store.get(linked.id)).notePath, '资料/原文.md');
  await assert.rejects(core.create({ requestId: randomUUID(), title: '禁止关联', notePath: 'new.md' }), { status: 400 });
  await assert.rejects(core.update({ requestId: randomUUID(), id: linked.id, expected: changed.version, patch: { status: 'cancelled' } }), { status: 400 });
  await assert.rejects(core.list({ status: 'cancelled' }), { status: 400 });
  await assert.rejects(core.get(cancelled.id), { status: 404 });
  const denied = randomUUID();
  await assert.rejects(core.update({ requestId: denied, id: cancelled.id, expected: cancelled.version, patch: { status: 'open' } }), { status: 404 });
  const exported = await core.export();
  assert.equal(exported.format, 'corilo-todos-v1');
  assert.deepEqual(exported.items.find(item => item.id === cancelled.id), cancelled);
  assert.equal(exported.items.find(item => item.id === linked.id).notePath, '资料/原文.md');
  assert.deepEqual(await store.get(cancelled.id), cancelled);
  // Rejected operations must not reserve a receipt or mutate the old record.
  assert.equal((await core.create({ requestId: denied, title: '有效新记录' })).title, '有效新记录');
});

test('current pagination filters retired rows in SQLite rather than returning empty filtered pages', async t => {
  const { store, core } = await fixture(t);
  const active = [];
  for (let n = 0; n < 105; n++) active.push(await core.create({ requestId: randomUUID(), title: `当前 ${n}` }));
  for (let n = 0; n < 110; n++) {
    const old = await store.create({ requestId: randomUUID(), title: `存量 ${n}` });
    await store.update({ requestId: randomUUID(), id: old.id, expected: old.version, patch: { status: 'cancelled' } });
  }
  const first = await core.list({ status: 'all' });
  assert.equal(first.items.length, 100);
  assert.equal(first.hasMore, true);
  const second = await core.list({ status: 'all', cursor: first.nextCursor });
  assert.equal(second.items.length, 5);
  assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, active.length);
  await assert.rejects(store.list({ status: 'all', cursor: first.nextCursor }), { status: 400 });
  assert.equal((await core.export()).items.length, 215);
});
