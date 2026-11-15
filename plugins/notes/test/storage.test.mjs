import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NotesStore } from '../storage.mjs';
async function fixture(t, limits) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corilo-notes-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, store: await NotesStore.open(root, limits) };
}
const status = code => error => error.status === code;

test('portable notes persist exact text, versioned edits reject stale writes and captures never collide', async t => {
  const { root, store } = await fixture(t);
  const text = '\uFEFF中文原话\r\n  保留空白\n';
  const original = await store.save({ path: '资料/第一篇.md', text, expected: null });
  assert.match(original.version, /^[a-f0-9]{64}$/);
  assert.deepEqual(await store.read(original.path), { ...original, text });
  assert.equal(await fs.readFile(path.join(root, original.path), 'utf8'), text);
  await assert.rejects(store.save({ path: original.path, text: 'overwrite', expected: null }), status(409));
  await assert.rejects(store.save({ path: original.path, text: 'missing expected' }), status(409));
  const update = await store.save({ path: original.path, text: '新版本', expected: original.version });
  await assert.rejects(store.save({ path: original.path, text: 'stale', expected: original.version }), status(409));
  assert.equal((await store.read(original.path)).text, '新版本');
  const reopened = await NotesStore.open(root);
  assert.equal((await reopened.read(original.path)).version, update.version);
  const captures = await Promise.all(Array.from({ length: 4 }, () => store.capture(text)));
  assert.equal(new Set(captures.map(x => x.path)).size, 4);
  for (const capture of captures) assert.equal((await store.read(capture.path)).text, text);
  const list = await store.list();
  assert.equal(list.items.length, 5);
  assert.ok(list.items.every(x => x.size > 0 && /^[a-f0-9]{64}$/.test(x.version)));
  await fs.writeFile(path.join(root, original.path), 'external editor');
  await assert.rejects(store.save({ path: original.path, text: 'overwrite external', expected: update.version }), status(409));
  await assert.rejects(store.capture('\ud800'), status(400));
});

test('notes reject traversal, hidden paths, links and unsafe files without disclosing host paths', async t => {
  const { root, store } = await fixture(t);
  for (const input of ['../private.md', '/absolute.md', '.git/config.md', 'a/../note.md', 'a//note.md', 'a\\note.md', 'NUL.md', 'file.txt', 'a/b. /note.md', 'x\0.md'])
    await assert.rejects(store.save({ path: input, text: 'unsafe', expected: null }), status(400));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'corilo-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const privateFile = path.join(outside, 'private.md'); await fs.writeFile(privateFile, 'PRIVATE');
  await fs.symlink(outside, path.join(root, 'linked'));
  await assert.rejects(store.read('linked/private.md'), status(400));
  await assert.rejects(store.save({ path: 'linked/new.md', text: 'no', expected: null }), status(400));
  await assert.rejects(fs.stat(path.join(outside, 'new.md')), e => e.code === 'ENOENT');
  await fs.rm(path.join(root, 'linked'));
  await fs.symlink(privateFile, path.join(root, 'symlink.md'));
  await assert.rejects(store.read('symlink.md'), status(400));
  await assert.rejects(store.list(), status(400)); await fs.rm(path.join(root, 'symlink.md'));
  await fs.link(privateFile, path.join(root, 'hardlink.md'));
  await assert.rejects(store.read('hardlink.md'), status(400));
  await assert.rejects(store.save({ path: 'hardlink.md', text: 'no', expected: null }), status(400));
  await fs.rm(path.join(root, 'hardlink.md'));
  await fs.mkdir(path.join(root, 'directory.md'));
  await assert.rejects(store.read('directory.md'), status(400));
  const invalid = await store.read('absent/secret.md').catch(e => e);
  assert.equal(invalid.status, 404); assert.ok(!invalid.message.includes(root));
  await fs.symlink(outside, path.join(root, 'root-link'));
  await assert.rejects(NotesStore.open(path.join(root, 'root-link')), status(400));
});

test('bounded listing and read reject oversize/invalid data instead of silently returning partial notes', async t => {
  const { root, store } = await fixture(t, { maxBytes: 8, maxEntries: 2, maxTotalBytes: 10 });
  await assert.rejects(store.save({ path: 'large.md', text: '123456789', expected: null }), status(413));
  await fs.writeFile(path.join(root, 'large.md'), '123456789');
  await assert.rejects(store.read('large.md'), status(413)); await fs.rm(path.join(root, 'large.md'));
  await fs.writeFile(path.join(root, 'bad.md'), Buffer.from([0xff]));
  await assert.rejects(store.read('bad.md'), status(400)); await fs.rm(path.join(root, 'bad.md'));
  await store.save({ path: 'a.md', text: '123456', expected: null });
  await store.save({ path: 'b.md', text: '123456', expected: null });
  await assert.rejects(store.list(), status(413));
  await fs.writeFile(path.join(root, 'c.md'), '1');
  await assert.rejects(store.list(), status(413));
});

test('managed concurrent writes use one version and a queued aborted save does not modify text', async t => {
  const { store } = await fixture(t);
  const note = await store.save({ path: 'note.md', text: 'original', expected: null });
  const results = await Promise.allSettled([
    store.save({ path: note.path, text: 'one', expected: note.version }),
    store.save({ path: note.path, text: 'two', expected: note.version }),
  ]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(results.find(x => x.status === 'rejected').reason.status, 409);
  const current = await store.read(note.path), abort = new AbortController();
  const queued = store.save({ path: note.path, text: 'cancelled', expected: current.version, signal: abort.signal });
  abort.abort(); await assert.rejects(queued, status(409));
  assert.equal((await store.read(note.path)).text, current.text);
});
