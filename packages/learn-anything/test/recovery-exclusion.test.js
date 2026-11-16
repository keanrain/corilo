import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, link } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { syncBuiltinESMExports } from 'node:module'
import * as store from '../src/host/store.js'
import { recoverMigration, recoverStore, migrateStore } from '../src/host/migrate.js'
import { createSqliteSnapshot, snapshotDigest, inspectSqlite } from '../src/host/sqlite-store.js'

const storeUrl = new URL('../src/host/store.js', import.meta.url).href
const migrateUrl = new URL('../src/host/migrate.js', import.meta.url).href
const DEAD_PID = 2147483647
async function fixture(t, kind = 'initialization', goal = 'preserved learning') {
  const cwd = await mkdtemp(join(tmpdir(), 'learn-exclusive-recover-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const p = store.paths(cwd)
  await mkdir(p.root)
  const snapshot = { documents: { course: { goal } }, verifications: [], diagnoses: [] }
  let marker
  if (kind === 'migration') {
    await writeFile(p.course, JSON.stringify({ goal: 'legacy source' }))
    const plan = await migrateStore(cwd)
    marker = join(p.root, '.migration.lock')
    await writeFile(marker, JSON.stringify({ format: 'corilo-learner-migration-v1', id: 'interrupted-import', pid: DEAD_PID, digest: snapshotDigest(snapshot), files: plan.files }))
  } else {
    marker = join(p.root, '.initialization.json')
    await writeFile(marker, JSON.stringify({ version: 1, pid: DEAD_PID, candidate: `.learner-${DEAD_PID}-abcdef12.sqlite`, digest: snapshotDigest(snapshot) }))
  }
  createSqliteSnapshot(p.database, snapshot)
  await writeFile(p.backend, '')
  return { cwd, p, marker, snapshot }
}
const recover = (kind) => kind === 'migration' ? recoverMigration : store.recoverInitialization
const worker = `
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
const [cwd, kind, phase] = process.argv.slice(1)
const original = fs.rename
const pause = async () => { process.send({ paused: true }); await new Promise((resolve) => process.once('message', resolve)) }
fs.rename = async function(source, destination) {
  if (String(source).endsWith('/.backend.json')) {
    if (phase === 'before') await pause()
    const value = await original(source, destination)
    if (phase === 'after') await pause()
    return value
  }
  return original(source, destination)
}
syncBuiltinESMExports()
const store = await import(${JSON.stringify(storeUrl)})
const migrate = await import(${JSON.stringify(migrateUrl)})
try {
  await (kind === 'migration' ? migrate.recoverMigration : store.recoverInitialization)(cwd, { apply: true })
  process.send({ completed: true })
} catch (error) { process.send({ error: error.message, status: error.status }); process.exitCode = 1 }
`
async function pausedWorker(t, cwd, kind, phase) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', worker, cwd, kind, phase], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  let stderr = ''; child.stderr.on('data', (data) => { stderr += data })
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') })
  const message = await Promise.race([
    once(child, 'message').then(([message]) => message),
    once(child, 'exit').then(([code]) => { throw new Error(`Recovery worker exited ${code}: ${stderr}`) }),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Recovery worker did not pause')), 10000); timer.unref() }),
  ])
  assert.deepEqual(message, { paused: true })
  return child
}
async function stopWorker(child) {
  const stopped = once(child, 'exit')
  child.kill('SIGKILL')
  await stopped
}

test('recovery apply is cross-process exclusive, including aliases, and interrupted owners release the OS lease', async (t) => {
  for (const kind of ['initialization', 'migration']) for (const phase of ['before', 'after']) {
    await t.test(`${kind}, interrupted ${phase} identity preservation`, async (t) => {
      const f = await fixture(t, kind)
      const alias = f.cwd + '-alias'; await symlink(f.cwd, alias, 'dir'); t.after(() => rm(alias, { force: true }))
      const child = await pausedWorker(t, f.cwd, kind, phase)
      const markerBytes = await readFile(f.marker)
      const names = await readdir(f.p.root)
      assert.equal(names.some((name) => /^\.recovery-lock\.sqlite-(?:journal|wal|shm)$/.test(name)), false, 'the live lease must not create disk sidecars')
      await recover(kind)(alias)
      assert.deepEqual(await readdir(f.p.root), names, 'preview must not change even coordinator files')
      for (const apply of [recover(kind), recoverStore]) {
        await assert.rejects(apply(alias, { apply: true }), (error) => error.status === 409 && error.code === 'LEARN_RECOVERY_BUSY')
        assert.deepEqual(await readFile(f.marker), markerBytes)
        assert.deepEqual(await readdir(f.p.root), names, 'a rejected second owner must not preserve/replace identity files')
      }
      assert.equal((await fs.stat(join(f.p.root, '.recovery-lock.sqlite'))).size, 0)
      await stopWorker(child)
      assert.deepEqual(await readdir(f.p.root), names, 'a killed lease owner leaves no stale lease artifacts')
      await recover(kind)(f.cwd, { apply: true })
      assert.equal(await store.backend(f.cwd), 'sqlite')
      assert.equal((await store.readJson(f.p.course)).goal, f.snapshot.documents.course.goal)
      await assert.rejects(readFile(f.marker), { code: 'ENOENT' })
      assert.equal((await fs.stat(join(f.p.root, '.recovery-lock.sqlite'))).size, 0)
      await assert.rejects(recover(kind)(f.cwd, { apply: true }))
      assert.equal((await store.readJson(f.p.course)).goal, f.snapshot.documents.course.goal)
    })
  }
})

test('a preflight proof cannot be replayed after another recovery completes', async (t) => {
  for (const kind of ['initialization', 'migration']) await t.test(kind, async (t) => {
    const f = await fixture(t, kind)
    const original = fs.readFile, originalOpen = fs.open
    let markerReads = 0, identity, winnerNames
    const afterRead = async (path) => {
      if (String(path) === f.marker && ++markerReads === 2) {
        await recover(kind)(f.cwd, { apply: true })
        identity = await original(f.p.backend)
        winnerNames = await readdir(f.p.root)
      }
    }
    fs.readFile = async (...args) => {
      const value = await original(...args)
      await afterRead(args[0])
      return value
    }
    fs.open = async (...args) => {
      const handle = await originalOpen(...args)
      if (String(args[0]) === f.marker) {
        const read = handle.readFile.bind(handle)
        handle.readFile = async (...readArgs) => { const value = await read(...readArgs); await afterRead(args[0]); return value }
      }
      return handle
    }
    syncBuiltinESMExports()
    try { await assert.rejects(recover(kind)(f.cwd, { apply: true })) } finally { fs.readFile = original; fs.open = originalOpen; syncBuiltinESMExports() }
    assert.ok(identity, 'another recovery completed between preflight and lease acquisition')
    assert.deepEqual(await readFile(f.p.backend), identity)
    assert.deepEqual(await readdir(f.p.root), winnerNames, 'the stale attempt must not change the successfully recovered state')
    assert.equal(await store.backend(f.cwd), 'sqlite')
    assert.equal((await store.readJson(f.p.course)).goal, f.snapshot.documents.course.goal)
  })
})

test('preview does not create a coordinator and invalid coordinator files fail closed', async (t) => {
  for (const obstacle of ['none', 'content', 'symlink', 'hardlink', 'sidecar']) await t.test(obstacle, async (t) => {
    const f = await fixture(t)
    const coordinator = join(f.p.root, '.recovery-lock.sqlite')
    const target = join(f.cwd, 'external-target')
    await writeFile(target, obstacle === 'hardlink' ? '' : 'retain external file')
    if (obstacle === 'content') await writeFile(coordinator, 'unknown content')
    if (obstacle === 'symlink') await symlink(target, coordinator)
    if (obstacle === 'hardlink') await link(target, coordinator)
    if (obstacle === 'sidecar') { await writeFile(coordinator, ''); await writeFile(coordinator + '-journal', 'unknown journal') }
    const before = await readdir(f.p.root)
    const marker = await readFile(f.marker)
    await store.recoverInitialization(f.cwd)
    assert.deepEqual(await readdir(f.p.root), before)
    if (obstacle !== 'none') {
      await assert.rejects(store.recoverInitialization(f.cwd, { apply: true }), /coordinator/)
      assert.deepEqual(await readFile(f.marker), marker)
      assert.equal((await readFile(f.p.backend)).length, 0)
      assert.equal(await readFile(target, 'utf8'), obstacle === 'hardlink' ? '' : 'retain external file')
    }
  })
})

test('direct torn-identity repair cannot bypass the recovery lease', async (t) => {
  const f = await fixture(t)
  const before = await readdir(f.p.root)
  await assert.rejects(store.ensureSqliteIdentity(f.cwd, inspectSqlite(f.p.database).instanceId, { recoverIncomplete: true }), /requires exclusive learner recovery/)
  assert.deepEqual(await readdir(f.p.root), before)
  assert.equal((await readFile(f.p.backend)).length, 0)
})

test('workspace aliases are resolved once before preflight and cannot retarget a recovery', async (t) => {
  const first = await fixture(t, 'initialization', 'original workspace')
  const second = await fixture(t, 'initialization', 'retargeted workspace')
  const alias = first.cwd + '-alias'; await symlink(first.cwd, alias, 'dir'); t.after(() => rm(alias, { force: true }))
  const secondMarker = await readFile(second.marker)
  const original = fs.readFile
  let retargeted = false
  fs.readFile = async (...args) => {
    const value = await original(...args)
    if (!retargeted && String(args[0]) === first.marker) { retargeted = true; await rm(alias); await symlink(second.cwd, alias, 'dir') }
    return value
  }
  syncBuiltinESMExports()
  try { await recoverStore(alias, { apply: true }) } finally { fs.readFile = original; syncBuiltinESMExports() }
  assert.equal(retargeted, true)
  assert.equal((await store.readJson(first.p.course)).goal, 'original workspace')
  assert.deepEqual(await readFile(second.marker), secondMarker)
  assert.equal((await readFile(second.p.backend)).length, 0)
})
