import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { mkdtemp, mkdir, readFile, writeFile, readdir, lstat, link, rename, rm } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as store from '../src/host/store.js'
import { createSqliteSnapshot, readSqliteSnapshot, snapshotDigest } from '../src/host/sqlite-store.js'

async function fixture(t, state = 'pending') {
  const cwd = await mkdtemp(join(tmpdir(), 'learn-init-review-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const p = store.paths(cwd)
  await mkdir(p.root)
  const snapshot = { documents: { course: { goal: 'staged before interruption', chapters: [] } }, verifications: [], diagnoses: [] }
  const name = '.learner-2147483647-abcdef12.sqlite'
  const candidate = join(p.root, name)
  const marker = join(p.root, '.initialization.json')
  createSqliteSnapshot(candidate, snapshot)
  await writeFile(marker, JSON.stringify({ version: 1, pid: 2147483647, candidate: name, digest: snapshotDigest(snapshot) }))
  if (state === 'published-alias') await link(candidate, p.database)
  if (state === 'published') {
    await rename(candidate, p.database)
    await store.ensureSqliteIdentity(cwd, readSqliteSnapshot(p.database).instanceId)
  }
  return { cwd, p, candidate, marker, snapshot }
}
async function inventory(root, relative = '') {
  const result = {}
  for (const name of (await readdir(join(root, relative))).sort()) {
    const path = relative ? `${relative}/${name}` : name
    const info = await lstat(join(root, path))
    result[path] = info.isDirectory() ? { directory: true } : { bytes: (await readFile(join(root, path))).toString('base64'), links: info.nlink }
    if (info.isDirectory()) Object.assign(result, await inventory(root, path))
  }
  return result
}
const restored = '{"goal":"restored later and must remain visible"}\n'

test('initialization preview and apply reject restored learner files without changing any bytes or links', async (t) => {
  for (const state of ['pending', 'published', 'published-alias']) {
    for (const record of ['course.json', 'reviews.json', 'reminder.json', 'verifications.jsonl', 'diagnoses.jsonl', 'kp/restored.json']) {
      await t.test(`${state}: ${record}`, async (t) => {
        const { cwd, p } = await fixture(t, state)
        if (record.startsWith('kp/')) await mkdir(p.kpDir)
        await writeFile(join(p.root, record), restored)
        const before = await inventory(p.root)
        for (const apply of [false, true]) {
          await assert.rejects(store.recoverInitialization(cwd, { apply }), (error) => error.status === 409 && /Legacy learner data appeared/.test(error.message))
          assert.deepEqual(await inventory(p.root), before)
        }
      })
    }
  }
})

test('pending and published initialization still recover when no legacy records appeared', async (t) => {
  for (const state of ['pending', 'published', 'published-alias']) {
    await t.test(state, async (t) => {
      const { cwd, p, snapshot } = await fixture(t, state)
      const before = await inventory(p.root)
      await store.recoverInitialization(cwd)
      assert.deepEqual(await inventory(p.root), before, 'preview is read-only')
      await store.recoverInitialization(cwd, { apply: true })
      assert.equal(await store.backend(cwd), 'sqlite')
      assert.deepEqual(await store.readJson(p.course), snapshot.documents.course)
      assert.ok(!(await readdir(p.root)).includes('.initialization.json'))
      await assert.rejects(lstat(p.course), { code: 'ENOENT' })
    })
  }
})

test('apply rechecks for restored JSON after validation and before publishing', async (t) => {
  const { cwd, p, marker } = await fixture(t)
  const before = await inventory(p.root)
  const original = fs.readFile
  let manifestReads = 0
  fs.readFile = async (...args) => {
    const bytes = await original(...args)
    if (String(args[0]) === marker && ++manifestReads === 2) await writeFile(p.course, restored)
    return bytes
  }
  syncBuiltinESMExports()
  try {
    await assert.rejects(store.recoverInitialization(cwd, { apply: true }), /Legacy learner data appeared/)
  } finally { fs.readFile = original; syncBuiltinESMExports() }
  assert.equal(manifestReads, 2)
  assert.equal(await readFile(p.course, 'utf8'), restored)
  await assert.rejects(lstat(p.database), { code: 'ENOENT' })
  const after = await inventory(p.root)
  delete after['course.json']
  assert.deepEqual(after, before)
})

test('apply retains its marker if restored JSON appears before cleanup', async (t) => {
  const { cwd, p, marker, snapshot } = await fixture(t)
  const markerBytes = await readFile(marker)
  const original = fs.open
  fs.open = async (...args) => {
    const handle = await original(...args)
    if (String(args[0]) === p.backend && args[1] === 'wx') await writeFile(p.course, restored)
    return handle
  }
  syncBuiltinESMExports()
  try {
    await assert.rejects(store.recoverInitialization(cwd, { apply: true }), /Legacy learner data appeared/)
  } finally { fs.open = original; syncBuiltinESMExports() }
  assert.equal(await readFile(p.course, 'utf8'), restored)
  assert.deepEqual(await readFile(marker), markerBytes)
  assert.deepEqual(readSqliteSnapshot(p.database).snapshot.documents.course, snapshot.documents.course)
  await assert.rejects(store.backend(cwd), /initialization is in progress or interrupted/)
})
