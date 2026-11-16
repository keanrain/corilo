import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, lstat, symlink, link } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { migrateStore, exportStore, recoverMigration, recoverStore } from '../src/host/migrate.js'
import { createSqliteSnapshot, readSqliteSnapshot, commitSqliteSnapshot, snapshotDigest } from '../src/host/sqlite-store.js'

async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'learner-migrate-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const root = join(cwd, '.learn')
  await mkdir(join(root, 'kp'), { recursive: true })
  await mkdir(join(root, 'materials', 'm-demo'), { recursive: true })
  const files = {
    'course.json': ' {"goal":"合成课程","status":"active","chapters":[{"title":"chapter","kpIds":["point"]}]}\n',
    'kp/point.json': JSON.stringify({ id: 'point', kind: 'knowledge', title: 'Point', models: [{ id: 'map', targetMap: { statement: { text: '用户原话' }, examples: [] } }] })+'\n',
    'reviews.json': '{"cards":{"point/map":{"due":"2026-11-16T00:00:00Z","extra":"preserve"}}}\n',
    'reminder.json': '{"sessionId":"session","id":"reminder"}\n',
    'verifications.jsonl': JSON.stringify({ id: 'v-one', kpId: 'point', modelId: 'map', verdict: 'correct', question: 'synthetic question', evidence: { version: 1, sessionId: 'session', questionSeq: 1, messageSeq: 2, examinerDigest: 'a'.repeat(64) } })+'\n',
    'diagnoses.jsonl': '{"id":"d-one","kpId":"point","findings":[],"unknown":"preserved"}\n',
  }
  for (const [path, text] of Object.entries(files)) await writeFile(join(root, path), text)
  await writeFile(join(root, 'materials', 'm-demo', 'blocks.json'), '[{"text":"material stays put"}]')
  return { cwd, root, files }
}
async function originalFiles(root, files) {
  for (const [path, text] of Object.entries(files)) assert.equal(await readFile(join(root, path), 'utf8'), text, path)
}
async function crashLock(root, snapshot, id = 'interrupted-import') {
  const plan = await migrateStore(join(root, '..'))
  const lock = { format: 'corilo-learner-migration-v1', id, pid: 2147483647, digest: snapshotDigest(snapshot), files: plan.files }
  await writeFile(join(root, '.migration.lock'), JSON.stringify(lock))
  return { stage: join(root, `.learner-${id}.pending.sqlite`), backup: join(root, 'migrations', id) }
}

test('migration previews without writes, backs up exact bytes and publishes a verified database', async (t) => {
  const { cwd, root, files } = await fixture(t)
  const before = await readdir(root)
  const plan = await migrateStore(cwd)
  assert.equal(plan.preview, true)
  assert.deepEqual(await readdir(root), before)
  const result = await migrateStore(cwd, { apply: true })
  assert.equal(result.integrity, 'ok')
  assert.deepEqual(result.counts, { documents: 4, knowledgePoints: 1, verifications: 1, diagnoses: 1 })
  assert.equal(snapshotDigest(readSqliteSnapshot(result.database).snapshot), plan.digest)
  await originalFiles(root, files)
  await originalFiles(join(result.backup, 'legacy'), files)
  const manifest = JSON.parse(await readFile(join(result.backup, 'manifest.json'), 'utf8'))
  assert.equal(manifest.digest, plan.digest)
  assert.equal(manifest.materialsIncluded, false)
  assert.equal(JSON.parse(await readFile(join(result.backup, 'receipt.json'), 'utf8')).action, 'migrated')
  assert.equal(await readFile(join(root, 'materials', 'm-demo', 'blocks.json'), 'utf8'), '[{"text":"material stays put"}]')
  await assert.rejects(migrateStore(cwd, { apply: true }), /already exists/)
})

test('export preserves postmigration state in a separate legacy workspace without replacing live data', async (t) => {
  const { cwd, root, files } = await fixture(t)
  const migrated = await migrateStore(cwd, { apply: true })
  const current = readSqliteSnapshot(migrated.database)
  current.snapshot.documents['kp/point'].title = 'New learning after migration'
  commitSqliteSnapshot(migrated.database, current.snapshot, current.revision, current.instanceId)
  const output = join(cwd, 'separate-export')
  const result = await exportStore(cwd, output)
  assert.equal(JSON.parse(await readFile(join(output, '.learn', 'kp', 'point.json'), 'utf8')).title, 'New learning after migration')
  assert.equal(result.materialsIncluded, false)
  await originalFiles(root, files)
  assert.equal(JSON.parse(await readFile(join(output, 'learner-export.json'), 'utf8')).digest, result.digest)
  await assert.rejects(exportStore(cwd, output), /EEXIST/)
  await assert.rejects(exportStore(cwd, join(root, 'export')), /outside/)
})

