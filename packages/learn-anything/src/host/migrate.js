/** Explicit, offline learner-store migration. Never invoked by plugin startup. */
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, readFile, link, unlink } from 'node:fs/promises'
import { resolve, join, relative, sep } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import { createSqliteSnapshot, readSqliteSnapshot, inspectSqlite, snapshotDigest, snapshotCounts } from './sqlite-store.js'

const FORMAT = 'corilo-learner-migration-v1'
const activeMigrations = new Set()
const FILES = ['course.json', 'reviews.json', 'reminder.json', 'verifications.jsonl', 'diagnoses.jsonl']
const DOCUMENTS = new Set(['course.json', 'reviews.json', 'reminder.json'])
const ID = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,79}$/
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const rootOf = (cwd) => join(resolve(cwd), '.learn')
const absent = async (path) => { try { await lstat(path); return false } catch (e) { if (e.code === 'ENOENT') return true; throw e } }
const fail = (message) => { throw new Error(message) }

async function directory(path, missing = false) {
  const absolute = resolve(path)
  const parts = absolute.split(sep).filter(Boolean)
  let current = sep
  for (const part of parts) {
    current = join(current, part)
    let info
    try { info = await lstat(current) } catch (e) { if (missing && e.code === 'ENOENT') return false; throw e }
    if (!info.isDirectory() || info.isSymbolicLink()) fail('Store paths must be ordinary directories without links')
  }
  return true
}
async function ordinaryFile(path) {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) fail('Learner records must be ordinary files without links')
}
async function readBytes(path) {
  await ordinaryFile(path)
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.nlink !== 1) fail('Learner records must be ordinary files without links')
    if (info.size > 128 * 1024 * 1024) fail('A learner record exceeds the 128 MiB migration limit')
    return await handle.readFile()
  } finally { await handle.close() }
}
async function writeExclusive(path, bytes) {
  await directory(resolve(path, '..'))
  const handle = await open(path, 'wx', 0o600)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
}
async function syncDirectory(path) {
  const handle = await open(path, 'r')
  try { await handle.sync() } finally { await handle.close() }
}
function parseJson(bytes, name) {
  try { return JSON.parse(bytes.toString('utf8')) } catch { fail(`Invalid JSON in ${name}`) }
}
function parseLines(bytes, name) {
  return bytes.toString('utf8').split('\n').filter((line) => line.trim()).map((line) => parseJson(Buffer.from(line), name))
}
function validateSnapshot(snapshot) {
  const { documents, verifications, diagnoses } = snapshot
  for (const [key, value] of Object.entries(documents)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`Invalid learner document ${key}`)
    if (key.startsWith('kp/') && value.id !== key.slice(3)) fail(`Knowledge-point ID differs from its filename: ${key}`)
  }
  for (const [name, records] of Object.entries({ verifications, diagnoses })) {
    const ids = new Set()
    for (const record of records) {
      if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.id !== 'string' || !record.id) fail(`Invalid ${name} record`)
      if (ids.has(record.id)) fail(`Duplicate ${name} record ID`)
      ids.add(record.id)
    }
  }
}
async function legacySnapshot(root) {
  await directory(root)
  const names = [...FILES]
  const kp = join(root, 'kp')
  if (await directory(kp, true)) {
    for (const name of (await readdir(kp)).sort()) {
      if (!name.endsWith('.json')) continue
      const id = name.slice(0, -5)
      if (!ID.test(id)) fail('Invalid knowledge-point filename')
      names.push(`kp/${name}`)
    }
  }
  const snapshot = { documents: {}, verifications: [], diagnoses: [] }
  const files = []
  for (const name of names) {
    const path = join(root, name)
    if (await absent(path)) continue
    const bytes = await readBytes(path)
    files.push({ path: name, bytes: bytes.length, sha256: digest(bytes), contents: bytes })
    if (DOCUMENTS.has(name)) snapshot.documents[name.slice(0, -5)] = parseJson(bytes, name)
    else if (name.startsWith('kp/')) snapshot.documents[name.slice(0, -5)] = parseJson(bytes, name)
    else snapshot[name.slice(0, -6)] = parseLines(bytes, name)
  }
  validateSnapshot(snapshot)
  return { snapshot, files }
}
const manifestFiles = (files) => files.map(({ contents, ...file }) => file)
const sameFiles = (left, right) => JSON.stringify(manifestFiles(left)) === JSON.stringify(manifestFiles(right))
const counts = (snapshot) => snapshotCounts(snapshot)
const summary = ({ snapshot, files }) => ({ files: manifestFiles(files), counts: counts(snapshot), digest: snapshotDigest(snapshot) })
async function backendIdentity(root, expected) {
  const path = join(root, '.backend.json')
  if (await absent(path)) return null
  const value = parseJson(await readBytes(path), '.backend.json')
  if (value.version !== 1 || value.backend !== 'sqlite' || typeof value.instanceId !== 'string' || !value.instanceId || (expected && value.instanceId !== expected)) fail('Learner backend identity does not match the database; manual inspection required')
  return value
}
async function ensureIdentity(cwd, instanceId, options) {
  const { ensureSqliteIdentity } = await import('./store.js')
  await ensureSqliteIdentity(cwd, instanceId, options)
}
async function noOrphanSidecars(root) {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    if (!(await absent(join(root, 'learner.sqlite' + suffix)))) fail('Orphan learner database sidecars exist; preserve them for manual inspection')
  }
}
async function noLock(root) {
  if (!(await absent(join(root, '.initialization.json')))) fail('An interrupted store initialization exists; stop services and inspect with recover')
  if (!(await absent(join(root, '.migration.lock')))) fail('An interrupted or active migration lock exists; stop services and inspect with recover')
}

