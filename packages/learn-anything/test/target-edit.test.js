import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as store from '../src/host/store.js'
import { readTargetMap, saveTargetMap } from '../src/host/target-edit.js'
import { editModels } from '../src/client/target-editor.js'
const fixture = async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'learn-target-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const kp = { id: 'kp', kind: 'knowledge', title: 'Demo', phase: 'build', mastery: 'none', models: [{ id: 'm', type: 'discriminative', concept: 'A', phase: 'build', mastery: 'none', targetMap: { statement: { text: 'old words', history: [], at: 'old' }, examples: [
    { id: 'v1', tag: 'v', origin: 'verification', checked: true, input: 'exam', output: 'answer' },
    { id: 'u1', tag: 'e', origin: 'user', input: 'personal', output: 'answer' },
  ] } }] }
  await store.writeJson(store.paths(cwd).kp('kp'), kp)
  await store.appendJsonl(store.paths(cwd).verifications, { id: 'r1', kpId: 'kp', modelId: 'm', question: 'exam', verdict: 'correct' })
  return cwd
}
test('direct notes persist human provenance, annotations and examples without changing grades', async (t) => {
  const cwd = await fixture(t)
  const original = await readTargetMap(cwd, 'kp')
  const models = editModels(original.view)
  models[0].statement = '判别标准：只要满足 X 就是 Y？'
  models[0].annotation = 'My note'
  models[0].examples = [{ input: 'new', output: 'personal', polarity: 'neg' }]
  const beforeRecords = await store.readJsonl(store.paths(cwd).verifications)
  const saved = await store.withWorkspaceWrite(cwd, () => saveTargetMap(cwd, { kpId: 'kp', expected: original.revision, models }))
  assert.notEqual(saved.revision, original.revision)
  assert.equal(saved.view.models[0].annotation, 'My note')
  const kp = await store.requireKp(cwd, 'kp')
  assert.equal(kp.models[0].targetMap.statement.entry, 'direct-edit')
  assert.equal(kp.models[0].targetMap.statement.history[0].text, 'old words')
  assert.deepEqual(kp.models[0].targetMap.examples[0], { id: 'v1', tag: 'v', origin: 'verification', checked: true, input: 'exam', output: 'answer' })
  assert.equal(kp.models[0].targetMap.examples[1].checked, false)
  assert.equal(kp.models[0].mastery, 'none')
  assert.deepEqual(await store.readJsonl(store.paths(cwd).verifications), beforeRecords)
  await assert.rejects(saveTargetMap(cwd, { kpId: 'kp', expected: original.revision, models }), (e) => e.status === 409)
})
test('reject forged evidence flags, traversal, and linked storage', async (t) => {
  const cwd = await fixture(t)
  const original = await readTargetMap(cwd, 'kp')
  const models = editModels(original.view)
  models[0].examples[0].checked = true
  await assert.rejects(saveTargetMap(cwd, { kpId: 'kp', expected: original.revision, models }), /Invalid personal example/)
  await assert.rejects(readTargetMap(cwd, '../outside'), /invalid id/)
  await symlink(store.paths(cwd).kp('kp'), store.paths(cwd).kp('linked'))
  await assert.rejects(readTargetMap(cwd, 'linked'), /Linked learning data/)
})

test('authenticated route resolves only known host sessions and rejects conflicting edits', async (t) => {
  const { registerLearningApi } = await import('../src/host/ui.js')
  const cwd = await fixture(t)
  const routes = new Map()
  registerLearningApi({ effect: (fn) => fn(), connection: { fetch: { register: (route) => routes.set(route.path, route) } }, sessions: { get: (id) => id === 'known' ? { header: { cwd, agentPreset: 'learn-tutor' } } : id === 'examiner' ? { header: { cwd, agentPreset: 'learn-examiner' } } : id === 'child' ? { header: { cwd, agentPreset: 'learn-tutor', origin: 'subagent' } } : null } })
  const send = (action, args) => routes.get('/api/learn-anything/target/' + action).fetch(new Request('http://localhost/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) }))
  assert.equal((await send('read', { sessionId: 'missing', kpId: 'kp', cwd })).status, 404)
  assert.equal((await send('read', { sessionId: 'examiner', kpId: 'kp' })).status, 403)
  assert.equal((await send('save', { sessionId: 'child', kpId: 'kp' })).status, 403)
  assert.equal((await send('read', { sessionId: 'known', kpId: 'kp', large: '中'.repeat(100000) })).status, 413)
  const current = (await (await send('read', { sessionId: 'known', kpId: 'kp' })).json()).value
  const args = { sessionId: 'known', kpId: 'kp', expected: current.revision, models: editModels(current.view) }
  args.models[0].statement = 'directly typed'
  assert.equal((await send('save', args)).status, 200)
  assert.equal((await send('save', args)).status, 409)
})

test('linked evidence is rejected before exposing its contents', async (t) => {
  const cwd = await fixture(t)
  await rm(store.paths(cwd).verifications)
  await symlink(store.paths(cwd).kp('kp'), store.paths(cwd).verifications)
  await assert.rejects(readTargetMap(cwd, 'kp'), /Linked learning data/)
})
