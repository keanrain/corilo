import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { TodoStore } from '../storage.mjs';

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'corilo-todos-store-'));
  const stores = [];
  t.after(async () => { for (const store of stores) store.close(); await fs.rm(base, { recursive: true, force: true }); });
  const root = path.join(base, 'data');
  const open = async () => { const store = await TodoStore.open(root); stores.push(store); return store; };
  return { base, root, open, store: await open() };
}
const create = (store, title = '个人待办') => store.create({ requestId: randomUUID(), title });
const change = (store, task, patch) => store.update({ requestId: randomUUID(), id: task.id, expected: task.version, patch });

test('SQLite persists personal todos, linked paths and exact details through close/reopen', async t => {
  const { root, store, open } = await fixture(t);
  const identity = store.identity;
  const task = await store.create({ requestId: randomUUID(), title: '  写周报  ', body: '保留\r\n  详情  ', notePath: '项目/周报.md' });
  assert.equal(task.title, '写周报');
  assert.equal(task.status, 'open'); assert.equal(task.version, 1);
  assert.equal(task.body, '保留\r\n  详情  ');
  const completed = await change(store, task, { status: 'done' });
  assert.equal(completed.version, 2);
  assert.equal((await store.list()).items.length, 0);
  assert.equal((await store.list({ status: 'done' })).items[0].id, task.id);
  const reopened = await change(store, completed, { status: 'open' });
  const cancelled = await change(store, reopened, { status: 'cancelled', notePath: null });
  store.close();
  const again = await open();
  assert.equal(again.identity, identity);
  assert.deepEqual(await again.get(task.id), cancelled);
  assert.equal((await again.list({ status: 'cancelled' })).items[0].notePath, null);
  const exported = await again.export();
  assert.equal(exported.format, 'corilo-todos-v1'); assert.deepEqual(exported.items, [cancelled]);
  assert.ok(!JSON.stringify(exported).includes('requestId'));
  assert.ok((await fs.stat(path.join(root, 'todos.sqlite'))).isFile());
});

test('durable request receipts prevent duplicate creates and replay the original committed result', async t => {
  const { store, open } = await fixture(t);
  const args = { requestId: randomUUID(), title: '一次创建', body: '内容' };
  const original = await store.create(args);
  assert.deepEqual(await store.create(args), original);
  assert.deepEqual(await store.create({ ...args, requestId: args.requestId.toUpperCase() }), original);
  await assert.rejects(store.create({ ...args, title: '其他内容' }), { status: 409 });
  const update = { requestId: randomUUID(), id: original.id, expected: original.version, patch: { title: '修改后', status: 'done' } };
  const changed = await store.update(update);
  assert.deepEqual(await store.update({ ...update, patch: { status: 'done', title: '修改后' } }), changed);
  const later = await change(store, changed, { body: '更新详情' });
  store.close(); const again = await open();
  assert.deepEqual(await again.create(args), original, 'lost creation reply does not recreate or return a different version');
  assert.deepEqual(await again.update(update), changed, 'lost update reply replays its commit, even after a later edit');
  assert.deepEqual(await again.get(original.id), later);
  assert.equal((await again.list({ status: 'all' })).items.length, 1);
  await assert.rejects(again.update({ ...update, patch: { title: '新内容' } }), { status: 409 });
});