test('invalid JSON, duplicate records and linked input fail without publishing or mutating originals', async (t) => {
  const { cwd, root, files } = await fixture(t)
  await writeFile(join(root, 'diagnoses.jsonl'), 'SECRET_NOT_JSON')
  await assert.rejects(migrateStore(cwd, { apply: true }), (error) => /Invalid JSON/.test(error.message) && !error.message.includes('SECRET'))
  await writeFile(join(root, 'diagnoses.jsonl'), files['diagnoses.jsonl'].repeat(2))
  await assert.rejects(migrateStore(cwd), /Duplicate/)
  await writeFile(join(root, 'diagnoses.jsonl'), files['diagnoses.jsonl'])
  await rm(join(root, 'reviews.json'))
  await symlink(join(root, 'course.json'), join(root, 'reviews.json'))
  await assert.rejects(migrateStore(cwd), /without links/)
  assert.ok(!(await readdir(root)).includes('learner.sqlite'))
})

test('interrupted unpublished migration recovery preserves staged database and original records', async (t) => {
  const { cwd, root, files } = await fixture(t)
  const snapshot = { documents: { course: { goal: 'pending' } }, verifications: [], diagnoses: [] }
  const { stage, backup } = await crashLock(root, snapshot)
  createSqliteSnapshot(stage, snapshot)
  await writeFile(stage+'-journal', 'unfinished generated journal')
  assert.equal((await recoverMigration(cwd)).published, false)
  assert.equal((await lstat(stage)).nlink, 1)
  await assert.rejects(migrateStore(cwd), /lock exists/)
  await recoverMigration(cwd, { apply: true })
  assert.ok((await lstat(join(backup, 'recovered-pending.sqlite'))).isFile())
  assert.equal(await readFile(join(backup, 'recovered-pending.sqlite-journal'), 'utf8'), 'unfinished generated journal')
  await originalFiles(root, files)
  assert.ok(!(await readdir(root)).includes('.migration.lock'))
  assert.ok(!(await readdir(root)).includes('learner.sqlite'))
})

test('recovery handles the exact publication hardlink crash window without preview mutations', async (t) => {
  const { cwd, root, files } = await fixture(t)
  const snapshot = { documents: { course: { goal: 'published' } }, verifications: [], diagnoses: [] }
  const { stage } = await crashLock(root, snapshot)
  createSqliteSnapshot(stage, snapshot)
  const database = join(root, 'learner.sqlite')
  await link(stage, database)
  assert.equal((await lstat(database)).nlink, 2)
  const preview = await recoverMigration(cwd)
  assert.equal(preview.pendingAlias, true)
  assert.equal((await lstat(database)).nlink, 2)
  const result = await recoverMigration(cwd, { apply: true })
  assert.equal(result.published, true)
  assert.equal((await lstat(database)).nlink, 1)
  assert.equal(snapshotDigest(readSqliteSnapshot(database).snapshot), snapshotDigest(snapshot))
  await originalFiles(root, files)
})

test('recovery refuses a changed published database and retains its lock', async (t) => {
  const { cwd, root } = await fixture(t)
  const expected = { documents: { course: { goal: 'expected' } }, verifications: [], diagnoses: [] }
  await crashLock(root, expected)
  createSqliteSnapshot(join(root, 'learner.sqlite'), { ...expected, documents: { course: { goal: 'different' } } })
  await assert.rejects(recoverMigration(cwd, { apply: true }), /differs/)
  assert.ok((await readdir(root)).includes('.migration.lock'))
})

test('duplicate trusted answer evidence rolls back import and concurrent apply publishes only once', async (t) => {
  const { cwd, root, files } = await fixture(t)
  const second = JSON.parse(files['verifications.jsonl']); second.id = 'v-duplicate'
  await writeFile(join(root, 'verifications.jsonl'), files['verifications.jsonl'] + JSON.stringify(second)+'\n')
  await assert.rejects(migrateStore(cwd, { apply: true }), /UNIQUE/)
  assert.ok(!(await readdir(root)).includes('learner.sqlite'))
  assert.ok(!(await readdir(root)).includes('.migration.lock'))
  await writeFile(join(root, 'verifications.jsonl'), files['verifications.jsonl'])
  const results = await Promise.allSettled([migrateStore(cwd, { apply: true }), migrateStore(cwd, { apply: true })])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  await originalFiles(root, files)
})

