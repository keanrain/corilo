import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile, link, lstat, symlink, rename, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { DatabaseSync } from 'node:sqlite'
import * as store from '../src/host/store.js'
import { createSqliteSnapshot, readSqliteSnapshot, snapshotDigest, inspectSqlite } from '../src/host/sqlite-store.js'

const storeUrl = new URL('../src/host/store.js', import.meta.url).href
const row = (id, seq = 1) => ({ id, kpId: 'kp', modelId: 'model', question: 'A new scenario', verdict: 'correct', evidence: { version: 1, sessionId: 'source-session', messageSeq: seq, questionSeq: seq - 1, examinerDigest: 'a'.repeat(64) } })
async function workspace(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'learner-sqlite-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  return cwd
}
function child(cwd, body) {
  return execFileSync(process.execPath, ['--input-type=module', '-e', `import * as store from ${JSON.stringify(storeUrl)}; const cwd=${JSON.stringify(cwd)}; ${body}`], { encoding: 'utf8', timeout: 10000 })
}

test('empty reads do not initialize; a first transaction persists only SQLite learner records', async (t) => {
  const cwd = await workspace(t), p = store.paths(cwd)
  assert.equal(await store.backend(cwd), 'empty')
  await store.withWorkspaceRead(cwd, async () => assert.equal(await store.readJson(p.course, null), null))
  await assert.rejects(lstat(p.root), { code: 'ENOENT' })
  await store.withWorkspaceWrite(cwd, async () => {
    await store.writeJson(p.course, { goal: 'Learn' })
    await store.writeJson(p.kp('_topic'), { id: '_topic', models: [] })
    await store.writeJson(p.kp('-topic'), { id: '-topic', models: [] })
    await store.writeJson(p.reviews, { cards: {} })
  })
  assert.equal(await store.backend(cwd), 'sqlite')
  assert.equal((await store.requireCourse(cwd)).goal, 'Learn')
  assert.equal((await store.listKps(cwd)).length, 2)
  await assert.rejects(lstat(p.course), { code: 'ENOENT' })
  await assert.rejects(lstat(p.kpDir), { code: 'ENOENT' })
  assert.equal(inspectSqlite(p.database).integrity, 'ok')
})

test('legacy JSON remains authoritative until explicit migration', async (t) => {
  const cwd = await workspace(t), p = store.paths(cwd)
  await store.writeJson(join(cwd, 'seed.json'), {})
  const { mkdir } = await import('node:fs/promises')
  await mkdir(p.root)
  await writeFile(p.course, JSON.stringify({ goal: 'Legacy' }))
  await store.withWorkspaceWrite(cwd, () => store.writeJson(p.reviews, { cards: {} }))
  assert.equal(await store.backend(cwd), 'legacy')
  assert.equal(JSON.parse(await readFile(p.course, 'utf8')).goal, 'Legacy')
  await assert.rejects(lstat(p.database), { code: 'ENOENT' })
})

test('nested operations share one transaction and a thrown result rolls back all records', async (t) => {
  const cwd = await workspace(t), p = store.paths(cwd)
  await store.writeJson(p.course, { goal: 'Before' })
  const before = inspectSqlite(p.database)
  await assert.rejects(store.withWorkspaceWrite(cwd, async () => {
    await store.appendJsonl(p.verifications, row('v1'))
    await store.withWorkspaceWrite(cwd, () => store.writeJson(p.kp('kp'), { id: 'kp', mastery: 'expert' }))
    await store.writeJson(p.reviews, { cards: { kp: { due: 'tomorrow' } } })
    throw new Error('examiner result could not be returned')
  }), /could not be returned/)
  assert.deepEqual(inspectSqlite(p.database), before)
  await store.withWorkspaceWrite(cwd, () => store.writeJson(p.course, { goal: 'After failure' }))
  assert.equal((await store.requireCourse(cwd)).goal, 'After failure')
})

test('readonly snapshots reject writes and nested foreign-workspace writes fail closed', async (t) => {
  const cwd = await workspace(t), foreign = await workspace(t), p = store.paths(cwd)
  await store.writeJson(p.course, { goal: 'Stable' })
  await store.withWorkspaceRead(cwd, async () => {
    await assert.rejects(store.writeJson(p.course, { goal: 'No' }), /read-only/)
    await assert.rejects(store.withWorkspaceWrite(cwd, () => null), /read-only/)
  })
  await assert.rejects(store.withWorkspaceWrite(cwd, () => store.writeJson(store.paths(foreign).course, { goal: 'No' })), /same workspace|different workspace/)
  assert.equal((await store.requireCourse(cwd)).goal, 'Stable')
})