test('two SQLite connections serialize version checks and cancellation rolls back receipts and changes', async t => {
  const { store, open } = await fixture(t);
  const other = await open(), task = await create(store);
  const results = await Promise.allSettled([change(store, task, { title: 'A' }), change(other, task, { title: 'B' })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.status, 409);
  const current = await store.get(task.id);
  assert.equal(current.version, 2);
  const aborted = new AbortController(); aborted.abort();
  const requestId = randomUUID();
  await assert.rejects(store.create({ requestId, title: '取消的创建', signal: aborted.signal }), { name: 'AbortError' });
  const fresh = await store.create({ requestId, title: '取消的创建' });
  assert.equal(fresh.version, 1, 'cancelled request had no persisted receipt');
  let checks = 0;
  const committing = { throwIfAborted() { if (++checks === 3) throw Object.assign(new Error('cancel before commit'), { name: 'AbortError' }); } };
  const update = { requestId: randomUUID(), id: current.id, expected: current.version, patch: { status: 'done' } };
  await assert.rejects(store.update({ ...update, signal: committing }), { name: 'AbortError' });
  assert.deepEqual(await other.get(current.id), current);
  const succeeded = await store.update(update);
  assert.equal(succeeded.status, 'done'); assert.equal(succeeded.version, 3);
});

test('todo validation refuses unsafe note paths, invalid requests and unwanted scheduling fields', async t => {
  const { store } = await fixture(t);
  for (const value of ['../x.md', '/absolute.md', 'a/../x.md', '.hidden.md', 'a/.secret.md', 'a\\b.md', 'a//b.md', 'C:x.md', 'a.txt', 'a\n.md']) {
    await assert.rejects(store.create({ requestId: randomUUID(), title: '关联', notePath: value }), { status: 400 });
  }
  for (const args of [
    { requestId: 'not-a-uuid', title: '无效' }, { requestId: randomUUID(), title: '  ' },
    { requestId: randomUUID(), title: 'a'.repeat(201) }, { requestId: randomUUID(), title: '内容', body: null },
    { requestId: randomUUID(), title: '内容', body: 'a'.repeat(20001) },
    { requestId: randomUUID(), title: '不自动提醒', reminder: 'tomorrow' },
  ]) await assert.rejects(store.create(args), { status: 400 });
  const task = await create(store);
  for (const edits of [{}, { status: 'running' }, { due: 'tomorrow' }, { title: '' }]) await assert.rejects(change(store, task, edits), { status: 400 });
  await assert.rejects(store.update({ requestId: randomUUID(), id: task.id, expected: 0, patch: { status: 'done' } }), { status: 400 });
  await assert.rejects(store.get(randomUUID()), { status: 404 });
});

test('invalid Unicode is rejected before SQLite changes or receipts, while successful Unicode round-trips exactly', async t => {
  for (const field of ['title', 'body', 'notePath']) {
    const { store, open } = await fixture(t);
    const requestId = randomUUID();
    const malformed = field === 'notePath' ? '项目/\ud800.md' : '\ud800';
    await assert.rejects(store.create({ requestId, title: '新建', [field]: malformed }), { status: 400 });
    assert.equal((await store.list({ status: 'all' })).items.length, 0);
    const created = await store.create({ requestId, title: '有效📝', body: '中文𠮷\r\n详情', notePath: '项目/📝.md' });
    assert.deepEqual(await store.get(created.id), created);
    const updateId = randomUUID();
    await assert.rejects(store.update({ requestId: updateId, id: created.id, expected: created.version, patch: { [field]: malformed } }), { status: 400 });
    assert.deepEqual(await store.get(created.id), created, 'rejected update preserves text and version');
    const changed = await store.update({ requestId: updateId, id: created.id, expected: created.version, patch: { body: '成功𠮷😀' } });
    assert.deepEqual(await store.get(created.id), changed);
    assert.equal(changed.body, '成功𠮷😀');
    store.close();
    const again = await open();
    assert.deepEqual(await again.get(created.id), changed);
    assert.deepEqual(await again.update({ requestId: updateId, id: created.id, expected: created.version, patch: { body: '成功𠮷😀' } }), changed);
    await assert.rejects(again.list({ query: '\ud800' }), { status: 400 });
  }
});

test('bounded keyset pages and literal search have no duplicates and bind cursors to filter and store', async t => {
  const { store, base } = await fixture(t);
  for (let i = 0; i < 205; i++) await create(store, `${i} 中文 needle%_`);
  const first = await store.list();
  assert.equal(first.items.length, 100); assert.equal(first.hasMore, true);
  const second = await store.list({ cursor: first.nextCursor });
  const third = await store.list({ cursor: second.nextCursor });
  assert.equal(third.items.length, 5); assert.equal(third.hasMore, false); assert.equal(third.nextCursor, null);
  assert.equal(new Set([...first.items, ...second.items, ...third.items].map(item => item.id)).size, 205);
  assert.equal((await store.list({ query: 'NEEDLE%_' })).items.length, 100);
  assert.equal((await store.list({ query: '%not-a-wildcard' })).items.length, 0);
  await assert.rejects(store.list({ cursor: first.nextCursor, status: 'all' }), { status: 400 });
  await assert.rejects(store.list({ cursor: first.nextCursor, query: 'different' }), { status: 400 });
  const other = await TodoStore.open(path.join(base, 'other')); t.after(() => other.close());
  await assert.rejects(other.list({ cursor: first.nextCursor }), { status: 400 });
  await assert.rejects(store.list({ cursor: 'invalid' }), { status: 400 });
  await assert.rejects(store.list({ query: 'x'.repeat(257) }), { status: 400 });
  const exported = await store.export(); assert.equal(exported.items.length, 205);
});

test('private database roots reject links, sidecar links, overlap and unknown formats without changing data', async t => {
  const { base, root, store } = await fixture(t);
  await create(store); store.close();
  await assert.rejects(TodoStore.open(root, { notesRoot: root }), { status: 400 });
  await assert.rejects(TodoStore.open(path.join(root, 'nested'), { notesRoot: root }), { status: 400 });
  const alias = path.join(base, 'alias'); await fs.symlink(root, alias);
  await assert.rejects(TodoStore.open(alias), { status: 400 });
  const victim = path.join(base, 'victim'); await fs.writeFile(victim, 'outside remains');
  await fs.symlink(victim, path.join(root, 'todos.sqlite-wal'));
  await assert.rejects(TodoStore.open(root), { status: 400 });
  assert.equal(await fs.readFile(victim, 'utf8'), 'outside remains');
  await fs.unlink(path.join(root, 'todos.sqlite-wal'));
  await fs.link(path.join(root, 'todos.sqlite'), path.join(base, 'hard.sqlite'));
  await assert.rejects(TodoStore.open(root), { status: 400 });
  await fs.unlink(path.join(base, 'hard.sqlite'));
  const db = new DatabaseSync(path.join(root, 'todos.sqlite')); db.exec('PRAGMA user_version=99'); db.close();
  const original = await fs.readFile(path.join(root, 'todos.sqlite'));
  await assert.rejects(TodoStore.open(root), { status: 400 });
  assert.deepEqual(await fs.readFile(path.join(root, 'todos.sqlite')), original);
});

test('an in-place database identity switch blocks an old service before writing', async t => {
  const { root, store } = await fixture(t);
  const task = await create(store);
  const external = new DatabaseSync(path.join(root, 'todos.sqlite'));
  external.prepare('UPDATE metadata SET identity=? WHERE id=1').run(randomUUID()); external.close();
  await assert.rejects(change(store, task, { title: 'cannot write switched database' }), { status: 503 });
});

test('JSON export fails explicitly at item and byte limits instead of silently truncating', async t => {
  const { root, store } = await fixture(t);
  const seed = new DatabaseSync(path.join(root, 'todos.sqlite'));
  const insert = seed.prepare("INSERT INTO todos VALUES (?, 'synthetic', ?, NULL, 'open', 1, ?, ?)");
  const now = new Date().toISOString(); seed.exec('BEGIN');
  for (let i = 0; i < 10001; i++) insert.run(randomUUID(), '', now, now);
  seed.exec('COMMIT');
  await assert.rejects(store.export(), { status: 413 });
  seed.exec('DELETE FROM todos; BEGIN');
  for (let i = 0; i < 450; i++) insert.run(randomUUID(), 'x'.repeat(20000), now, now);
  seed.exec('COMMIT'); seed.close();
  await assert.rejects(store.export(), { status: 413 });
});
