import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { NotesStore } from '../storage.mjs';
import { seedTrash } from './git-fixture.mjs';

const exec = promisify(execFile);
const status = code => error => error.status === code;
async function fixture(t, limits) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'corilo-recovery-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'notes'), stateRoot = path.join(base, 'private');
  return { base, root, stateRoot, store: await NotesStore.open(root, limits, { stateRoot }) };
}

test('separate bare Git keeps exact checkpoints, external preimages and version-checked restores across restart', async t => {
  const { root, stateRoot, store } = await fixture(t);
  const text = '\uFEFF中文\r\n  exact original  ';
  const first = await store.save({ path: '项目/笔记.md', text, expected: null });
  assert.deepEqual((await fs.readdir(root)).sort(), ['项目']);
  const git = await exec('git', [`--git-dir=${path.join(stateRoot, 'history.git')}`, 'rev-parse', '--is-bare-repository']);
  assert.equal(git.stdout.trim(), 'true');
  const firstHistory = await store.history(first.path);
  assert.equal(firstHistory.items.length, 1);
  assert.equal(firstHistory.items[0].operation, 'save');
  assert.equal((await store.readRevision(first.path, firstHistory.items[0].revision)).text, text);
  await fs.writeFile(path.join(root, first.path), '外部编辑器新版本\n');
  const external = await store.read(first.path);
  await store.save({ path: first.path, text: '插件新版本', expected: external.version });
  const history = await store.history(first.path);
  assert.equal(history.items.length, 3);
  assert.equal(history.items[1].operation, 'before');
  assert.equal((await store.readRevision(first.path, history.items[1].revision)).text, external.text);
  await assert.rejects(store.restore({ path: first.path, revision: firstHistory.items[0].revision, expected: external.version }), status(409));
  const current = await store.read(first.path);
  const restored = await store.restore({ path: first.path, revision: firstHistory.items[0].revision, expected: current.version });
  assert.equal(restored.version, first.version);
  const reopened = await NotesStore.open(root, {}, { stateRoot });
  assert.equal((await reopened.read(first.path)).text, text);
  assert.equal((await reopened.history(first.path)).items[0].operation, 'restore');
  await assert.rejects(reopened.readRevision('another.md', firstHistory.items[0].revision), status(404));
  await assert.rejects(reopened.readRevision(first.path, '--help'), status(400));
});

test('trash persists before removal, restores exact content without overwriting and survives restart', async t => {
  const { root, stateRoot, store } = await fixture(t);
  const first = await store.save({ path: '笔记.md', text: '\uFEFFtrash\r\n', expected: null });
  await assert.rejects(store.trash({ path: first.path, expected: '0'.repeat(64) }), status(409));
  assert.equal((await store.listTrash()).items.length, 0);
  const deleted = await store.trash({ path: first.path, expected: first.version });
  await assert.rejects(store.read(first.path), status(404));
  const reopened = await NotesStore.open(root, {}, { stateRoot });
  assert.deepEqual((await reopened.listTrash()).items.map(x => [x.id, x.path, x.originalPresent]), [[deleted.id, first.path, false]]);
  const occupied = await reopened.save({ path: first.path, text: 'occupied', expected: null });
  await assert.rejects(reopened.restoreTrash({ id: deleted.id, path: first.path, expected: null }), status(409));
  assert.equal((await reopened.read(first.path)).version, occupied.version);
  const copy = await reopened.restoreTrash({ id: deleted.id, path: '恢复/副本.md', expected: null });
  assert.equal(copy.version, first.version);
  assert.equal((await reopened.read(copy.path)).text, '\uFEFFtrash\r\n');
  assert.equal((await reopened.listTrash()).items.length, 0);
  await assert.rejects(reopened.restoreTrash({ id: deleted.id, path: 'again.md', expected: null }), status(404));
});