/** Read-only preview by default. --apply imports only after explicit offline invocation. */
export async function migrateStore(cwd, { apply = false } = {}) {
  const root = rootOf(cwd)
  await noLock(root)
  if (!(await absent(join(root, 'learner.sqlite')))) fail('A learner database already exists; migration never overwrites it')
  if (await backendIdentity(root)) fail('Authoritative learner database is missing; retained JSON cannot be remigrated as current state')
  await noOrphanSidecars(root)
  const initial = await legacySnapshot(root)
  if (!initial.files.length) fail('No legacy learner records to migrate')
  const plan = { action: 'migrate', preview: !apply, ...summary(initial), materials: 'preserved as files; not part of this learner-record backup' }
  if (!apply) return plan
  const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomBytes(5).toString('hex')
  const backup = join(root, 'migrations', id)
  const stage = join(root, `.learner-${id}.pending.sqlite`)
  const lockPath = join(root, '.migration.lock')
  const lock = { format: FORMAT, id, pid: process.pid, digest: plan.digest, files: plan.files, createdAt: new Date().toISOString() }
  await writeExclusive(lockPath, JSON.stringify(lock, null, 2) + '\n')
  activeMigrations.add(lockPath)
  let staged = false, published = false, completed = false
  try {
    if (!sameFiles(initial.files, (await legacySnapshot(root)).files)) fail('Legacy records changed; stop services and preview again')
    if (!(await absent(join(root, 'learner.sqlite')))) fail('A learner database appeared; migration stopped')
    await directory(join(root, 'migrations'), true)
    await mkdir(join(root, 'migrations'), { recursive: true, mode: 0o700 })
    await directory(join(root, 'migrations'))
    await mkdir(backup, { mode: 0o700 })
    await mkdir(join(backup, 'legacy'), { mode: 0o700 })
    await mkdir(join(backup, 'legacy', 'kp'), { mode: 0o700 })
    for (const file of initial.files) await writeExclusive(join(backup, 'legacy', file.path), file.contents)
    await writeExclusive(join(backup, 'manifest.json'), JSON.stringify({ ...lock, counts: plan.counts, materialsIncluded: false }, null, 2) + '\n')
    for (const path of [join(backup, 'legacy', 'kp'), join(backup, 'legacy'), backup, join(root, 'migrations'), root]) await syncDirectory(path)
    createSqliteSnapshot(stage, initial.snapshot)
    staged = true
    const check = inspectSqlite(stage)
    const roundTrip = readSqliteSnapshot(stage).snapshot
    if (check.integrity !== 'ok' || snapshotDigest(roundTrip) !== plan.digest || JSON.stringify(counts(roundTrip)) !== JSON.stringify(plan.counts)) fail('Imported learner data did not pass integrity/roundtrip verification')
    if (!sameFiles(initial.files, (await legacySnapshot(root)).files)) fail('Legacy records changed during migration; database not published')
    await noOrphanSidecars(root)
    // link is atomic and refuses an existing destination; unlike rename it can never overwrite.
    await link(stage, join(root, 'learner.sqlite'))
    published = true
    await unlink(stage)
    staged = false
    await syncDirectory(root)
    await ensureIdentity(cwd, readSqliteSnapshot(join(root, 'learner.sqlite')).instanceId)
    await writeExclusive(join(backup, 'receipt.json'), JSON.stringify({ action: 'migrated', at: new Date().toISOString(), digest: plan.digest }, null, 2) + '\n')
    await syncDirectory(backup)
    completed = true
    return { ...plan, preview: false, backup, database: join(root, 'learner.sqlite'), integrity: check.integrity }
  } finally {
    if (!published || completed) {
      if (staged && !(await absent(stage))) await unlink(stage)
      await unlink(lockPath)
      await syncDirectory(root)
    }
    activeMigrations.delete(lockPath)
    // If publication succeeded but its receipt/cleanup failed, retain the lock:
    // explicit recovery verifies the database before allowing hosts to use it.
  }
}

