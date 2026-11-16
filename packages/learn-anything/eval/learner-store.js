// Read the authoritative learner backend for evaluation without creating files.
// JSON remains supported for deliberately retained legacy workspaces.
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readSqliteSnapshot } from '../src/host/sqlite-store.js'

const present = (file) => { try { lstatSync(file); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error } }
const database = (cwd) => join(cwd, '.learn', 'learner.sqlite')
function selectedSnapshot(cwd) {
  const root = join(cwd, '.learn'), file = database(cwd), marker = join(root, '.backend.json')
  if (['.initialization.json', '.migration.lock'].some((name) => present(join(root, name)))) throw new Error('Learner storage has a pending operation; evaluation requires explicit recovery first')
  const hasDatabase = present(file), hasMarker = present(marker)
  if (!hasDatabase && ['-wal', '-shm', '-journal'].some((suffix) => present(file + suffix))) throw new Error('Orphan learner database sidecars require inspection before evaluation')
  if (!hasDatabase && !hasMarker) return null
  if (!hasDatabase || !hasMarker) throw new Error('Learner backend selection is incomplete; evaluation cannot fall back to another store')
  const info = lstatSync(marker)
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 4096) throw new Error('Invalid learner backend identity')
  const identity = JSON.parse(readFileSync(marker, 'utf8'))
  const stored = readSqliteSnapshot(file)
  if (identity?.version !== 1 || identity.backend !== 'sqlite' || identity.instanceId !== stored.instanceId) throw new Error('Learner backend identity does not select this database')
  return stored.snapshot
}
export function learnerDocument(cwd, key, fallback = null) {
  const snapshot = selectedSnapshot(cwd)
  if (snapshot) return snapshot.documents[key] ?? fallback
  const file = join(cwd, '.learn', `${key}.json`)
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback
}
export function learnerEvents(cwd, kind) {
  if (!['verifications', 'diagnoses'].includes(kind)) throw new Error('Unknown learner event collection')
  const snapshot = selectedSnapshot(cwd)
  if (snapshot) return snapshot[kind]
  const file = join(cwd, '.learn', `${kind}.jsonl`)
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map(JSON.parse) : []
}