test('packaged CLI previews safely and rejects ambiguous commands', async (t) => {
  const { cwd, root } = await fixture(t)
  const bin = new URL('../src/host/migrate-cli.js', import.meta.url).pathname
  const plan = JSON.parse(execFileSync(process.execPath, [bin, 'migrate', '--workspace', cwd], { encoding: 'utf8' }))
  assert.equal(plan.preview, true)
  assert.ok(!(await readdir(root)).includes('learner.sqlite'))
  assert.throws(() => execFileSync(process.execPath, [bin, 'export', '--workspace', cwd, '--apply'], { stdio: 'pipe' }))
})


test('migration refuses orphan destination sidecars without deleting them', async (t) => {
  const { cwd, root, files } = await fixture(t)
  const sidecar = join(root, 'learner.sqlite-wal')
  await writeFile(sidecar, 'orphan WAL must be preserved')
  await assert.rejects(migrateStore(cwd, { apply: true }), /Orphan/)
  assert.equal(await readFile(sidecar, 'utf8'), 'orphan WAL must be preserved')
  await originalFiles(root, files)
  assert.ok(!(await readdir(root)).includes('learner.sqlite'))
})

test('recovery keeps both source and published database locked if legacy data diverged', async (t) => {
  const { cwd, root } = await fixture(t)
  const snapshot = { documents: { course: { goal: 'imported' } }, verifications: [], diagnoses: [] }
  await crashLock(root, snapshot)
  createSqliteSnapshot(join(root, 'learner.sqlite'), snapshot)
  await writeFile(join(root, 'course.json'), '{"goal":"new legacy edits"}')
  await assert.rejects(recoverStore(cwd, { apply: true }), /Legacy records changed/)
  assert.ok((await readdir(root)).includes('.migration.lock'))
  assert.equal(JSON.parse(await readFile(join(root, 'course.json'), 'utf8')).goal, 'new legacy edits')
})

test('recovery can resume a previously interrupted pending-artifact preservation', async (t) => {
  const { cwd, root } = await fixture(t)
  const snapshot = { documents: { course: { goal: 'pending' } }, verifications: [], diagnoses: [] }
  const { stage, backup } = await crashLock(root, snapshot)
  createSqliteSnapshot(stage, snapshot)
  await mkdir(backup, { recursive: true })
  await link(stage, join(backup, 'recovered-pending.sqlite'))
  assert.equal((await lstat(stage)).nlink, 2)
  await recoverStore(cwd, { apply: true })
  assert.equal((await lstat(join(backup, 'recovered-pending.sqlite'))).nlink, 1)
  assert.ok(!(await readdir(root)).includes('.migration.lock'))
})

test('generic recovery dispatches initialization markers and refuses overlapping operations', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'learner-recover-init-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const root = join(cwd, '.learn'); await mkdir(root)
  const snapshot = { documents: { course: { goal: 'first creation' } }, verifications: [], diagnoses: [] }
  const candidate = '.learner-2147483647-abcdef12.sqlite'
  createSqliteSnapshot(join(root, candidate), snapshot)
  await writeFile(join(root, '.initialization.json'), JSON.stringify({ version: 1, pid: 2147483647, candidate, digest: snapshotDigest(snapshot) }))
  await assert.rejects(migrateStore(cwd), /initialization/)
  const preview = await recoverStore(cwd)
  assert.equal(preview.action, 'recover-initialization')
  assert.equal(preview.state, 'pending')
  assert.equal(preview.applied, false)
  assert.ok(!(await readdir(root)).includes('learner.sqlite'))
  await writeFile(join(root, '.migration.lock'), '{}')
  await assert.rejects(recoverStore(cwd, { apply: true }), /overlap/)
  await rm(join(root, '.migration.lock'))
  assert.equal((await recoverStore(cwd, { apply: true })).applied, true)
  assert.equal(snapshotDigest(readSqliteSnapshot(join(root, 'learner.sqlite')).snapshot), snapshotDigest(snapshot))
  await assert.rejects(recoverStore(cwd), /No interrupted/)
})