test('a read snapshot remains coherent across another process committing', async (t) => {
  const cwd = await workspace(t), p = store.paths(cwd)
  await store.withWorkspaceWrite(cwd, async () => {
    await store.writeJson(p.course, { revision: 'old' })
    await store.writeJson(p.reviews, { revision: 'old' })
  })
  await store.withWorkspaceRead(cwd, async () => {
    assert.equal((await store.readJson(p.course)).revision, 'old')
    child(cwd, "await store.withWorkspaceWrite(cwd,async()=>{await store.writeJson(store.paths(cwd).course,{revision:'new'});await store.writeJson(store.paths(cwd).reviews,{revision:'new'})})")
    assert.equal((await store.readJson(p.reviews)).revision, 'old')
  })
  assert.equal((await store.readJson(p.reviews)).revision, 'new')
})

test('optimistic commit detects another process without holding a lock during async work', async (t) => {
  const cwd = await workspace(t), p = store.paths(cwd)
  await store.writeJson(p.course, { goal: 'Start' })
  await assert.rejects(store.withWorkspaceWrite(cwd, async () => {
    await store.writeJson(p.course, { goal: 'Stale' })
    child(cwd, "await store.writeJson(store.paths(cwd).course,{goal:'Other process'})")
    await store.appendJsonl(p.verifications, row('stale-verification'))
  }), (error) => error.status === 409)
  assert.equal((await store.requireCourse(cwd)).goal, 'Other process')
  assert.deepEqual(await store.readJsonl(p.verifications), [])
})

test('duplicate trusted evidence rejects the entire commit while untrusted legacy records survive', async (t) => {
  const cwd = await workspace(t), p = store.paths(cwd)
  await store.appendJsonl(p.verifications, row('first'))
  await assert.rejects(store.withWorkspaceWrite(cwd, async () => {
    await store.appendJsonl(p.verifications, row('duplicate'))
    await store.writeJson(p.reviews, { cards: { fake: {} } })
  }), (error) => error.status === 409)
  assert.equal((await store.readJsonl(p.verifications)).length, 1)
  assert.equal(await store.readJson(p.reviews, null), null)
  await store.appendJsonl(p.verifications, { id: 'old', evidence: {} })
  await store.appendJsonl(p.verifications, { id: 'older', evidence: {} })
  assert.equal((await store.readJsonl(p.verifications)).length, 3)
})

test('an unknown database version never initializes schema or falls back to retained JSON', async (t) => {
  const cwd = await workspace(t), p = store.paths(cwd)
  await store.writeJson(p.course, { goal: 'SQL' })
  await writeFile(p.course, JSON.stringify({ goal: 'Retained original' }))
  const db = new DatabaseSync(p.database); db.exec('PRAGMA user_version=999'); db.close()
  await assert.rejects(store.requireCourse(cwd), /Unsupported learner database/)
  const check = new DatabaseSync(p.database); assert.equal(check.prepare('PRAGMA user_version').get().user_version, 999); check.close()
  assert.equal(JSON.parse(await readFile(p.course, 'utf8')).goal, 'Retained original')
})

test('sidecar links and orphan sidecars cannot be attached to a learner database', async (t) => {
  const cwd = await workspace(t), p = store.paths(cwd), outside = join(cwd, 'outside')
  await store.writeJson(p.course, { goal: 'SQL' }); await writeFile(outside, 'not a WAL')
  await symlink(outside, p.database + '-wal')
  await assert.rejects(store.requireCourse(cwd), /ordinary unlinked/)
  assert.equal(await readFile(outside, 'utf8'), 'not a WAL')
  await rm(p.database + '-wal'); await rm(p.database)
  await writeFile(p.database + '-wal', 'orphan')
  await assert.rejects(store.writeJson(p.course, { goal: 'No overwrite' }), /Orphan|selected|Selected/)
  await assert.rejects(lstat(p.database), { code: 'ENOENT' })
})

