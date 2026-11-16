/** Cross-process recovery exclusion. The persistent empty file is only an OS
 * lock target, not learner state. The memory journal avoids disk sidecars;
 * BEGIN IMMEDIATE holds its reserved OS lock until rollback/close, and process
 * exit releases the lock. The coordinator remains empty: no schema/data writes.
 * Never unlink the file: doing so would create a second independent lock inode.
 */
import { DatabaseSync } from 'node:sqlite'
import { closeSync, lstatSync, openSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'

const active = new AsyncLocalStorage()
const locked = () => Object.assign(new Error('Another learner recovery is running; wait for it to finish and inspect the latest state before trying again.'), { status: 409, code: 'LEARN_RECOVERY_BUSY' })
const rootOf = (cwd) => {
  const path = join(resolve(cwd), '.learn')
  const info = lstatSync(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Recovery store directory must not be linked or special')
  return realpathSync(path)
}
// Resolve the caller's workspace alias once; later alias retargets cannot move
// preflight or mutation to a different workspace than the one protected.
export function canonicalRecoveryWorkspace(cwd) {
  const workspace = realpathSync(resolve(cwd))
  rootOf(workspace)
  return workspace
}
function ordinaryEmpty(file) {
  const info = lstatSync(file)
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== 0) throw new Error('Recovery coordinator must be an ordinary empty unlinked file')
}
function noSidecars(file) {
  for (const suffix of ['-journal', '-wal', '-shm']) {
    try { lstatSync(file + suffix) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
    throw new Error('Unexpected recovery coordinator sidecar; preserve it for manual inspection')
  }
}

export function assertRecoveryLease(cwd) {
  const lease = active.getStore()
  if (!lease?.active || lease.root !== rootOf(cwd)) throw new Error('Identity repair requires exclusive learner recovery')
}

export async function withRecoveryLease(cwd, operation) {
  const root = rootOf(cwd)
  if (active.getStore()) throw locked()
  const file = join(root, '.recovery-lock.sqlite')
  try { closeSync(openSync(file, 'wx', 0o600)) } catch (error) { if (error.code !== 'EEXIST') throw error }
  ordinaryEmpty(file)
  noSidecars(file)
  let db
  const lease = { root, active: false }
  try {
    try {
      db = new DatabaseSync(file, { timeout: 0 })
      db.exec('PRAGMA journal_mode = MEMORY; PRAGMA busy_timeout = 0; BEGIN IMMEDIATE')
    } catch (error) {
      if (error.errcode === 5 || error.errcode === 6 || /database (?:is )?(?:locked|busy)/iu.test(error.message)) throw locked()
      throw error
    }
    lease.active = true
    return await active.run(lease, operation)
  } finally {
    lease.active = false
    if (db) { try { db.exec('ROLLBACK') } catch {} db.close() }
  }
}
