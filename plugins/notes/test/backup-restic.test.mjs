import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { NotesStore } from '../storage.mjs';
import { prepareRestore } from '../restore.mjs';

const exec = promisify(execFile);
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'corilo-backup-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const original = path.join(base, 'original'), root = path.join(original, 'notes'), stateRoot = path.join(original, 'state');
  const store = await NotesStore.open(root, {}, { stateRoot });
  await store.save({ path: '中文.md', text: '\uFEFF第一版\r\n  原话  ', expected: null });
  const before = await store.read('中文.md');
  await store.save({ path: '中文.md', text: '第二版', expected: before.version });
  const gone = await store.capture('回收站中的原话');
  await store.trash({ path: gone.path, expected: gone.version });
  const attachment = randomBytes(4096);
  await fs.mkdir(path.join(root, '附件'));
  await fs.writeFile(path.join(root, '附件', 'sample.bin'), attachment);
  return { base, original, root, stateRoot, store, attachment };
}
async function bytesIn(root) {
  const result = {};
  const walk = async directory => {
    for (const name of await fs.readdir(directory)) {
      const filename = path.join(directory, name);
      if ((await fs.lstat(filename)).isDirectory()) await walk(filename);
      else result[path.relative(root, filename)] = (await fs.readFile(filename)).toString('hex');
    }
  };
  await walk(root); return result;
}

test('offline preparation validates before copying, preserves source and rebinds only a new destination', async t => {
  const { base, original, root, store, attachment } = await fixture(t);
  const extraction = path.join(base, 'extraction');
  await fs.cp(original, extraction, { recursive: true });
  const source = await bytesIn(extraction), target = path.join(base, 'recovered');
  await assert.rejects(prepareRestore({ restoredDirectory: extraction, originalRoot: path.join(base, 'wrong'), targetDirectory: target }), /不属于/);
  await assert.rejects(fs.access(target));
  const result = await prepareRestore({ restoredDirectory: extraction, originalRoot: root, targetDirectory: target });
  assert.equal(result.ready, true);
  assert.deepEqual(await bytesIn(extraction), source);
  assert.deepEqual(await bytesIn(result.root), await bytesIn(root));
  assert.deepEqual(await fs.readFile(path.join(result.root, '附件/sample.bin')), attachment);
  const recovered = await NotesStore.open(result.root, {}, { stateRoot: result.stateRoot });
  assert.deepEqual(await recovered.history('中文.md'), await store.history('中文.md'));
  assert.deepEqual(await recovered.listTrash(), await store.listTrash());
  const oldest = (await recovered.history('中文.md')).items.at(-1);
  assert.equal((await recovered.readRevision('中文.md', oldest.revision)).text, '\uFEFF第一版\r\n  原话  ');
  await assert.rejects(prepareRestore({ restoredDirectory: extraction, originalRoot: root, targetDirectory: target }), /must not exist/);
  await fs.writeFile(path.join(extraction, 'secret-config.json'), 'synthetic key');
  await assert.rejects(prepareRestore({ restoredDirectory: extraction, originalRoot: root, targetDirectory: path.join(base, 'extra') }), /exactly/);
});

test('offline preparation refuses links and corrupt history without touching destination', async t => {
  const { base, original, root } = await fixture(t);
  const extraction = path.join(base, 'extraction');
  await fs.cp(original, extraction, { recursive: true });
  const target = path.join(base, 'target');
  await fs.symlink(root, path.join(extraction, 'notes/link'));
  await assert.rejects(prepareRestore({ restoredDirectory: extraction, originalRoot: root, targetDirectory: target }), /link/);
  await fs.unlink(path.join(extraction, 'notes/link'));
  await fs.link(path.join(extraction, 'notes/中文.md'), path.join(extraction, 'notes/hard.md'));
  await assert.rejects(prepareRestore({ restoredDirectory: extraction, originalRoot: root, targetDirectory: target }), /link/);
  await fs.unlink(path.join(extraction, 'notes/hard.md'));
  const repo = path.join(extraction, 'state/history.git');
  const { stdout } = await exec('git', [`--git-dir=${repo}`, 'rev-parse', (await fs.readdir(path.join(repo, 'refs/corilo/notes'))).map(name => `refs/corilo/notes/${name}`)[0]]);
  const oid = stdout.trim();
  await fs.chmod(path.join(repo, 'objects', oid.slice(0, 2), oid.slice(2)), 0o600);
  await fs.writeFile(path.join(repo, 'objects', oid.slice(0, 2), oid.slice(2)), 'corrupt');
  await assert.rejects(prepareRestore({ restoredDirectory: extraction, originalRoot: root, targetDirectory: target }));
  await assert.rejects(fs.access(target));
});

const restic = process.env.CORILO_TEST_RESTIC || 'restic';
let available = true;
try { await exec(restic, ['version']); } catch { available = false; }
if (!available && process.env.CORILO_REQUIRE_RESTIC === '1') throw new Error('Real restic drill is required but restic is unavailable.');
test('real restic encrypted local repository restores notes, attachments, history and trash byte-for-byte', { skip: available ? false : 'Install restic or set CORILO_TEST_RESTIC for the real backup drill.' }, async t => {
  const { base, original, root, stateRoot, store } = await fixture(t);
  const password = path.join(base, 'password');
  await fs.writeFile(password, randomBytes(32).toString('hex'), { mode: 0o600 });
  // White-list the two data directories. A sibling synthetic secret must never
  // enter the snapshot; neither configuration nor Harness state is backed up.
  await fs.writeFile(path.join(original, 'harness-config.json'), '{"apiKey":"synthetic-only"}');
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('RESTIC_')));
  const env = { ...cleanEnv, RESTIC_REPOSITORY: path.join(base, 'repository'), RESTIC_PASSWORD_FILE: password, RESTIC_CACHE_DIR: path.join(base, 'cache') };
  const run = args => exec(restic, args, { env, cwd: original, maxBuffer: 2 * 1024 * 1024 });
  await run(['init']);
  await run(['backup', '--json', '--tag', 'corilo-notes-v1', '--tag', `corilo-root=${root}`, 'notes', 'state']);
  await run(['check', '--read-data']);
  const snapshots = JSON.parse((await run(['snapshots', '--json'])).stdout);
  assert.equal(snapshots.length, 1);
  const extraction = path.join(base, 'extracted');
  await run(['restore', snapshots[0].id, '--target', extraction, '--verify']);
  assert.deepEqual((await fs.readdir(extraction)).sort(), ['notes', 'state']);
  assert.deepEqual(await bytesIn(path.join(extraction, 'notes')), await bytesIn(root));
  assert.deepEqual(await bytesIn(path.join(extraction, 'state')), await bytesIn(stateRoot));
  const recordedRoot = snapshots[0].tags.find(tag => tag.startsWith('corilo-root=')).slice('corilo-root='.length);
  assert.equal(recordedRoot, root);
  const result = await prepareRestore({ restoredDirectory: extraction, originalRoot: recordedRoot, targetDirectory: path.join(base, 'recovered') });
  const recovered = await NotesStore.open(result.root, {}, { stateRoot: result.stateRoot });
  assert.deepEqual(await recovered.history('中文.md'), await store.history('中文.md'));
  const trash = (await recovered.listTrash()).items;
  assert.equal(trash.length, 1);
  const restored = await recovered.restoreTrash({ id: trash[0].id, path: '找回.md', expected: null });
  assert.equal((await recovered.read(restored.path)).text, '回收站中的原话');
});
