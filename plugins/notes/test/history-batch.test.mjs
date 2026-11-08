import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NotesStore } from '../storage.mjs';
import { seedTrash } from './git-fixture.mjs';

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'corilo-history-batch-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  return NotesStore.open(path.join(base, 'notes'), {}, { stateRoot: path.join(base, 'state') });
}

test('real Git history batches bounded metadata and paginates all old versions', async t => {
  const store = await fixture(t), history = store.recovery;
  const seeded = await seedTrash(store, 225);
  const run = history.run.bind(history), check = history.check.bind(history);
  let calls = 0, checks = 0;
  history.run = (...args) => { calls++; return run(...args); };
  history.check = (...args) => { checks++; return check(...args); };
  let page = await history.history(seeded.path);
  assert.equal(calls, 4);
  assert.equal(checks, 4);
  assert.equal(page.items.length, 100);
  const ids = page.items.map(item => item.revision);
  while (page.hasMore) {
    page = await history.history(seeded.path, { cursor: page.nextCursor });
    ids.push(...page.items.map(item => item.revision));
  }
  assert.equal(page.nextCursor, null);
  assert.equal(ids.length, 225);
  assert.deepEqual([...ids].sort(), seeded.ids);
  assert.equal((await history.read(seeded.path, ids.at(-1))).text, seeded.text);
  assert.deepEqual((await history.history(seeded.path, { cursor: ids.at(-1) })).items, []);
  await assert.rejects(history.history(seeded.path, { cursor: '--help' }), { status: 400 });
  await assert.rejects(history.history(seeded.path, { cursor: '0'.repeat(40) }), { status: 404 });
  await assert.rejects(history.history('wrong.md', { cursor: ids[0] }), { status: 404 });
  calls = checks = 0;
  assert.equal((await history.trashItems()).items.length, 100);
  assert.equal(calls, 3);
  assert.equal(checks, 3);
});

test('maintenance preserves all refs, old restorations and unreachable objects', async t => {
  const store = await fixture(t), history = store.recovery;
  const seeded = await seedTrash(store, 125);
  const loose = (await history.run(['hash-object', '-w', '--stdin'], 'packed reachable content', 256)).toString().trim();
  await history.run(['update-ref', 'refs/corilo/test-reachable', loose], undefined, 256);
  const loosePath = path.join(history.repo, 'objects', loose.slice(0, 2), loose.slice(2));
  assert.equal((await fs.stat(loosePath)).isFile(), true);
  const orphan = (await history.run(['hash-object', '-w', '--stdin'], 'unreachable synthetic data', 256)).toString().trim();
  const objects = await history.run(['cat-file', '--batch-all-objects', '--batch-check'], undefined, 65536);
  const before = await history.run(['for-each-ref', '--format=%(refname) %(objectname)'], undefined, 65536);
  assert.deepEqual(await history.maintain(), { packed: true, historyPruned: false });
  assert.deepEqual(await history.run(['for-each-ref', '--format=%(refname) %(objectname)'], undefined, 65536), before);
  assert.deepEqual(await history.run(['cat-file', '--batch-all-objects', '--batch-check'], undefined, 65536), objects);
  await assert.rejects(fs.stat(loosePath), { code: 'ENOENT' });
  assert.equal((await history.run(['cat-file', 'blob', loose], undefined, 256)).toString(), 'packed reachable content');
  assert.equal((await history.run(['cat-file', 'blob', orphan], undefined, 256)).toString(), 'unreachable synthetic data');
  for (const id of [seeded.ids[0], seeded.ids.at(-1)]) assert.equal((await history.readTrash(id)).text, seeded.text);
  const copy = await store.restoreTrash({ id: seeded.ids[60], path: 'old-restored.md', expected: null });
  assert.equal((await store.read(copy.path)).text, seeded.text);
  assert.equal((await history.history(seeded.path)).hasMore, true);
});

test('batch preflight rejects noncommits, oversized and malformed metadata', async t => {
  const store = await fixture(t), history = store.recovery;
  const blob = (await history.run(['hash-object', '-w', '--stdin'], 'blob', 256)).toString().trim();
  await assert.rejects(history.commits([blob]), { status: 400 });
  const tree = (await history.run(['mktree'], `100644 blob ${blob}\tnote\n`, 256)).toString().trim();
  const oversized = (await history.run(['commit-tree', tree], 'x'.repeat(9000), 256)).toString().trim();
  await assert.rejects(history.commits([oversized]), { status: 413 });
  const invalid = (await history.run(['commit-tree', tree], 'null', 256)).toString().trim();
  await history.run(['update-ref', history.ref('bad.md'), invalid], undefined, 256);
  await assert.rejects(history.history('bad.md'), { status: 400 });
  const other = (await history.run(['commit-tree', tree], JSON.stringify({ format: 1, path: 'other.md', version: '0'.repeat(64), operation: 'save', time: 'now' }), 256)).toString().trim();
  await history.run(['update-ref', history.ref('other.md'), other], undefined, 256);
  await assert.rejects(history.history('other.md', { cursor: invalid }), { status: 404 });
  const malformedRef = 'refs/corilo/trash/' + 'f'.repeat(40);
  await history.run(['update-ref', malformedRef, invalid], undefined, 256);
  await assert.rejects(history.trashItems(), { status: 400 });
});

test('maintenance rejects a damaged pack before deleting its intact loose duplicate', async t => {
  const store = await fixture(t), history = store.recovery;
  await store.save({ path: 'kept.md', text: 'reachable note stays intact', expected: null });
  const text = 'synthetic unreachable blob with an intact loose duplicate';
  const id = (await history.run(['hash-object', '-w', '--stdin'], text, 256)).toString().trim();
  const loosePath = path.join(history.repo, 'objects', id.slice(0, 2), id.slice(2));
  const looseBefore = await fs.readFile(loosePath);
  const refsBefore = await history.run(['for-each-ref', '--format=%(refname) %(objectname)'], undefined, 65536);
  const pack = (await history.run(['pack-objects', path.join(history.repo, 'objects/pack/pack')], id + '\n', 256)).toString().trim();
  const packPath = path.join(history.repo, 'objects/pack', `pack-${pack}.pack`);
  const bytes = await fs.readFile(packPath);
  // Preserve the object header/index so batch-check still reports the same
  // ID/type/size, while the compressed body and pack checksum are invalid.
  bytes[20] ^= 255;
  await fs.chmod(packPath, 0o600);
  await fs.writeFile(packPath, bytes);
  await assert.rejects(history.maintain(), { status: 503 });
  assert.deepEqual(await fs.readFile(loosePath), looseBefore);
  assert.deepEqual(await history.run(['for-each-ref', '--format=%(refname) %(objectname)'], undefined, 65536), refsBefore);
  // Git may prefer the broken pack during lookup. Remove only the deliberately
  // corrupted test pack to demonstrate the preserved loose object is readable.
  await fs.unlink(packPath);
  await fs.unlink(packPath.replace(/\.pack$/, '.idx'));
  assert.equal((await history.run(['cat-file', 'blob', id], undefined, 256)).toString(), text);
  assert.equal((await store.read('kept.md')).text, 'reachable note stays intact');
});
