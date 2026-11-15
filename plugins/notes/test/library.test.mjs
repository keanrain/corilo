import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NotesStore } from '../storage.mjs';
import { listPage, searchNotes, libraryLimits } from '../library.mjs';
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corilo-library-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, store: await NotesStore.open(root) };
}
const status = code => error => error.status === code;

test('metadata keyset browsing covers >2000 notes and >8MiB without reading bodies', async t => {
  const { root, store } = await fixture(t);
  await Promise.all(Array.from({ length: 2105 }, (_, i) => fs.writeFile(path.join(root, `${String(i).padStart(4, '0')}.md`), 'x'.repeat(4096))));
  store.readFile = () => { throw new Error('metadata must not read a body'); };
  const collected = []; let cursor = null, page;
  do {
    page = await listPage(store, { cursor });
    assert.ok(page.items.length <= 100);
    collected.push(...page.items.map(item => item.path)); cursor = page.nextCursor;
  } while (page.hasMore);
  assert.equal(collected.length, 2105); assert.equal(new Set(collected).size, 2105);
  assert.deepEqual(collected, [...collected].sort());
  assert.equal(page.nextCursor, null);
  const filtered = await listPage(store, { query: '210' });
  assert.deepEqual(filtered.items.map(x => x.path), ['0210.md', '1210.md', '2100.md', '2101.md', '2102.md', '2103.md', '2104.md']);
});

test('packaged ripgrep finds captured Chinese and English bodies with accurate lines and safe literal queries', async t => {
  const { root, store } = await fixture(t);
  const capture = await store.capture('第一行\r\n今天见到蓝鲸 Alpha. [literal]\r\n末行');
  await fs.writeFile(path.join(root, 'Alpha.md'), 'other\nALPHA again\n');
  const chinese = await searchNotes(store, { query: '蓝鲸' });
  assert.equal(chinese.truncated, false);
  assert.deepEqual(chinese.items, [{ path: capture.path, line: 2, text: '今天见到蓝鲸 Alpha. [literal]', kind: 'content' }]);
  const english = await searchNotes(store, { query: 'alpha' });
  assert.ok(english.items.some(x => x.path === 'Alpha.md' && x.kind === 'filename'));
  assert.ok(english.items.some(x => x.path === 'Alpha.md' && x.line === 2));
  assert.ok(english.items.some(x => x.path === capture.path && x.line === 2));
  assert.equal((await searchNotes(store, { query: '[literal]' })).items.length, 1);
  assert.equal((await searchNotes(store, { query: '--glob' })).items.length, 0);
  assert.deepEqual(await searchNotes(store, { query: 'absent' }), { items: [], truncated: false });
});

test('search results have explicit truncation and snippets around matches on long lines', async t => {
  const { root, store } = await fixture(t);
  await fs.writeFile(path.join(root, 'many.md'), Array.from({ length: 103 }, () => 'x'.repeat(500) + '蓝鲸' + 'z'.repeat(500)).join('\n'));
  const result = await searchNotes(store, { query: '蓝鲸' });
  assert.equal(result.items.length, 100); assert.equal(result.truncated, true);
  assert.ok(result.items.every(x => x.text.includes('蓝鲸') && x.text.length <= 242));
  assert.equal(result.items[99].line, 100);
});

test('common literal characters produce bounded positions instead of repeated match payloads', async t => {
  const { root, store } = await fixture(t);
  await fs.writeFile(path.join(root, 'lines.md'), Array.from({ length: 103 }, () => 'a'.repeat(4096)).join('\n'));
  const result = await store.search({ query: 'a' });
  assert.equal(result.items.length, 100);
  assert.equal(result.truncated, true);
  assert.equal(result.items[99].line, 100);
  assert.ok(result.items.every(item => item.text.length <= 242));
  await fs.writeFile(path.join(root, 'literal.md'), 'prefix [a].* suffix');
  const literal = await store.search({ query: '[a].*' });
  assert.deepEqual(literal.items, [{ path: 'literal.md', line: 1, text: 'prefix [a].* suffix', kind: 'content' }]);
});

test('browsing and search reject links, invalid cursors and cancellation without partial success', async t => {
  const { root, store } = await fixture(t);
  await fs.writeFile(path.join(root, 'safe.md'), 'safe');
  await fs.symlink(path.join(root, 'safe.md'), path.join(root, 'link.md'));
  for (const operation of [listPage, (s, o) => searchNotes(s, { ...o, query: 'safe' })]) await assert.rejects(operation(store), status(400));
  await fs.rm(path.join(root, 'link.md'));
  await fs.link(path.join(root, 'safe.md'), path.join(root, 'hard.md'));
  await assert.rejects(listPage(store), status(400)); await fs.rm(path.join(root, 'hard.md'));
  await assert.rejects(listPage(store, { cursor: '../bad.md' }), status(400));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(listPage(store, { signal: controller.signal }), status(409));
  await assert.rejects(searchNotes(store, { query: 'safe', signal: controller.signal }), status(409));
  await assert.rejects(searchNotes(store, { query: '' }), status(400));
  await fs.writeFile(path.join(root, 'large.md'), Buffer.alloc(store.limits.maxBytes + 1));
  assert.equal((await listPage(store)).items.length, 2);
  await assert.rejects(searchNotes(store, { query: 'safe' }), status(413));
});

test('scan ceilings are explicit and hidden files are excluded', async t => {
  const { root, store } = await fixture(t);
  await fs.mkdir(path.join(root, '.private'));
  await fs.writeFile(path.join(root, '.private', 'secret.md'), 'secret');
  assert.deepEqual((await listPage(store)).items, []);
  for (let offset = 0; offset < libraryLimits.maxEntries; offset += 100)
    await Promise.all(Array.from({ length: 100 }, (_, i) => fs.writeFile(path.join(root, `${offset + i}.txt`), '')));
  await assert.rejects(listPage(store), status(413));
});

test('body search passes the old 8MiB cliff and fails explicitly at its own 64MiB ceiling', async t => {
  const { root, store } = await fixture(t);
  const body = 'x'.repeat(900 * 1024);
  await Promise.all(Array.from({ length: 10 }, (_, i) => fs.writeFile(path.join(root, `${i}.md`), body)));
  const capture = await store.capture('蓝鲸');
  assert.equal((await searchNotes(store, { query: '蓝鲸' })).items[0].path, capture.path);
  await Promise.all(Array.from({ length: 64 }, (_, i) => fs.writeFile(path.join(root, `large-${i}.md`), body)));
  await assert.rejects(searchNotes(store, { query: '蓝鲸' }), status(413));
});
