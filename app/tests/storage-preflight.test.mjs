import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { inspectStorage, storageMountReport } from '../cloud/storage-preflight.mjs';

const snapshot = [
  '20 1 0:20 / / rw,relatime - overlay overlay rw',
  '30 20 8:1 / /data rw,relatime shared:1 - xfs /dev/vda rw,prjquota',
  '31 30 8:2 / /data/vault/state rw - ext4 /dev/vdb rw',
  // Overmount: the directory FD's mount ID, not longest path or row order, wins.
  '40 20 0:30 / /data rw - overlay overlay rw',
].join('\n');

test('storage diagnostics never equate mount flags with enforced vault quotas', () => {
  const report = storageMountReport(snapshot, 30, '/data/vault');
  assert.equal(report.filesystem, 'xfs');
  assert.equal(report.projectQuotaMountOption, 'present');
  assert.equal(report.status, 'requires-verification');
  assert.equal(report.enforcement, 'unverified');
  assert.equal(report.nestedMountCount, 1);
  assert.ok(report.blockers.some(value => value.includes('byte/inode hard limits')));
  assert.ok(report.blockers.some(value => value.includes('Worker inability')));
  const actual = storageMountReport(snapshot, 40, '/data/vault');
  assert.equal(actual.status, 'unsupported-filesystem');
  assert.equal(actual.enforcement, 'unverified');
  assert.equal(storageMountReport(snapshot, 31, '/data/vault/state').projectQuotaMountOption, 'absent');
});

test('storage snapshot identity, path boundaries, escaped paths and accounting-only options', () => {
  assert.throws(() => storageMountReport(snapshot, 99, '/data/vault'));
  assert.throws(() => storageMountReport(snapshot, 30, '/database'));
  assert.throws(() => storageMountReport(snapshot + '\n' + snapshot.split('\n')[1], 30, '/data'));
  assert.throws(() => storageMountReport('malformed', 30, '/data'));
  assert.throws(() => storageMountReport(' '.repeat(2 * 1024 * 1024 + 1), 30, '/data'));
  const report = storageMountReport('50 1 8:1 / /some\\040data rw - xfs /dev/vda rw,pqnoenforce', 50, '/some data/vault');
  assert.equal(report.mountPoint, '/some data');
  assert.equal(report.projectQuotaMountOption, 'absent');
  assert.equal(report.enforcement, 'unverified');
});

test('real Linux storage inspection is read-only and reports unverified enforcement', { skip: process.platform !== 'linux' }, async t => {
  const root = await mkdtemp(tmpdir() + '/corilo-storage-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const note = root + '/note.md';
  await writeFile(note, 'synthetic note');
  const report = await inspectStorage(root);
  assert.equal(report.dataRoot, root);
  assert.equal(report.enforcement, 'unverified');
  assert.ok(report.filesystem);
  assert.equal(await readFile(note, 'utf8'), 'synthetic note');
  await assert.rejects(inspectStorage(note));
  await assert.rejects(inspectStorage('relative'));
});
