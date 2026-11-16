import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as store from '../src/host/store.js'
import { learnerDocument, learnerEvents } from '../eval/learner-store.js'

test('evaluation reads selected SQLite state and refuses stale legacy fallback after database loss', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'eval-sqlite-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const p = store.paths(cwd)
  await store.writeJson(p.course, { goal: 'authoritative' })
  assert.equal(learnerDocument(cwd, 'course').goal, 'authoritative')
  assert.deepEqual(learnerEvents(cwd, 'verifications'), [])
  await writeFile(p.course, JSON.stringify({ goal: 'stale retained backup' }))
  await rm(p.database)
  assert.throws(() => learnerDocument(cwd, 'course'), /selection is incomplete/)
})

test('evaluation supports intentional legacy stores and rejects orphaned SQLite without an identity', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'eval-legacy-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  await mkdir(store.paths(cwd).root)
  await writeFile(store.paths(cwd).course, JSON.stringify({ goal: 'legacy' }))
  assert.equal(learnerDocument(cwd, 'course').goal, 'legacy')
  const sql = await mkdtemp(join(tmpdir(), 'eval-orphan-'))
  t.after(() => rm(sql, { recursive: true, force: true }))
  await store.writeJson(store.paths(sql).course, { goal: 'sqlite' })
  await rm(store.paths(sql).backend)
  assert.throws(() => learnerDocument(sql, 'course'), /selection is incomplete/)
})

test('evaluation refuses pending initialization or migration even with a valid selected database', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'eval-pending-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  await store.writeJson(store.paths(cwd).course, { goal: 'sqlite' })
  for (const name of ['.initialization.json', '.migration.lock']) {
    const marker = join(store.paths(cwd).root, name)
    await writeFile(marker, '{}')
    assert.throws(() => learnerEvents(cwd, 'verifications'), /pending operation/)
    await rm(marker)
  }
})