function snapshotFiles(snapshot) {
  const files = []
  for (const [key, value] of Object.entries(snapshot.documents).sort(([a], [b]) => a.localeCompare(b))) {
    if (!['course', 'reviews', 'reminder'].includes(key) && !/^kp\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,79}$/.test(key)) fail('Unsupported learner document key in database')
    files.push({ path: `${key}.json`, contents: Buffer.from(JSON.stringify(value, null, 2) + '\n') })
  }
  for (const name of ['verifications', 'diagnoses']) {
    files.push({ path: `${name}.jsonl`, contents: Buffer.from(snapshot[name].map((value) => JSON.stringify(value) + '\n').join('')) })
  }
  return files
}

/** Export current SQLite state to a NEW directory; never restore stale retained JSON in place. */
export async function exportStore(cwd, output) {
  if (typeof output !== 'string' || !output.trim()) fail('Export needs --output pointing to a new directory')
  const root = rootOf(cwd), destination = resolve(output)
  await directory(root)
  await noLock(root)
  const db = join(root, 'learner.sqlite')
  await ordinaryFile(db)
  const { snapshot, revision, instanceId } = readSqliteSnapshot(db)
  if (!(await backendIdentity(root, instanceId))) fail('Learner backend identity is missing; recover interrupted publication before export')
  validateSnapshot(snapshot)
  const relativeOutput = relative(root, destination)
  if (!relativeOutput || (!relativeOutput.startsWith('..' + sep) && relativeOutput !== '..' && !relativeOutput.startsWith(sep))) fail('Export directory must be outside the source .learn directory')
  await directory(resolve(destination, '..'))
  await mkdir(destination, { mode: 0o700 }) // EEXIST intentionally refuses any existing destination.
  await mkdir(join(destination, '.learn'), { mode: 0o700 })
  await mkdir(join(destination, '.learn', 'kp'), { mode: 0o700 })
  const files = snapshotFiles(snapshot)
  for (const file of files) await writeExclusive(join(destination, '.learn', file.path), file.contents)
  const verify = await legacySnapshot(join(destination, '.learn'))
  if (snapshotDigest(verify.snapshot) !== snapshotDigest(snapshot)) fail('Export roundtrip verification failed; partial output retained for inspection')
  const result = { format: FORMAT, action: 'export', revision, digest: snapshotDigest(snapshot), counts: counts(snapshot), materialsIncluded: false }
  await writeExclusive(join(destination, 'learner-export.json'), JSON.stringify(result, null, 2) + '\n')
  return { ...result, output: destination }
}