test('more than 1000 real trash records paginate without duplicates and direct recovery bypasses enumeration', async t => {
  const { store } = await fixture(t);
  const seeded = await seedTrash(store, 1001);
  const first = await store.listTrash();
  assert.equal(first.items.length, 100);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextCursor, seeded.ids[99]);
  assert.deepEqual(first.items.map(item => item.id), seeded.ids.slice(0, 100));
  // A consumed cursor remains valid after its record is restored/removed.
  const restored = await store.restoreTrash({ id: first.nextCursor, path: 'recovered.md', expected: null });
  assert.equal(restored.version, seeded.version);
  assert.equal((await store.read(restored.path)).text, seeded.text);
  await assert.rejects(store.restoreTrash({ id: seeded.ids.at(-1), path: restored.path, expected: null }), status(409));
  const seen = first.items.map(item => item.id);
  let page = first;
  do {
    page = await store.listTrash({ cursor: page.nextCursor });
    assert.ok(page.items.length <= 100);
    seen.push(...page.items.map(item => item.id));
  } while (page.hasMore);
  assert.equal(page.nextCursor, null);
  assert.deepEqual(seen, seeded.ids);
  assert.equal(new Set(seen).size, 1001);
  await assert.rejects(store.listTrash({ cursor: '--help' }), status(400));
  assert.deepEqual(await store.listTrash({ cursor: 'f'.repeat(40) }), { items: [], hasMore: false, nextCursor: null });
  const enumerate = store.recovery.trashItems;
  store.recovery.trashItems = () => { throw new Error('direct restore must not enumerate trash'); };
  await store.restoreTrash({ id: seeded.ids.at(-1), path: 'direct.md', expected: null });
  store.recovery.trashItems = enumerate;
  assert.equal((await store.read('direct.md')).text, seeded.text);
});

test('trash lookup rejects mismatched ref targets, non-trash commits and commits outside note ancestry', async t => {
  const { store } = await fixture(t);
  const a = await store.save({ path: 'a.md', text: 'a', expected: null });
  const deleted = await store.trash({ path: a.path, expected: a.version });
  const b = await store.save({ path: 'b.md', text: 'b', expected: null });
  const other = (await store.history(b.path)).items[0].revision;
  await store.recovery.run(['update-ref', `refs/corilo/trash/${deleted.id}`, other], undefined, 256);
  await assert.rejects(store.listTrash(), status(400));
  await assert.rejects(store.restoreTrash({ id: deleted.id, path: 'bad.md', expected: null }), status(400));
  await store.recovery.run(['update-ref', `refs/corilo/trash/${deleted.id}`, deleted.id], undefined, 256);
  await store.recovery.putTrash(other);
  await assert.rejects(store.restoreTrash({ id: other, path: 'bad.md', expected: null }), status(400));
  await store.recovery.run(['update-ref', store.recovery.ref(a.path), other], undefined, 256);
  await assert.rejects(store.restoreTrash({ id: deleted.id, path: 'bad.md', expected: null }), status(404));
  const unsafe = await store.recovery.snapshot('../outside.md', 'unsafe path', 'trash');
  await store.recovery.putTrash(unsafe);
  await assert.rejects(store.restoreTrash({ id: unsafe, path: 'bad.md', expected: null }), status(400));
  await assert.rejects(store.read('bad.md'), status(404));
});

test('state roots are bound to one knowledge root and reject nesting, links, hardlinks, special files and altered Git config', async t => {
  const { base, root, stateRoot, store } = await fixture(t);
  await assert.rejects(NotesStore.open(path.join(base, 'other'), {}, { stateRoot }), status(400));
  await assert.rejects(NotesStore.open(root, {}, { stateRoot: path.join(root, '.history') }), status(400));
  await assert.rejects(NotesStore.open(root, {}, { stateRoot: base }), status(400));
  const outside = path.join(base, 'outside'); await fs.mkdir(outside);
  await fs.symlink(outside, path.join(base, 'state-link'));
  await assert.rejects(NotesStore.open(root, {}, { stateRoot: path.join(base, 'state-link') }), status(400));
  await fs.writeFile(path.join(outside, 'secret'), 'private');
  await fs.symlink(path.join(outside, 'secret'), path.join(stateRoot, 'unsafe'));
  await assert.rejects(store.history('a.md'), status(400));
  await fs.unlink(path.join(stateRoot, 'unsafe'));
  await exec('mkfifo', [path.join(stateRoot, 'unsafe')]);
  await assert.rejects(store.history('a.md'), status(400));
  await fs.unlink(path.join(stateRoot, 'unsafe'));
  await fs.link(path.join(outside, 'secret'), path.join(stateRoot, 'unsafe'));
  await assert.rejects(store.history('a.md'), status(400));
  await fs.unlink(path.join(stateRoot, 'unsafe'));
  const configPath = path.join(stateRoot, 'history.git', 'config');
  await fs.appendFile(configPath, '[include]\npath = /external/config\n');
  await assert.rejects(store.save({ path: 'a.md', text: 'not saved', expected: null }), status(400));
  await assert.rejects(fs.stat(path.join(root, 'a.md')), error => error.code === 'ENOENT');
});

