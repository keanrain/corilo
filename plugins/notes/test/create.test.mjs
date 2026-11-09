import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NotesStore } from '../storage.mjs';

async function fixture(t, recovery = false) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'corilo-create-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'notes'), stateRoot = path.join(base, 'state');
  return { root, stateRoot, store: await NotesStore.open(root, {}, recovery ? { stateRoot } : {}) };
}

test('new documents use available readable names and persist exact initial text and empty history', async t => {
  const { root, stateRoot, store } = await fixture(t, true);
  const first = await store.create();
  assert.deepEqual(first, { path: '未命名.md', text: '', version: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' });
  const text = '\uFEFF原话\r\n  前后空白  \n';
  const next = await store.create({ text });
  assert.equal(next.path, '未命名 2.md');
  assert.equal(next.text, text);
  assert.equal(await fs.readFile(path.join(root, next.path), 'utf8'), text);
  const concurrent = await Promise.all([store.create(), store.create()]);
  assert.deepEqual(concurrent.map(note => note.path), ['未命名 3.md', '未命名 4.md']);
  const reopened = await NotesStore.open(root, {}, { stateRoot });
  assert.deepEqual(await reopened.read(first.path), first);
  assert.deepEqual(await reopened.read(next.path), next);
  assert.equal((await reopened.list()).items.length, 4);
  const checkpoint = (await reopened.history(first.path)).items[0];
  assert.equal((await reopened.readRevision(first.path, checkpoint.revision)).text, '');
  await assert.rejects(store.capture(''), { status: 400 }, 'create does not loosen raw capture validation');
  await assert.rejects(store.create({ text: '\ud800' }), { status: 400 });
  await assert.rejects(store.create({ text: 'a'.repeat(1024 * 1024 + 1) }), { status: 413 });
});

test('name selection skips occupied links, directories and oversized notes without reading them', async t => {
  const { root, store } = await fixture(t);
  const privateFile = path.join(path.dirname(root), 'outside.txt');
  await fs.writeFile(privateFile, 'unchanged external content');
  await fs.symlink(privateFile, path.join(root, '未命名.md'));
  await fs.mkdir(path.join(root, '未命名 2.md'));
  await fs.link(privateFile, path.join(root, '未命名 3.md'));
  await fs.writeFile(path.join(root, '未命名 4.md'), Buffer.alloc(1024 * 1024 + 1));
  const read = store.readFile.bind(store), reads = [];
  store.readFile = filename => { reads.push(path.basename(filename)); return read(filename); };
  assert.equal((await store.create()).path, '未命名 5.md');
  assert.deepEqual(reads, ['未命名 5.md']);
  assert.equal(await fs.readFile(privateFile, 'utf8'), 'unchanged external content');
  const relocated = path.join(path.dirname(root), 'old-notes');
  await fs.rename(root, relocated);
  await fs.symlink(relocated, root);
  await assert.rejects(store.create(), { status: 400 }, 'root link validation remains mandatory');
});

test('only exclusive name collisions retry; cancellation, unrelated conflicts and the 1000-name bound stay final', async t => {
  const { root, store } = await fixture(t);
  const write = store.write.bind(store);
  let first = true;
  store.write = async (...args) => {
    if (first) { first = false; await fs.writeFile(path.join(root, args[0]), 'external competing create'); }
    return write(...args);
  };
  assert.equal((await store.create()).path, '未命名 2.md');
  assert.equal(await fs.readFile(path.join(root, '未命名.md'), 'utf8'), 'external competing create');
  let attempts = 0;
  store.write = async () => { attempts++; throw Object.assign(Error('synthetic non-occupancy conflict'), { status: 409 }); };
  await assert.rejects(store.create(), /non-occupancy/);
  assert.equal(attempts, 1);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(store.create({ signal: aborted.signal }), { status: 409 });
  assert.equal(attempts, 1);
  store.write = write;
  await Promise.all(Array.from({ length: 998 }, (_, index) => fs.writeFile(path.join(root, `未命名 ${index + 3}.md`), '')));
  await assert.rejects(store.create(), error => error.status === 409 && error.message.includes('1000'));
  assert.equal((await fs.readdir(root)).length, 1000);
});

test('creation stops before commit on cancellation and exposes the published path on partial failure', async t => {
  const { root, store } = await fixture(t, true);
  const check = store.recovery.check.bind(store.recovery), abort = new AbortController();
  store.recovery.check = async (...args) => { await check(...args); abort.abort(); };
  await assert.rejects(store.create({ signal: abort.signal }), { status: 409 });
  assert.deepEqual(await fs.readdir(root), []);
  store.recovery.check = check;
  const snapshot = store.recovery.snapshot.bind(store.recovery), committed = new AbortController();
  store.recovery.snapshot = async (...args) => { const result = await snapshot(...args); committed.abort(); return result; };
  const saved = await store.create({ text: 'commit survives cancellation', signal: committed.signal });
  assert.equal((await store.read(saved.path)).text, 'commit survives cancellation');
  store.recovery.snapshot = async () => { throw Error('synthetic history confirmation failure'); };
  await assert.rejects(store.create(), error => error.status === 503 && error.committed === true && error.path === '未命名 2.md');
  assert.deepEqual(await store.read('未命名 2.md'), { path: '未命名 2.md', text: '', version: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' });
  assert.equal((await fs.readdir(root)).length, 2, 'a partial commit never retries into another name');
});
