/** Learner persistence. Existing JSON/JSONL stores stay legacy until explicit
 * migration. Empty workspaces create native SQLite on their first learner write.
 * Public path helpers are logical keys for learner records; material files stay files.
 */
import { mkdir, readFile, rename, writeFile, appendFile, readdir, link, rm, open } from 'node:fs/promises'
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname, resolve, basename } from 'node:path'
import { randomBytes } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { assertRecoveryLease, withRecoveryLease, canonicalRecoveryWorkspace } from './recovery-lock.js'
import { emptySnapshot, createSqliteSnapshot, readSqliteSnapshot, commitSqliteSnapshot, validateSqliteFiles, snapshotDigest, inspectSqlite, sqliteIdentity, conflict } from './sqlite-store.js'

export const DIR = '.learn'
const workspaceWrites = new Map()
const transactions = new AsyncLocalStorage()
const clone = (value) => JSON.parse(JSON.stringify(value))
const missing = (path) => { try { return lstatSync(path) } catch (error) { if (error.code === 'ENOENT') return null; throw error } }
const regular = (path, optional = true) => {
  const stat = missing(path)
  if (!stat && optional) return false
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Learning data must be ordinary unlinked files')
  return true
}
const directory = (path, optional = true) => {
  const stat = missing(path)
  if (!stat && optional) return false
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new Error('Learning directories must not be linked or special files')
  return true
}

/** Paths remain useful to migration/export and legacy callers; learner paths
 * are logical identifiers after SQLite selection, not files to copy or edit.
 */
export function paths(cwd) {
  const root = join(resolve(cwd), DIR)
  return { root, database: join(root, 'learner.sqlite'), backend: join(root, '.backend.json'), course: join(root, 'course.json'), kpDir: join(root, 'kp'),
    kp: (id) => join(root, 'kp', `${safeId(id)}.json`), verifications: join(root, 'verifications.jsonl'),
    diagnoses: join(root, 'diagnoses.jsonl'), reviews: join(root, 'reviews.json'), reminder: join(root, 'reminder.json'),
    materialsDir: join(root, 'materials'), material: (id) => join(root, 'materials', safeId(id)) }
}

