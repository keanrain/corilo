/** Native learner database. Opening a database never creates or upgrades schema.
 * Snapshot APIs deliberately close each connection before returning/awaiting.
 * Migration tools create/import a standalone file and publish it separately.
 */
import { DatabaseSync } from 'node:sqlite'
import { openSync, closeSync, unlinkSync, lstatSync, fsyncSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { verified } from './mastery.js'

export const SQLITE_VERSION = 1
export const SQLITE_APPLICATION_ID = 0x434c524e // CLRN
export const emptySnapshot = () => ({ documents: Object.create(null), verifications: [], diagnoses: [] })
export const conflict = (message = 'Learning data changed in another process. Read the latest state before trying again.') => Object.assign(new Error(message), { status: 409, code: 'LEARN_CONFLICT' })

function regularFile(file, optional = false, ownedAlias) {
  let info
  try { info = lstatSync(file) } catch (error) { if (optional && error.code === 'ENOENT') return false; throw error }
  const alias = ownedAlias && lstatSync(ownedAlias)
  const ownedPair = alias && info.nlink === 2 && alias.nlink === 2 && alias.isFile() && !alias.isSymbolicLink() && alias.ino === info.ino && alias.dev === info.dev
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 && !ownedPair) throw new Error('Learner database and sidecars must be ordinary unlinked files')
  return true
}
export function validateSqliteFiles(file, { ownedAlias } = {}) {
  regularFile(file, false, ownedAlias)
  for (const suffix of ['-wal', '-shm', '-journal']) regularFile(file + suffix, true)
}
function openDatabase(file, readOnly = true, options) {
  if (!readOnly) { const checked = openDatabase(file, true, options); checked.close() }
  validateSqliteFiles(file, options)
  const db = new DatabaseSync(file, { readOnly, enableForeignKeyConstraints: true, timeout: 3000 })
  try {
    db.exec('PRAGMA busy_timeout = 3000')
    const app = db.prepare('PRAGMA application_id').get().application_id
    const version = db.prepare('PRAGMA user_version').get().user_version
    if (app !== SQLITE_APPLICATION_ID || version !== SQLITE_VERSION) throw new Error('Unsupported learner database identity or schema version; no automatic migration is performed')
    const meta = db.prepare('SELECT revision, instance_id FROM metadata WHERE singleton = 1').get()
    if (!meta || !Number.isSafeInteger(meta.revision) || meta.revision < 0 || typeof meta.instance_id !== 'string' || !meta.instance_id) throw new Error('Invalid learner database metadata')
    return db
  } catch (error) { db.close(); throw error }
}

function normalized(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.documents || typeof snapshot.documents !== 'object' || Array.isArray(snapshot.documents) || !Array.isArray(snapshot.verifications) || !Array.isArray(snapshot.diagnoses)) throw new Error('Invalid learner snapshot')
  for (const [key, value] of Object.entries(snapshot.documents)) {
    if (!['course', 'reviews', 'reminder'].includes(key) && !/^kp\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,79}$/.test(key)) throw new Error('Invalid learner document key')
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Learner documents must be JSON objects')
  }
  for (const rows of [snapshot.verifications, snapshot.diagnoses]) for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Learner events must be JSON objects')
  }
  return JSON.parse(JSON.stringify(snapshot))
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  return value
}
export function snapshotDigest(snapshot) {
  return createHash('sha256').update(JSON.stringify(canonical(normalized(snapshot)))).digest('hex')
}
export function snapshotCounts(snapshot) {
  const data = normalized(snapshot)
  return { documents: Object.keys(data.documents).length, knowledgePoints: Object.keys(data.documents).filter((key) => key.startsWith('kp/')).length, verifications: data.verifications.length, diagnoses: data.diagnoses.length }
}
function schema(db) {
  db.exec(`PRAGMA application_id = ${SQLITE_APPLICATION_ID}; PRAGMA user_version = ${SQLITE_VERSION};
    CREATE TABLE metadata (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), revision INTEGER NOT NULL CHECK(revision >= 0), instance_id TEXT NOT NULL);
    CREATE TABLE documents (key TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)));
    CREATE TABLE verifications (seq INTEGER PRIMARY KEY, id TEXT, kp_id TEXT, model_id TEXT, session_id TEXT, message_seq INTEGER, payload TEXT NOT NULL CHECK(json_valid(payload)));
    CREATE INDEX verification_target ON verifications(kp_id, model_id, seq);
    CREATE UNIQUE INDEX verified_answer_once ON verifications(session_id, message_seq) WHERE session_id IS NOT NULL;
    CREATE TABLE diagnoses (seq INTEGER PRIMARY KEY, id TEXT, kp_id TEXT, model_id TEXT, payload TEXT NOT NULL CHECK(json_valid(payload)));
    CREATE INDEX diagnosis_target ON diagnoses(kp_id, model_id, seq);`)
  db.prepare('INSERT INTO metadata VALUES (1, 0, ?)').run(randomUUID())
}
function replace(db, snapshot) {
  const data = normalized(snapshot)
  // Keep unchanged documents and event prefixes in place. Reads still use a
  // coherent full learner snapshot; this avoids rewriting its entire history
  // merely because a learner added an annotation or another verification.
  const previous = new Map(db.prepare('SELECT key,payload FROM documents').all().map((row) => [row.key, row.payload]))
  const put = db.prepare('INSERT INTO documents (key,payload) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload')
  const remove = db.prepare('DELETE FROM documents WHERE key=?')
  for (const [key, value] of Object.entries(data.documents)) {
    const payload = JSON.stringify(value)
    if (previous.get(key) !== payload) put.run(key, payload)
    previous.delete(key)
  }
  for (const key of previous.keys()) remove.run(key)
  const syncEvents = (table, rows) => {
    const old = db.prepare(`SELECT seq,payload FROM ${table} ORDER BY seq`).all()
    const payloads = rows.map((row) => JSON.stringify(row))
    let start = 0
    while (start < old.length && start < rows.length && old[start].seq === start && old[start].payload === payloads[start]) start++
    if (start === old.length && start === rows.length) return
    db.prepare(`DELETE FROM ${table} WHERE seq>=?`).run(start)
    const insert = table === 'verifications'
      ? db.prepare('INSERT INTO verifications (seq,id,kp_id,model_id,session_id,message_seq,payload) VALUES (?,?,?,?,?,?,?)')
      : db.prepare('INSERT INTO diagnoses (seq,id,kp_id,model_id,payload) VALUES (?,?,?,?,?)')
    for (let seq = start; seq < rows.length; seq++) {
      const row = rows[seq]
      const fields = [seq, row.id ?? null, row.kpId ?? null, row.modelId ?? null]
      if (table === 'verifications') fields.push(verified(row) ? row.evidence.sessionId : null, verified(row) ? row.evidence.messageSeq : null)
      insert.run(...fields, payloads[seq])
    }
  }
  syncEvents('verifications', data.verifications)
  syncEvents('diagnoses', data.diagnoses)
}