test('explicit recovery refuses to unlock another live migration process', async (t) => {
  const { cwd, root } = await fixture(t)
  const snapshot = { documents: { course: { goal: 'pending' } }, verifications: [], diagnoses: [] }
  await crashLock(root, snapshot)
  const path = join(root, '.migration.lock')
  const lock = JSON.parse(await readFile(path, 'utf8'))
  lock.pid = process.ppid
  await writeFile(path, JSON.stringify(lock))
  await assert.rejects(recoverStore(cwd, { apply: true }), /still running/)
  assert.ok((await readdir(root)).includes('.migration.lock'))
})


test('missing authoritative database never reimports retained stale JSON', async (t) => {
  const { cwd, root, files } = await fixture(t)
  const result = await migrateStore(cwd, { apply: true })
  const marker = JSON.parse(await readFile(join(root, '.backend.json'), 'utf8'))
  assert.equal(marker.instanceId, readSqliteSnapshot(result.database).instanceId)
  await rm(result.database)
  await assert.rejects(migrateStore(cwd), /Authoritative learner database is missing/)
  await originalFiles(root, files)
  assert.ok(!(await readdir(root)).includes('learner.sqlite'))
})

test('published migration recovery creates identity before removing its lock and refuses mismatch', async (t) => {
  const { cwd, root } = await fixture(t)
  const snapshot = { documents: { course: { goal: 'published' } }, verifications: [], diagnoses: [] }
  await crashLock(root, snapshot)
  const database = join(root, 'learner.sqlite')
  createSqliteSnapshot(database, snapshot)
  assert.equal((await recoverStore(cwd)).identityNeeded, true)
  await writeFile(join(root, '.backend.json'), JSON.stringify({ version: 1, backend: 'sqlite', instanceId: 'different-database' }))
  await assert.rejects(recoverStore(cwd, { apply: true }), /identity.*(?:different|match)/)
  assert.ok((await readdir(root)).includes('.migration.lock'))
  await rm(join(root, '.backend.json'))
  await recoverStore(cwd, { apply: true })
  assert.equal(JSON.parse(await readFile(join(root, '.backend.json'), 'utf8')).instanceId, readSqliteSnapshot(database).instanceId)
  assert.ok(!(await readdir(root)).includes('.migration.lock'))
})


test('migration recovery repairs only empty/exact-prefix backend markers and preserves original bytes', async (t) => {
  for (const empty of [true, false]) {
    const { cwd, root, files } = await fixture(t)
    const snapshot = { documents: { course: { goal: 'published with torn marker' } }, verifications: [], diagnoses: [] }
    await crashLock(root, snapshot)
    const database = join(root, 'learner.sqlite')
    createSqliteSnapshot(database, snapshot)
    const instanceId = readSqliteSnapshot(database).instanceId
    const canonical = JSON.stringify({ version: 1, backend: 'sqlite', instanceId })+'\n'
    const partial = empty ? '' : canonical.slice(0, 27)
    await writeFile(join(root, '.backend.json'), partial)
    const preview = await recoverStore(cwd)
    assert.equal(preview.identityState, 'incomplete')
    assert.equal(preview.identityNeeded, true)
    assert.equal(await readFile(join(root, '.backend.json'), 'utf8'), partial)
    await recoverStore(cwd, { apply: true })
    assert.equal(JSON.parse(await readFile(join(root, '.backend.json'), 'utf8')).instanceId, instanceId)
    const preserved = (await readdir(root)).filter((name) => name.startsWith('.backend.json.interrupted-'))
    assert.equal(preserved.length, 1)
    assert.equal(await readFile(join(root, preserved[0]), 'utf8'), partial)
    assert.ok(!(await readdir(root)).includes('.migration.lock'))
    await originalFiles(root, files)
  }
})

test('migration recovery refuses arbitrary corrupt backend markers without altering them', async (t) => {
  for (const garbage of ['not a backend marker', '{"garbage":true}']) {
    const { cwd, root } = await fixture(t)
    const snapshot = { documents: { course: { goal: 'published' } }, verifications: [], diagnoses: [] }
    await crashLock(root, snapshot)
    createSqliteSnapshot(join(root, 'learner.sqlite'), snapshot)
    await writeFile(join(root, '.backend.json'), garbage)
    await assert.rejects(recoverStore(cwd, { apply: true }))
    assert.equal(await readFile(join(root, '.backend.json'), 'utf8'), garbage)
    assert.ok((await readdir(root)).includes('.migration.lock'))
    assert.equal((await readdir(root)).filter((name) => name.startsWith('.backend.json.interrupted-')).length, 0)
  }
})