/** Preserve the established identifier compatibility boundary. */
export function safeId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(id) || id.startsWith('.')) throw new Error(`invalid id ${JSON.stringify(id)}: use letters, digits, '.', '_' or '-'`)
  return id
}
export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${randomBytes(2).toString('hex')}`
}

function readBackendIdentity(file) {
  if (!regular(file)) return null
  if (lstatSync(file).size > 4096) throw new Error('Invalid learner backend identity')
  const identity = JSON.parse(readFileSync(file, 'utf8'))
  if (identity?.version !== 1 || identity.backend !== 'sqlite' || typeof identity.instanceId !== 'string' || !identity.instanceId || identity.instanceId.length > 100) throw new Error('Invalid learner backend identity')
  return identity
}

const identityValue = (instanceId) => ({ version: 1, backend: 'sqlite', instanceId })
/** Explicit recovery may recognize a torn write only when its bytes are an
 * exact prefix of the canonical marker for the already-verified database.
 */
export async function checkSqliteIdentity(cwd, instanceId, { allowIncomplete = false } = {}) {
  const p = paths(cwd), file = p.backend
  if (!directory(p.root)) return 'missing'
  if (!regular(file)) return 'missing'
  if (lstatSync(file).size > 4096) throw new Error('Invalid learner backend identity')
  const raw = await readFile(file)
  const expected = Buffer.from(JSON.stringify(identityValue(instanceId)) + '\n')
  if (allowIncomplete && raw.length < expected.length && raw.equals(expected.subarray(0, raw.length))) return 'incomplete'
  const previous = readBackendIdentity(file)
  if (previous.instanceId !== instanceId) throw new Error('Learner backend identity already selects a different database')
  return 'matching'
}

/** Explicit initialization/migration publication helper. Never changes an
 * existing valid identity. Torn markers are repairable only by explicit
 * recovery with a matching durable pending-operation digest; preserve bytes.
 */
export async function ensureSqliteIdentity(cwd, instanceId, { recoverIncomplete = false } = {}) {
  const p = paths(cwd)
  if (recoverIncomplete) assertRecoveryLease(cwd)
  directory(p.root, false)
  if (sqliteIdentity(p.database).instanceId !== instanceId) throw new Error('Cannot select a learner database with a different instance identity')
  let state = await checkSqliteIdentity(cwd, instanceId, { allowIncomplete: recoverIncomplete })
  if (state === 'matching') return identityValue(instanceId)
  if (state === 'incomplete') {
    const markers = ['.initialization.json', '.migration.lock'].map((name) => join(p.root, name)).filter((file) => missing(file))
    if (markers.length !== 1) throw new Error('A torn backend identity requires exactly one verified pending operation')
    regular(markers[0], false)
    const pending = JSON.parse(await readFile(markers[0], 'utf8'))
    if (pending.digest !== inspectSqlite(p.database).digest) throw new Error('Pending operation does not prove the torn backend identity')
    const preserved = `${p.backend}.interrupted-${randomBytes(8).toString('hex')}`
    if (missing(preserved)) throw new Error('Recovery preservation path already exists')
    await rename(p.backend, preserved); await syncDirectory(p.root)
    state = 'missing'
  }
  const value = identityValue(instanceId)
  let handle
  try { handle = await open(p.backend, 'wx', 0o600) } catch (error) {
    if (error.code === 'EEXIST' && await checkSqliteIdentity(cwd, instanceId) === 'matching') return value
    throw error
  }
  try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync() } finally { await handle.close() }
  await syncDirectory(p.root)
  return value
}

function detectBackend(cwd) {
  const p = paths(cwd)
  if (!directory(p.root)) return 'empty'
  if (missing(join(p.root, '.initialization.json'))) throw conflict('Learner initialization is in progress or interrupted; stop services and run explicit recovery.')
  if (missing(join(p.root, '.migration.lock'))) throw conflict('Learner migration is in progress or interrupted; stop services and inspect the migration lock before writing.')
  const identity = readBackendIdentity(p.backend)
  if (missing(p.database)) {
    validateSqliteFiles(p.database)
    const actual = sqliteIdentity(p.database)
    if (!identity) throw new Error('Learner SQLite database has no selected backend identity; restore its matching identity marker or use explicit recovery')
    if (actual.instanceId !== identity.instanceId) throw new Error('Learner database identity does not match its selected backend')
    return 'sqlite'
  }
  if (identity) throw new Error('Selected learner SQLite database is missing; legacy records will not be reopened')
  if (['-wal', '-shm', '-journal'].some((suffix) => missing(p.database + suffix))) throw new Error('Orphan learner database sidecars require manual inspection before initialization')
  for (const path of [p.course, p.reviews, p.reminder, p.verifications, p.diagnoses]) {
    if (missing(path)) { regular(path, false); return 'legacy' }
  }
  if (directory(p.kpDir)) {
    for (const name of readdirSync(p.kpDir).filter((name) => name.endsWith('.json'))) { regular(join(p.kpDir, name), false); return 'legacy' }
  }
  return 'empty'
}
export async function backend(cwd) {
  const kind = detectBackend(cwd)
  const tx = transactions.getStore()
  if (tx?.cwd === resolve(cwd)) {
    if (!tx.active) throw new Error('Learner transaction has already finished')
    if (kind !== tx.kind) throw conflict('Learner storage changed during this operation; reload before retrying.')
  }
  return kind
}
/** Backend-aware safety for native UI and tooling. SQLite retained legacy files
 * are deliberately ignored: only the selected backend is authoritative.
 */
export async function validateStorePaths(cwd) {
  const kind = await backend(cwd)
  const p = paths(cwd)
  if (kind === 'sqlite') { readSqliteSnapshot(p.database); return }
  if (kind === 'legacy') {
    for (const file of [p.course, p.reviews, p.reminder, p.verifications, p.diagnoses]) regular(file)
    if (directory(p.kpDir)) for (const name of readdirSync(p.kpDir).filter((name) => name.endsWith('.json'))) regular(join(p.kpDir, name), false)
  }
}

function logicalPath(file) {
  const path = resolve(file), dir = dirname(path), name = basename(path)
  if (basename(dir) === DIR) {
    const key = { 'course.json': 'course', 'reviews.json': 'reviews', 'reminder.json': 'reminder', 'verifications.jsonl': 'verifications', 'diagnoses.jsonl': 'diagnoses' }[name]
    if (key) return { cwd: dirname(dir), key, log: name.endsWith('.jsonl') }
  }
  if (basename(dir) === 'kp' && basename(dirname(dir)) === DIR && name.endsWith('.json')) return { cwd: dirname(dirname(dir)), key: `kp/${safeId(name.slice(0, -5))}`, log: false }
  return null
}
async function contextFor(entry) {
  const kind = await backend(entry.cwd)
  const tx = transactions.getStore()
  if (tx?.cwd === entry.cwd && kind !== 'legacy') return tx
  if (kind === 'sqlite') return { kind, ...readSqliteSnapshot(paths(entry.cwd).database) }
  return { kind, snapshot: emptySnapshot() }
}
function checkLegacyPath(file, entry) {
  const p = paths(entry.cwd)
  directory(p.root, false)
  if (entry.key.startsWith('kp/')) directory(p.kpDir)
  regular(file)
}
async function readLogical(file, entry, fallback) {
  const state = await contextFor(entry)
  if (state.kind === 'legacy') { checkLegacyPath(file, entry); return null }
  const value = entry.log ? state.snapshot[entry.key] : state.snapshot.documents[entry.key]
  return { value: value === undefined ? fallback : clone(value) }
}
async function writeLogical(entry, operation) {
  const outer = transactions.getStore()
  if (outer && outer.cwd !== entry.cwd) throw new Error('Nested learner writes to a different workspace are not supported')
  if (!outer) return withWorkspaceWrite(entry.cwd, () => writeLogical(entry, operation))
  const state = await contextFor(entry)
  if (state.readOnly) throw new Error('Cannot mutate a read-only learner snapshot')
  if (state.kind === 'legacy') return false
  operation(state.snapshot)
  state.dirty = true
  return true
}

/** Coherent read-only SQLite learner snapshot with no queue or retained SQL lock.
 * Legacy mode retains its existing independent file-read semantics.
 * Examiner reads can reuse a pending writer's snapshot without waiting on it.
 */
export async function withWorkspaceRead(cwd, operation) {
  const key = resolve(cwd), outer = transactions.getStore()
  if (outer?.cwd === key) {
    if (!outer.active) throw new Error('Learner transaction has already finished')
    return operation()
  }
  const kind = detectBackend(key)
  const initial = kind === 'sqlite' ? readSqliteSnapshot(paths(key).database) : { snapshot: emptySnapshot(), revision: 0 }
  const state = { cwd: key, kind, ...initial, active: true, readOnly: true, dirty: false }
  try { return await transactions.run(state, operation) } finally { state.active = false }
}

/** Per-process queue plus optimistic SQLite transaction. Async assessment work
 * runs against a private snapshot without a held SQLite lock. Commit checks the
 * global revision in a short SQL transaction; a concurrent writer gets 409 and
 * is never automatically replayed. Nested same-workspace calls reuse the snapshot.
 */
export function withWorkspaceWrite(cwd, operation) {
  const key = resolve(cwd), outer = transactions.getStore()
  if (outer) {
    if (outer.readOnly) return Promise.reject(new Error('Cannot mutate a read-only learner snapshot'))
    if (!outer.active) return Promise.reject(new Error('Learner transaction has already finished'))
    if (outer.cwd !== key) return Promise.reject(new Error('Nested learner writes to a different workspace are not supported'))
    return Promise.resolve().then(operation)
  }
  const result = (workspaceWrites.get(key) ?? Promise.resolve()).then(async () => {
    const kind = detectBackend(key)
    const initial = kind === 'sqlite' ? readSqliteSnapshot(paths(key).database) : { snapshot: emptySnapshot(), revision: 0 }
    const state = { cwd: key, kind, ...initial, active: true, dirty: false }
    try {
      return await transactions.run(state, async () => {
        const value = await operation()
        if (state.dirty) {
          const current = detectBackend(key)
          if (current !== kind) throw conflict('Learner storage changed during this operation; reload before retrying.')
          if (kind === 'sqlite') commitSqliteSnapshot(paths(key).database, state.snapshot, state.revision, state.instanceId)
          else if (kind === 'empty') await publishFirstDatabase(key, state.snapshot)
        }
        return value
      })
    } finally { state.active = false }
  })
  const tail = result.then(() => {}, () => {})
  workspaceWrites.set(key, tail)
  void tail.then(() => { if (workspaceWrites.get(key) === tail) workspaceWrites.delete(key) })
  return result
}
async function syncDirectory(path) {
  const handle = await open(path, 'r')
  try { await handle.sync() } finally { await handle.close() }
}
const activeInitializations = new Set()
function assertNoLegacyInitializationData(p) {
  const documents = [p.course, p.reviews, p.reminder, p.verifications, p.diagnoses]
  if (documents.some((file) => missing(file)) || directory(p.kpDir) && readdirSync(p.kpDir).some((name) => name.endsWith('.json'))) {
    throw conflict('Legacy learner data appeared during initialization; it will not be shadowed. Preserve both states for manual inspection.')
  }
}
async function publishFirstDatabase(cwd, snapshot) {
  const p = paths(cwd)
  await mkdir(p.root, { recursive: true })
  directory(p.root, false)
  const candidate = `.learner-${process.pid}-${randomBytes(4).toString('hex')}.sqlite`
  const temporary = join(p.root, candidate), marker = join(p.root, '.initialization.json')
  const manifest = { version: 1, pid: process.pid, candidate, digest: snapshotDigest(snapshot) }
  let lock
  try { lock = await open(marker, 'wx', 0o600) } catch (error) {
    if (error.code === 'EEXIST') throw conflict('Learner initialization is already in progress; reload or inspect explicit recovery.')
    throw error
  }
  activeInitializations.add(marker)
  let published = false
  try {
    await lock.writeFile(JSON.stringify(manifest) + '\n'); await lock.sync(); await lock.close(); lock = null
    await syncDirectory(p.root); await syncDirectory(resolve(cwd))
    // Check once more after acquiring the exclusive initialization marker.
    if (missing(p.database)) throw conflict('Another learner database already exists')
    if (missing(join(p.root, '.migration.lock'))) throw conflict('Migration started during initialization; stop services before retrying')
    assertNoLegacyInitializationData(p)
    if (['-wal', '-shm', '-journal'].some((suffix) => missing(p.database + suffix))) throw new Error('Orphan learner database sidecars require manual inspection')
    createSqliteSnapshot(temporary, snapshot)
    try { await link(temporary, p.database) } catch (error) { if (error.code === 'EEXIST') throw conflict(); throw error }
    published = true
    await syncDirectory(p.root)
    await rm(temporary); await syncDirectory(p.root)
    await ensureSqliteIdentity(cwd, inspectSqlite(p.database).instanceId)
    await rm(marker); await syncDirectory(p.root)
  } catch (error) {
    // Ordinary failures before publication can safely abandon our own stage.
    // Once published, leave the durable manifest for explicit recovery instead
    // of returning an error while silently deleting the committed data.
    if (!published) {
      await rm(temporary, { force: true })
      await rm(marker, { force: true }); await syncDirectory(p.root)
    }
    throw error
  } finally {
    activeInitializations.delete(marker)
    if (lock) await lock.close()
  }
}

/** Explicit interrupted first-write recovery. Preview is read-only; apply is
 * allowed only after the initializer process stopped. Schema, digest and any
 * candidate/database alias pair must match the durable manifest exactly.
 */
export async function recoverInitialization(cwd, { apply = false } = {}) {
  cwd = canonicalRecoveryWorkspace(cwd)
  if (!apply) return recoverInitializationState(cwd)
  // Preflight is read-only. Revalidate every proof after taking the OS lease;
  // no cached manifest or identity state may outlive another recovery.
  await recoverInitializationState(cwd, true, true)
  return withRecoveryLease(cwd, () => recoverInitializationState(cwd, true))
}
async function recoverInitializationState(cwd, apply = false, preflight = false) {
  const p = paths(cwd), marker = join(p.root, '.initialization.json')
  directory(p.root, false); regular(marker, false)
  if (missing(join(p.root, '.migration.lock'))) throw new Error('Migration and initialization markers coexist; inspect both manually')
  // Restored JSON may be newer than the interrupted first-write snapshot.
  // Check before inspecting SQLite too: rejected previews must preserve files.
  assertNoLegacyInitializationData(p)
  const markerInfo = lstatSync(marker)
  if (markerInfo.size > 4096) throw new Error('Invalid learner initialization manifest')
  const manifest = JSON.parse(await readFile(marker, 'utf8'))
  if (manifest.version !== 1 || !Number.isInteger(manifest.pid) || manifest.pid < 1 || !/^\.learner-\d+-[a-f0-9]{8}\.sqlite$/.test(manifest.candidate) || !/^[a-f0-9]{64}$/.test(manifest.digest)) throw new Error('Invalid learner initialization manifest')
  if (/^\.learner-(\d+)-/.exec(manifest.candidate)?.[1] !== String(manifest.pid)) throw new Error('Initialization candidate PID does not match its manifest')
  const candidate = join(p.root, manifest.candidate), candidateInfo = missing(candidate), databaseInfo = missing(p.database)
  let inspected
  if (candidateInfo && databaseInfo) {
    if (!candidateInfo.isFile() || candidateInfo.isSymbolicLink() || candidateInfo.nlink !== 2 || databaseInfo.ino !== candidateInfo.ino || databaseInfo.dev !== candidateInfo.dev) throw new Error('Initialization candidate does not match the published database')
    inspected = inspectSqlite(p.database, { ownedAlias: candidate })
  } else if (databaseInfo) inspected = inspectSqlite(p.database)
  else if (candidateInfo) inspected = inspectSqlite(candidate)
  const identityState = inspected ? await checkSqliteIdentity(cwd, inspected.instanceId, { allowIncomplete: true }) : missing(p.backend) ? 'invalid' : 'missing'
  if (identityState === 'invalid') throw new Error('Selected learner database is missing and cannot be recovered from an empty initialization')
  if (inspected && inspected.digest !== manifest.digest) throw new Error('Initialization snapshot digest does not match its manifest')
  const state = databaseInfo ? 'published' : candidateInfo ? 'pending' : 'empty'
  const report = { action: 'recover-initialization', state, candidate: manifest.candidate, digest: manifest.digest, identityState, applied: false }
  if (!apply) return report
  let live = activeInitializations.has(marker)
  if (manifest.pid !== process.pid) {
    try { process.kill(manifest.pid, 0); live = true } catch (error) { if (error.code !== 'ESRCH') live = true }
  }
  if (live) throw new Error('The initializer process is still running; stop services before recovery')
  // Recheck the manifest and path identity after preview validation.
  if (JSON.stringify(JSON.parse(await readFile(marker, 'utf8'))) !== JSON.stringify(manifest)) throw conflict('Initialization manifest changed during recovery')
  assertNoLegacyInitializationData(p)
  if (preflight) return report
  if (!databaseInfo && candidateInfo) {
    try { await link(candidate, p.database) } catch (error) { if (error.code === 'EEXIST') throw conflict(); throw error }
    await syncDirectory(p.root)
  }
  assertNoLegacyInitializationData(p)
  if (candidateInfo) await rm(candidate)
  await syncDirectory(p.root)
  if (inspected) await ensureSqliteIdentity(cwd, inspected.instanceId, { recoverIncomplete: true })
  assertNoLegacyInitializationData(p)
  await rm(marker); await syncDirectory(p.root)
  return { ...report, applied: true }
}

export async function readJson(file, fallback) {
  const entry = logicalPath(file)
  if (entry) {
    if (entry.log) throw new Error('Use readJsonl for learner event logs')
    const result = await readLogical(file, entry, fallback)
    if (result) return result.value
  }
  try { return JSON.parse(await readFile(file, 'utf8')) } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw new Error(`cannot read ${file}: ${error.message}`)
  }
}
export async function writeJson(file, value) {
  const entry = logicalPath(file)
  if (entry && !transactions.getStore()) return withWorkspaceWrite(entry.cwd, () => writeJson(file, value))
  if (entry) {
    if (entry.log) throw new Error('Use appendJsonl for learner event logs')
    const data = clone(value)
    if (await writeLogical(entry, (snapshot) => { snapshot.documents[entry.key] = data })) return
    directory(paths(entry.cwd).root, false)
    if (entry.key.startsWith('kp/')) directory(paths(entry.cwd).kpDir)
    regular(file)
  }
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try { await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 }); await rename(tmp, file) } finally { await rm(tmp, { force: true }) }
}
export async function appendJsonl(file, value) {
  const entry = logicalPath(file)
  if (entry && !transactions.getStore()) return withWorkspaceWrite(entry.cwd, () => appendJsonl(file, value))
  if (entry) {
    if (!entry.log) throw new Error('Use writeJson for learner documents')
    const data = clone(value)
    if (await writeLogical(entry, (snapshot) => { snapshot[entry.key].push(data) })) return
    checkLegacyPath(file, entry)
  }
  await mkdir(dirname(file), { recursive: true })
  await appendFile(file, JSON.stringify(value) + '\n', 'utf8')
}
export async function readJsonl(file) {
  const entry = logicalPath(file)
  if (entry) {
    if (!entry.log) throw new Error('Use readJson for learner documents')
    const result = await readLogical(file, entry, [])
    if (result) return result.value
  }
  let text
  try { text = await readFile(file, 'utf8') } catch (error) { if (error.code === 'ENOENT') return []; throw error }
  return text.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line))
}
export async function listKps(cwd) {
  const state = await contextFor({ cwd: resolve(cwd) })
  if (state.kind !== 'legacy') return Object.entries(state.snapshot.documents).filter(([key]) => key.startsWith('kp/')).map(([, value]) => clone(value))
  const p = paths(cwd)
  if (!directory(p.kpDir)) return []
  const names = await readdir(p.kpDir)
  return Promise.all(names.filter((name) => name.endsWith('.json')).map((name) => readJson(join(p.kpDir, name))))
}
export async function requireCourse(cwd) {
  const course = await readJson(paths(cwd).course, null)
  if (!course) throw new Error('no course in this workspace yet: plan one and save it with course_save first')
  return course
}
export async function requireKp(cwd, kpId) {
  const kp = await readJson(paths(cwd).kp(kpId), null)
  if (!kp) throw new Error(`unknown knowledge point ${JSON.stringify(kpId)}: check course_get for valid ids`)
  return kp
}
export function findModel(kp, modelId) {
  const model = kp.models.find((m) => m.id === modelId)
  if (!model) throw new Error(`knowledge point ${kp.id} has no model ${JSON.stringify(modelId)}; models: ${kp.models.map((m) => m.id).join(', ') || '(none — define them with kp_define_models)'}`)
  return model
}
