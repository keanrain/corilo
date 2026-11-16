import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, rename, symlink, link, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { courseSave, readOutline, saveOutline } from '../src/host/tools/course.js'
import * as store from '../src/host/store.js'
import { moveOutlineItem, outlineRequest } from '../src/client/outline.js'

async function setup(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'learn-outline-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  await courseSave.execute({ goal: '用户的目标', status: 'planning', learner: { background: '用户背景' }, resources: [], chapters: [{ title: '基础', kps: [
    { id: 'one', title: '一', kind: 'knowledge' }, { id: 'two', title: '二', kind: 'information', prerequisites: ['one'] },
  ] }] }, { cwd, now: () => new Date() })
  return cwd
}

test('direct outline editing preserves progress and removed data, supports skip/order/add/lock', async (t) => {
  const cwd = await setup(t)
  const kp = await store.requireKp(cwd, 'one')
  kp.models = [{ id: 'm', phase: 'verify', mastery: 'novice', targetMap: { statement: { text: '用户的规律' }, examples: [] } }]
  kp.mastery = 'novice'
  await store.writeJson(store.paths(cwd).kp('one'), kp)
  const current = await readOutline(cwd)
  const chapters = [{ title: '新标题', kps: [
    { ...current.view.chapters[0].kps[0], title: '重命名', skipped: true },
    { id: 'new', title: '新知识点', kind: 'knowledge', prerequisites: [], sources: [] },
  ] }]
  const result = await store.withWorkspaceWrite(cwd, () => saveOutline(cwd, { expected: current.revision, chapters, status: 'active' }))
  assert.equal(result.view.status, 'active')
  assert.deepEqual(result.view.chapters[0].kps.map((k) => k.id), ['one', 'new'])
  assert.equal(result.view.chapters[0].kps[0].skipped, true)
  const after = await store.requireKp(cwd, 'one')
  assert.deepEqual(after.models, kp.models)
  assert.equal(after.mastery, kp.mastery)
  assert.equal((await store.requireCourse(cwd)).learner.background, '用户背景')
  assert.equal((await store.requireKp(cwd, 'two')).title, '二', 'removed points retain their records')
  await assert.rejects(saveOutline(cwd, { expected: result.revision, chapters, status: 'planning' }), /locked/)
})

test('stale and malformed outline saves do not overwrite learning data', async (t) => {
  const cwd = await setup(t)
  const current = await readOutline(cwd)
  const chapters = current.view.chapters
  const one = await store.requireKp(cwd, 'one')
  one.mastery = 'novice'
  await store.writeJson(store.paths(cwd).kp('one'), one)
  await assert.rejects(saveOutline(cwd, { expected: current.revision, chapters, status: 'planning' }), /changed/)
  const fresh = await readOutline(cwd)
  for (const bad of [
    [{ title: '', kps: chapters[0].kps }],
    [{ title: 'x', kps: [{ ...chapters[0].kps[0], id: '../escape' }] }],
    [{ title: 'x', kps: [{ ...chapters[0].kps[0], prerequisites: ['one'] }] }],
    [{ title: 'x', kps: [{ ...chapters[0].kps[0], prerequisites: ['missing'] }] }],
  ]) {
    await assert.rejects(saveOutline(cwd, { expected: fresh.revision, chapters: bad, status: 'planning' }))
    assert.equal((await readOutline(cwd)).revision, fresh.revision)
  }
})

test('keyboard reorder helper is immutable and bounded', () => {
  const items = ['a', 'b', 'c']
  assert.deepEqual(moveOutlineItem(items, 0, 2), ['b', 'c', 'a'])
  assert.deepEqual(items, ['a', 'b', 'c'])
  assert.equal(moveOutlineItem(items, -1, 2), items)
})

test('outline transport reports host conflict instead of claiming a save', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async (_url, request) => {
    assert.equal(JSON.parse(request.body).sessionId, 'session')
    return { ok: false, status: 409, json: async () => ({ ok: false, error: { message: 'conflict' } }) }
  }
  try { await assert.rejects(outlineRequest('session', 'save', { expected: 'old' }), /conflict/) }
  finally { globalThis.fetch = original }
})


test('outline routes reject linked course, linked knowledge records, and forged mastery edits', async (t) => {
  const cwd = await setup(t)
  const current = await readOutline(cwd)
  const chapters = structuredClone(current.view.chapters)
  chapters[0].kps[0].mastery = 'expert'
  chapters[0].kps[0].models = [{ id: 'forged' }]
  await saveOutline(cwd, { expected: current.revision, chapters, status: 'planning' })
  assert.equal((await store.requireKp(cwd, 'one')).mastery, 'none')
  assert.deepEqual((await store.requireKp(cwd, 'one')).models, [])
  const p = store.paths(cwd)
  await rename(p.course, p.course + '.backup')
  await symlink(p.course + '.backup', p.course)
  await assert.rejects(readOutline(cwd), /Linked learning data/)
  await rm(p.course)
  await rename(p.course + '.backup', p.course)
  await link(p.kp('one'), p.kp('one') + '.backup')
  await assert.rejects(readOutline(cwd), /Linked learning data/)
  await rm(p.kp('one') + '.backup')
  const before = await readOutline(cwd)
  await writeFile(join(cwd, 'outside.json'), '{}')
  await symlink(join(cwd, 'outside.json'), p.kp('new'))
  await assert.rejects(saveOutline(cwd, { expected: before.revision, chapters: [{ title: 'x', kps: [{ id: 'new', title: 'x', kind: 'knowledge' }] }], status: 'planning' }), /Linked learning data/)
})

test('unsafe or malformed evidence cannot cause an outline save to fail after changing records', async (t) => {
  const cwd = await setup(t)
  const before = await readOutline(cwd)
  const chapters = structuredClone(before.view.chapters)
  chapters[0].title = 'should not be saved'
  const log = store.paths(cwd).verifications
  await symlink(store.paths(cwd).course, log)
  await assert.rejects(saveOutline(cwd, { expected: before.revision, chapters, status: 'planning' }), /Linked learning data/)
  await rm(log)
  await writeFile(log, 'malformed evidence\n')
  await assert.rejects(saveOutline(cwd, { expected: before.revision, chapters, status: 'planning' }))
  assert.equal((await readOutline(cwd)).revision, before.revision)
})
