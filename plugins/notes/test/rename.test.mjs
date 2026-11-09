import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NotesStore } from '../storage.mjs';

const status = value => error => error.status === value;
async function fixture(t, recovery = true) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'corilo-rename-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'notes'), stateRoot = path.join(base, 'state');
  return { root, stateRoot, store: await NotesStore.open(root, {}, recovery ? { stateRoot } : {}) };
}

test('same-directory rename preserves exact bytes and discovers anchored earlier names across restart', async t => {
  const { root, stateRoot, store } = await fixture(t);
  const text = '\uFEFF原话\r\n  前后空白  \n';
  const first = await store.save({ path: '项目/原名.md', text, expected: null });
  const initialHistory = await store.history(first.path);
  const second = await store.rename({ path: first.path, to: '项目/第二个名字.markdown', expected: first.version });
  assert.equal(second.previousPath, first.path);
  assert.equal(second.previousRevision, initialHistory.items[0].revision);
  assert.equal(second.text, text); assert.equal(second.version, first.version);
  assert.equal(await fs.readFile(path.join(root, second.path), 'utf8'), text);
  await assert.rejects(fs.access(path.join(root, first.path)), error => error.code === 'ENOENT');
  assert.equal((await fs.lstat(path.join(root, second.path))).nlink, 1);
  const third = await store.rename({ path: second.path, to: '项目/最终.md', expected: second.version });
  // Reuse of an old filename must not mix its newer note into the earlier
  // note's history link. The recorded anchor, not today's tip, is authoritative.
  await store.save({ path: first.path, text: '另一篇笔记', expected: null });
  const reopened = await NotesStore.open(root, {}, { stateRoot });
  const current = (await reopened.history(third.path)).items[0];
  assert.equal(current.operation, 'rename'); assert.equal(current.previousPath, second.path);
  const middle = (await reopened.history(current.previousPath, { at: current.previousRevision })).items[0];
  assert.equal(middle.previousPath, first.path);
  const earlier = await reopened.history(middle.previousPath, { at: middle.previousRevision });
  assert.equal(earlier.items.length, 1);
  assert.equal((await reopened.readRevision(first.path, earlier.items[0].revision)).text, text);
  assert.equal((await reopened.read(third.path)).text, text);
  await assert.rejects(reopened.history(third.path, { at: middle.previousRevision }), status(404));
  await assert.rejects(reopened.history(first.path, { at: middle.previousRevision, cursor: (await reopened.history(first.path)).items[0].revision }), status(404));
});

test('rename rejects stale versions, occupied names, different directories and unsafe source/target paths', async t => {
  const { root, store } = await fixture(t, false);
  const original = await store.save({ path: '原名.md', text: '原文', expected: null });
  const occupied = await store.save({ path: '已有.md', text: '不能覆盖', expected: null });
  await assert.rejects(store.rename({ path: original.path, to: occupied.path, expected: original.version }), status(409));
  assert.equal((await store.read(occupied.path)).text, '不能覆盖');
  await assert.rejects(store.rename({ path: original.path, to: '新名.md', expected: '0'.repeat(64) }), status(409));
  await assert.rejects(store.rename({ path: original.path, to: '其他目录/新名.md', expected: original.version }), status(400));
  await assert.rejects(store.rename({ path: original.path, to: original.path, expected: original.version }), status(400));
  for (const to of ['../越界.md', '.隐藏.md', 'NUL.md', 'bad.txt', '软链接.md']) {
    if (to === '软链接.md') {
      await fs.symlink(path.join(root, occupied.path), path.join(root, to));
      await assert.rejects(store.rename({ path: original.path, to, expected: original.version }), status(409));
    } else await assert.rejects(store.rename({ path: original.path, to, expected: original.version }), status(400));
  }
  await fs.link(path.join(root, occupied.path), path.join(root, '硬链接.md'));
  await assert.rejects(store.rename({ path: '硬链接.md', to: '新名.md', expected: occupied.version }), status(400));
  assert.equal((await store.read(original.path)).text, '原文');
  const renamed = await store.rename({ path: original.path, to: '无需历史.md', expected: original.version });
  assert.equal(renamed.previousRevision, null);
  assert.equal((await store.read(renamed.path)).text, '原文');
});

test('rename cancels before publication, completes after publication and reports partial confirmation honestly', async t => {
  const { root, store } = await fixture(t);
  const original = await store.save({ path: '原名.md', text: '原文', expected: null });
  const snapshot = store.recovery.snapshot.bind(store.recovery);
  const before = new AbortController();
  store.recovery.snapshot = async (...args) => { const result = await snapshot(...args); before.abort(); return result; };
  await assert.rejects(store.rename({ path: original.path, to: '取消.md', expected: original.version, signal: before.signal }), status(409));
  await assert.rejects(fs.access(path.join(root, '取消.md')), error => error.code === 'ENOENT');
  const after = new AbortController();
  store.recovery.snapshot = async (...args) => { const result = await snapshot(...args); if (args[2] === 'rename') after.abort(); return result; };
  const renamed = await store.rename({ path: original.path, to: '提交后.md', expected: original.version, signal: after.signal });
  assert.equal((await store.read(renamed.path)).text, '原文');
  store.recovery.snapshot = async (...args) => { if (args[2] === 'rename') throw Error('synthetic history failure'); return snapshot(...args); };
  await assert.rejects(store.rename({ path: renamed.path, to: '部分完成.md', expected: renamed.version }), error => error.status === 503 && error.committed === true && error.path === '部分完成.md');
  assert.equal((await store.read(renamed.path)).text, '原文');
  assert.equal((await store.read('部分完成.md')).text, '原文');
  assert.ok((await fs.readdir(root)).every(name => !name.startsWith('.corilo-')));
});

test('a concurrently created destination is never overwritten and an externally changed source is retained', async t => {
  const { root, store } = await fixture(t);
  const original = await store.save({ path: '原名.md', text: '原文', expected: null });
  const snapshot = store.recovery.snapshot.bind(store.recovery);
  store.recovery.snapshot = async (...args) => {
    const result = await snapshot(...args);
    if (args[2] === 'before') await fs.writeFile(path.join(root, '竞争.md'), '外部新建');
    return result;
  };
  await assert.rejects(store.rename({ path: original.path, to: '竞争.md', expected: original.version }), status(409));
  assert.equal(await fs.readFile(path.join(root, '竞争.md'), 'utf8'), '外部新建');
  assert.equal((await store.read(original.path)).text, '原文');
  store.recovery.snapshot = async (...args) => {
    const result = await snapshot(...args);
    if (args[2] === 'rename') await fs.writeFile(path.join(root, original.path), '外部较新内容');
    return result;
  };
  await assert.rejects(store.rename({ path: original.path, to: '副本.md', expected: original.version }), error => error.status === 503 && error.committed === true);
  assert.equal((await store.read(original.path)).text, '外部较新内容');
  assert.equal((await store.read('副本.md')).text, '原文');
});