test('explicit recovery verifies and completes an interrupted owned alias publication', async (t) => {
  const cwd = await workspace(t), p = store.paths(cwd)
  const { mkdir } = await import('node:fs/promises'); await mkdir(p.root)
  const candidate = `.learner-${process.pid}-abcd1234.sqlite`, stage = join(p.root, candidate)
  const snapshot = { documents: { course: { goal: 'Recovered' } }, verifications: [], diagnoses: [] }
  createSqliteSnapshot(stage, snapshot)
  await link(stage, p.database)
  await writeFile(join(p.root, '.initialization.json'), JSON.stringify({ version: 1, pid: process.pid, candidate, digest: snapshotDigest(snapshot) }))
  await assert.rejects(store.requireCourse(cwd), /initialization/)
  const preview = await store.recoverInitialization(cwd)
  assert.equal(preview.state, 'published'); assert.equal(preview.applied, false)
  assert.equal((await lstat(p.database)).nlink, 2)
  const result = await store.recoverInitialization(cwd, { apply: true })
  assert.equal(result.applied, true); assert.equal((await lstat(p.database)).nlink, 1)
  assert.equal((await store.requireCourse(cwd)).goal, 'Recovered')
  await assert.rejects(lstat(stage), { code: 'ENOENT' })
})

test('killing a process with staged changes leaves the previous committed snapshot intact', async (t) => {
  const cwd = await workspace(t), p = store.paths(cwd)
  await store.writeJson(p.course, { goal: 'Before crash' })
  const before = inspectSqlite(p.database)
  const processChild = spawn(process.execPath, ['--input-type=module', '-e', `import * as store from ${JSON.stringify(storeUrl)};const cwd=${JSON.stringify(cwd)};await store.withWorkspaceWrite(cwd,async()=>{await store.writeJson(store.paths(cwd).course,{goal:'Uncommitted'});process.stdout.write('ready\\n');await new Promise(()=>{})});`], { stdio: ['ignore', 'pipe', 'pipe'] })
  t.after(() => processChild.kill('SIGKILL'))
  await once(processChild.stdout, 'data')
  const exit = once(processChild, 'exit'); processChild.kill('SIGKILL'); await exit
  assert.deepEqual(inspectSqlite(p.database), before)
})


test('selected database deletion or replacement cannot reactivate retained legacy records', async (t) => {
  const cwd = await workspace(t), p = store.paths(cwd)
  await store.writeJson(p.course, { goal: 'Authoritative SQLite' })
  await writeFile(p.course, JSON.stringify({ goal: 'Stale retained JSON' }))
  await rename(p.database, join(p.root, 'saved.sqlite'))
  await assert.rejects(store.requireCourse(cwd), /database is missing/)
  await assert.rejects(store.writeJson(p.course, { goal: 'Must not overwrite JSON' }), /database is missing/)
  assert.equal(JSON.parse(await readFile(p.course, 'utf8')).goal, 'Stale retained JSON')
  createSqliteSnapshot(p.database, { documents: { course: { goal: 'Different instance' } }, verifications: [], diagnoses: [] })
  await assert.rejects(store.requireCourse(cwd), /identity does not match/)
})

test('pending initialization preview is nonmutating and apply completes database identity', async (t) => {
  const cwd = await workspace(t), p = store.paths(cwd)
  const { mkdir } = await import('node:fs/promises')
  await mkdir(p.root)
  const candidate = `.learner-${process.pid}-1234abcd.sqlite`
  const snapshot = { documents: { course: { goal: 'Recovered before publish' } }, verifications: [], diagnoses: [] }
  createSqliteSnapshot(join(p.root, candidate), snapshot)
  await writeFile(join(p.root, '.initialization.json'), JSON.stringify({ version: 1, pid: process.pid, candidate, digest: snapshotDigest(snapshot) }))
  assert.equal((await store.recoverInitialization(cwd)).state, 'pending')
  await assert.rejects(lstat(p.database), { code: 'ENOENT' })
  await store.recoverInitialization(cwd, { apply: true })
  assert.equal((await store.requireCourse(cwd)).goal, 'Recovered before publish')
  const identity = JSON.parse(await readFile(p.backend, 'utf8'))
  assert.equal(identity.instanceId, readSqliteSnapshot(p.database).instanceId)
})