/** Explicit recovery removes only this tool's lock after inspecting the publication state. */
export async function recoverMigration(cwd, { apply = false } = {}) {
  const root = rootOf(cwd), lockPath = join(root, '.migration.lock')
  await directory(root)
  if (!(await absent(join(root, '.initialization.json')))) fail('Initialization and migration markers overlap; manual inspection required')
  const lock = parseJson(await readBytes(lockPath), '.migration.lock')
  if (lock.format !== FORMAT || !Number.isInteger(lock.pid) || lock.pid < 1 || typeof lock.id !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(lock.id) || !/^[a-f0-9]{64}$/.test(lock.digest)) fail('Unknown migration lock; manual inspection required')
  const db = join(root, 'learner.sqlite'), backup = join(root, 'migrations', lock.id)
  const stage = join(root, `.learner-${lock.id}.pending.sqlite`)
  const published = !(await absent(db))
  let pendingAlias = false, databaseIdentity, identityNeeded = false, identityState = 'missing'
  if (!published && await backendIdentity(root)) fail('Authoritative learner database is missing; recovery cannot accept stale JSON')
  if (published) {
    const info = await lstat(db)
    if (!info.isFile() || info.isSymbolicLink()) fail('Published database is not an ordinary file')
    if (info.nlink !== 1) {
      const staged = await lstat(stage).catch((error) => { if (error.code === 'ENOENT') return null; throw error })
      if (info.nlink !== 2 || !staged?.isFile() || staged.isSymbolicLink() || staged.dev !== info.dev || staged.ino !== info.ino) fail('Published database has an unknown hard link; manual inspection required')
      pendingAlias = true
    }
    const check = inspectSqlite(db, pendingAlias ? { ownedAlias: stage } : undefined)
    if (check.integrity !== 'ok' || check.digest !== lock.digest) fail('Published database differs from the interrupted import; lock retained for manual inspection')
    databaseIdentity = check.instanceId
    const { checkSqliteIdentity } = await import('./store.js')
    identityState = await checkSqliteIdentity(cwd, databaseIdentity, { allowIncomplete: true })
    identityNeeded = identityState !== 'matching'
    if (JSON.stringify(manifestFiles((await legacySnapshot(root)).files)) !== JSON.stringify(lock.files)) fail('Legacy records changed after interrupted publication; lock retained for manual inspection')
    // Only the exact generated hardlink alias may be removed, after validation.
  }
  const result = { action: 'recover', preview: !apply, published, pendingAlias, identityNeeded, identityState, disposition: published ? 'verify and accept published database' : 'abort interrupted import; preserve original records' }
  if (!apply) return result
  let running = activeMigrations.has(lockPath)
  if (lock.pid !== process.pid) {
    try { process.kill(lock.pid, 0); running = true } catch (error) { if (error.code !== 'ESRCH') running = true }
  }
  if (running) fail('The migration process is still running; stop services before recovery')
  if (JSON.stringify(parseJson(await readBytes(lockPath), '.migration.lock')) !== JSON.stringify(lock)) fail('Migration lock changed during recovery; inspect it again')
  if (pendingAlias) await unlink(stage)
  if (published) await ensureIdentity(cwd, databaseIdentity, { recoverIncomplete: true })
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    const source = stage + suffix
    if (await absent(source)) continue
    await directory(join(root, 'migrations'), true)
    await mkdir(join(root, 'migrations'), { recursive: true, mode: 0o700 })
    await directory(join(root, 'migrations'))
    await directory(backup, true)
    await mkdir(backup, { recursive: true, mode: 0o700 })
    await directory(backup)
    const recovered = join(backup, 'recovered-pending.sqlite' + suffix)
    const staged = await lstat(source)
    const existing = await lstat(recovered).catch((error) => { if (error.code === 'ENOENT') return null; throw error })
    if (!staged.isFile() || staged.isSymbolicLink()) fail('Pending database artifact is not an ordinary file')
    if (existing) {
      if (!existing.isFile() || existing.isSymbolicLink() || staged.nlink !== 2 || existing.dev !== staged.dev || existing.ino !== staged.ino) fail('Unknown recovered pending database; manual inspection required')
    } else {
      if (staged.nlink !== 1) fail('Pending database has an unknown hard link; manual inspection required')
      await link(source, recovered)
    }
    await syncDirectory(backup)
    await syncDirectory(join(root, 'migrations'))
    await unlink(source)
  }
  if (await directory(backup, true)) await syncDirectory(backup)
  await unlink(lockPath)
  await syncDirectory(root)
  return { ...result, preview: false }
}

/** One explicit recovery entry point for initialization or legacy migration. */
export async function recoverStore(cwd, options = {}) {
  const root = rootOf(cwd)
  await directory(root)
  const migration = !(await absent(join(root, '.migration.lock')))
  const initialization = !(await absent(join(root, '.initialization.json')))
  if (migration && initialization) fail('Initialization and migration markers overlap; manual inspection required')
  if (initialization) {
    const { recoverInitialization } = await import('./store.js')
    return recoverInitialization(cwd, options)
  }
  if (migration) return recoverMigration(cwd, options)
  fail('No interrupted learner-store initialization or migration was found')
}