/** Exclusively create a standalone DELETE-journal DB; never overwrites a file. */
export function createSqliteSnapshot(file, snapshot = emptySnapshot()) {
  const data = normalized(snapshot)
  if (['-wal', '-shm', '-journal'].some((suffix) => regularFile(file + suffix, true))) throw new Error('Orphan learner database sidecars exist; preserve them for manual inspection')
  const fd = openSync(file, 'wx', 0o600)
  closeSync(fd)
  let db
  try {
    db = new DatabaseSync(file)
    db.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; BEGIN IMMEDIATE')
    schema(db)
    replace(db, data)
    db.exec('COMMIT')
    db.close(); db = null
    const directory = openSync(dirname(file), 'r'); try { fsyncSync(directory) } finally { closeSync(directory) }
    return inspectSqlite(file)
  } catch (error) {
    if (db) { try { db.exec('ROLLBACK') } catch {} db.close() }
    for (const suffix of ['', '-journal', '-wal', '-shm']) { try { unlinkSync(file + suffix) } catch (e) { if (e.code !== 'ENOENT') throw e } }
    throw error
  }
}

/** Metadata-only identity check; no schema writes or full history scan. */
export function sqliteIdentity(file) {
  const db = openDatabase(file)
  try {
    const meta = db.prepare('SELECT revision,instance_id FROM metadata WHERE singleton=1').get()
    return { version: SQLITE_VERSION, revision: meta.revision, instanceId: meta.instance_id }
  } finally { db.close() }
}

export function readSqliteSnapshot(file, options) {
  const db = openDatabase(file, true, options)
  try {
    db.exec('BEGIN')
    const meta = db.prepare('SELECT revision, instance_id FROM metadata WHERE singleton = 1').get()
    const snapshot = emptySnapshot()
    for (const row of db.prepare('SELECT key,payload FROM documents ORDER BY key').all()) snapshot.documents[row.key] = JSON.parse(row.payload)
    snapshot.verifications = db.prepare('SELECT payload FROM verifications ORDER BY seq').all().map((row) => JSON.parse(row.payload))
    snapshot.diagnoses = db.prepare('SELECT payload FROM diagnoses ORDER BY seq').all().map((row) => JSON.parse(row.payload))
    db.exec('COMMIT')
    return { snapshot: normalized(snapshot), revision: meta.revision, instanceId: meta.instance_id }
  } finally { db.close() }
}

/** Optimistic CAS: the caller has already performed all async work without a lock. */
export function commitSqliteSnapshot(file, snapshot, expectedRevision, expectedInstanceId) {
  const db = openDatabase(file, false)
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; BEGIN IMMEDIATE')
    const current = db.prepare('SELECT revision, instance_id FROM metadata WHERE singleton = 1').get()
    if (current.revision !== expectedRevision || expectedInstanceId && current.instance_id !== expectedInstanceId) throw conflict()
    replace(db, snapshot)
    db.prepare('UPDATE metadata SET revision = revision + 1 WHERE singleton = 1').run()
    db.exec('COMMIT')
    return expectedRevision + 1
  } catch (error) {
    try { db.exec('ROLLBACK') } catch {}
    if (/UNIQUE constraint failed: verifications\.session_id/.test(error.message)) throw conflict('This learner answer is already recorded; read the existing verification instead of replaying it.')
    throw error
  } finally { db.close() }
}

export function inspectSqlite(file, options) {
  const result = readSqliteSnapshot(file, options)
  const db = openDatabase(file, true, options)
  let integrity
  try { integrity = db.prepare('PRAGMA integrity_check').all().map((row) => row.integrity_check).join('\n') } finally { db.close() }
  if (integrity !== 'ok') throw new Error('Learner database integrity check failed')
  return { ...result, counts: snapshotCounts(result.snapshot), digest: snapshotDigest(result.snapshot), integrity }
}