test('initialization recovery refuses mismatched candidate PID or digest and preserves evidence', async (t) => {
  const cwd = await workspace(t), p = store.paths(cwd)
  const { mkdir } = await import('node:fs/promises')
  await mkdir(p.root)
  const candidate = `.learner-${process.pid}-deadbeef.sqlite`
  const snapshot = { documents: {}, verifications: [], diagnoses: [] }
  createSqliteSnapshot(join(p.root, candidate), snapshot)
  const marker = join(p.root, '.initialization.json')
  await writeFile(marker, JSON.stringify({ version: 1, pid: process.pid + 1, candidate, digest: snapshotDigest(snapshot) }))
  await assert.rejects(store.recoverInitialization(cwd, { apply: true }), /PID does not match/)
  await writeFile(marker, JSON.stringify({ version: 1, pid: process.pid, candidate, digest: 'f'.repeat(64) }))
  await assert.rejects(store.recoverInitialization(cwd, { apply: true }), /digest does not match/)
  assert.equal((await lstat(join(p.root, candidate))).isFile(), true)
  assert.equal((await lstat(marker)).isFile(), true)
})

test('appending records and editing another document do not rewrite unchanged history', async (t) => {
  const cwd = await workspace(t), p = store.paths(cwd)
  await store.appendJsonl(p.verifications, row('original', 1))
  const db = new DatabaseSync(p.database)
  db.exec('CREATE TABLE audit (id TEXT); CREATE TRIGGER no_history_rewrite AFTER DELETE ON verifications BEGIN INSERT INTO audit VALUES (old.id); END')
  db.close()
  await store.appendJsonl(p.verifications, row('next', 2))
  await store.writeJson(p.reviews, { cards: {} })
  const check = new DatabaseSync(p.database)
  try { assert.equal(check.prepare('SELECT count(*) AS count FROM audit').get().count, 0) } finally { check.close() }
})


test('a torn owned backend marker is repairable explicitly without discarding its bytes', async (t) => {
  for (const prefix of ['', '{"version":1,"backend":']) {
    const cwd = await workspace(t), p = store.paths(cwd)
    const { mkdir } = await import('node:fs/promises')
    await mkdir(p.root)
    const candidate = `.learner-${process.pid}-abc12345.sqlite`
    const snapshot = { documents: { course: { goal: 'Recover selected data' } }, verifications: [], diagnoses: [] }
    createSqliteSnapshot(p.database, snapshot)
    await writeFile(join(p.root, '.initialization.json'), JSON.stringify({ version: 1, pid: process.pid, candidate, digest: snapshotDigest(snapshot) }))
    await writeFile(p.backend, prefix)
    const preview = await store.recoverInitialization(cwd)
    assert.equal(preview.identityState, 'incomplete')
    assert.equal(await readFile(p.backend, 'utf8'), prefix)
    await store.recoverInitialization(cwd, { apply: true })
    const preserved = (await readdir(p.root)).find((name) => name.startsWith('.backend.json.interrupted-'))
    assert.ok(preserved)
    assert.equal(await readFile(join(p.root, preserved), 'utf8'), prefix)
    assert.equal((await store.requireCourse(cwd)).goal, 'Recover selected data')
  }
})

test('arbitrary identity garbage and mismatched valid identities cannot be repaired', async (t) => {
  const cwd = await workspace(t), p = store.paths(cwd)
  await store.writeJson(p.course, { goal: 'Safe' })
  const snapshot = readSqliteSnapshot(p.database).snapshot
  const marker = join(p.root, '.initialization.json')
  await writeFile(marker, JSON.stringify({ version: 1, pid: process.pid, candidate: `.learner-${process.pid}-def12345.sqlite`, digest: snapshotDigest(snapshot) }))
  for (const contents of ['arbitrary bytes', JSON.stringify({ version: 1, backend: 'sqlite', instanceId: 'different-instance' })]) {
    await writeFile(p.backend, contents)
    await assert.rejects(store.recoverInitialization(cwd, { apply: true }))
    assert.equal(await readFile(p.backend, 'utf8'), contents)
    assert.equal((await lstat(marker)).isFile(), true)
  }
})

 test('a valid database without its durable selection identity is not silently adopted', async (t) => {
  const cwd = await workspace(t), p = store.paths(cwd)
  await store.writeJson(p.course, { goal: 'Safe' })
  await rm(p.backend)
  await assert.rejects(store.requireCourse(cwd), /no selected backend identity/)
  assert.equal(readSqliteSnapshot(p.database).snapshot.documents.course.goal, 'Safe')
})