test('trash listing treats unsafe replacement paths as occupied without reading them or blocking recovery', async t => {
  const { base, root, store } = await fixture(t, { maxBytes: 32 });
  const outside = path.join(base, 'outside.md');
  await fs.writeFile(outside, 'external target must remain unchanged');
  const cases = [
    ['oversized', async filename => fs.writeFile(filename, 'x'.repeat(64)), async filename => assert.equal((await fs.readFile(filename)).length, 64)],
    ['invalid-utf8', async filename => fs.writeFile(filename, Buffer.from([0xff])), async filename => assert.deepEqual(await fs.readFile(filename), Buffer.from([0xff]))],
    ['directory', async filename => fs.mkdir(filename), async filename => assert.equal((await fs.lstat(filename)).isDirectory(), true)],
    ['symlink', async filename => fs.symlink(outside, filename), async filename => assert.equal(await fs.readlink(filename), outside)],
  ];
  for (const [kind, occupy, check] of cases) {
    const input = `${kind}.md`, filename = path.join(root, input);
    const first = await store.save({ path: input, text: `recover ${kind}`, expected: null });
    const deleted = await store.trash({ path: input, expected: first.version });
    await occupy(filename);
    const page = await store.listTrash();
    assert.equal(page.items.find(item => item.id === deleted.id)?.originalPresent, true, kind);
    await assert.rejects(store.restoreTrash({ id: deleted.id, path: input, expected: null }), error => [400, 409, 413].includes(error.status), kind);
    await check(filename);
    const restored = await store.restoreTrash({ id: deleted.id, path: `restored-${input}`, expected: null });
    assert.equal((await store.read(restored.path)).text, `recover ${kind}`);
    await check(filename);
  }
  assert.equal(await fs.readFile(outside, 'utf8'), 'external target must remain unchanged');
  // A linked ancestor must be reported as blocked without traversing it.
  const original = await store.save({ path: 'parent/child.md', text: 'nested recovery', expected: null });
  const deleted = await store.trash({ path: original.path, expected: original.version });
  await fs.rmdir(path.join(root, 'parent'));
  const outsideDirectory = path.join(base, 'outside-directory'); await fs.mkdir(outsideDirectory);
  await fs.symlink(outsideDirectory, path.join(root, 'parent'));
  assert.equal((await store.listTrash()).items.find(item => item.id === deleted.id)?.originalPresent, true);
  await assert.rejects(store.restoreTrash({ id: deleted.id, path: original.path, expected: null }), status(400));
  await assert.rejects(fs.lstat(path.join(outsideDirectory, 'child.md')), error => error.code === 'ENOENT');
  await store.restoreTrash({ id: deleted.id, path: 'restored-nested.md', expected: null });
  assert.equal((await store.read('restored-nested.md')).text, 'nested recovery');
  if (process.getuid?.() !== 0) {
    const protectedNote = await store.save({ path: 'private/child.md', text: 'permission recovery', expected: null });
    const protectedTrash = await store.trash({ path: protectedNote.path, expected: protectedNote.version });
    const privateDirectory = path.join(root, 'private');
    await fs.chmod(privateDirectory, 0);
    try {
      assert.equal((await store.listTrash()).items.find(item => item.id === protectedTrash.id)?.originalPresent, true);
      await store.restoreTrash({ id: protectedTrash.id, path: 'restored-permission.md', expected: null });
      assert.equal((await store.read('restored-permission.md')).text, 'permission recovery');
    } finally { await fs.chmod(privateDirectory, 0o700); }
  }
});

test('reserved hook/global-config paths are rejected and repository hooks are never executed', async t => {
  const { base, stateRoot, store } = await fixture(t);
  const sentinel = path.join(base, 'hook-executed');
  const hooks = path.join(stateRoot, 'history.git', 'hooks');
  await fs.mkdir(hooks);
  await fs.writeFile(path.join(hooks, 'reference-transaction'), '#!/bin/sh\ntouch "' + sentinel + '"\n', { mode: 0o700 });
  await store.save({ path: 'a.md', text: 'safe', expected: null });
  await assert.rejects(fs.stat(sentinel), error => error.code === 'ENOENT');
  await fs.mkdir(path.join(stateRoot, 'disabled-hooks'));
  await fs.writeFile(path.join(stateRoot, 'disabled-hooks', 'reference-transaction'), '#!/bin/sh\ntouch "' + sentinel + '"\n', { mode: 0o700 });
  await assert.rejects(store.history('a.md'), status(400));
  await fs.rm(path.join(stateRoot, 'disabled-hooks'), { recursive: true });
  await fs.writeFile(path.join(stateRoot, 'no-global-config'), '[include]\npath=/external/config\n');
  await assert.rejects(store.history('a.md'), status(400));
  await assert.rejects(fs.stat(sentinel), error => error.code === 'ENOENT');
});

test('trash cancellation after preparation preserves the live file and clears prepared trash receipt', async t => {
  const { store } = await fixture(t);
  const first = await store.save({ path: 'a.md', text: 'keep', expected: null });
  const abort = new AbortController(), put = store.recovery.putTrash.bind(store.recovery);
  store.recovery.putTrash = async id => { await put(id); abort.abort(); };
  await assert.rejects(store.trash({ path: first.path, expected: first.version, signal: abort.signal }), status(409));
  assert.equal((await store.read(first.path)).text, 'keep');
  assert.equal((await store.listTrash()).items.length, 0);
});

test('post-commit checkpoint failure reports partial completion and never pretends the written file was rolled back', async t => {
  const { root, store } = await fixture(t);
  const original = store.recovery.snapshot.bind(store.recovery);
  store.recovery.snapshot = async (input, text, operation) => {
    if (operation === 'save') throw new Error('injected Git I/O failure after Markdown commit');
    return original(input, text, operation);
  };
  await assert.rejects(store.save({ path: 'written.md', text: 'already committed', expected: null }), error => error.status === 503 && error.committed === true && error.message.includes('已写入'));
  assert.equal(await fs.readFile(path.join(root, 'written.md'), 'utf8'), 'already committed');
  assert.equal((await store.history('written.md')).items.length, 0, 'failed target checkpoint is not advertised');
});

test('preimage failure prevents overwrite and cancelled mutations keep notes and trash intact', async t => {
  const { root, stateRoot, store } = await fixture(t);
  const first = await store.save({ path: 'a.md', text: 'keep', expected: null });
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(store.trash({ path: first.path, expected: first.version, signal: cancelled.signal }), status(409));
  await assert.rejects(store.restore({ path: first.path, revision: (await store.history(first.path)).items[0].revision, expected: first.version, signal: cancelled.signal }), status(409));
  assert.equal((await store.listTrash()).items.length, 0);
  await fs.appendFile(path.join(stateRoot, 'history.git', 'config'), '# changed\n');
  await assert.rejects(store.save({ path: first.path, text: 'no', expected: first.version }), status(400));
  assert.equal(await fs.readFile(path.join(root, first.path), 'utf8'), 'keep');
});

test('missing recovery configuration fails explicitly and bounded revision reads reject oversized checkpoints', async t => {
  const { root, stateRoot, store } = await fixture(t);
  const note = await store.save({ path: 'a.md', text: '123456789', expected: null });
  const revision = (await store.history(note.path)).items[0].revision;
  const bounded = await NotesStore.open(root, { maxBytes: 8 }, { stateRoot });
  await assert.rejects(bounded.readRevision(note.path, revision), status(413));
  const plain = await NotesStore.open(root);
  await assert.rejects(plain.history(note.path), status(400));
  await assert.rejects(plain.listTrash(), status(400));
  await assert.rejects(plain.trash({ path: note.path, expected: note.version }), status(400));
});
