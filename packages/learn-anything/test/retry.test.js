import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as store from '../src/host/store.js'
import { loadRetry, listMistakes } from '../src/host/retry.js'
import { verificationRecord, mistakesGet, ALL_TOOLS } from '../src/host/tools.js'
import { parseView } from '../src/host/render.js'
import { modelMastery } from '../src/host/mastery.js'
import { assessVerification } from './helpers/assessment.js'

async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'learn-retry-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const p = store.paths(cwd)
  await store.writeJson(p.course, { chapters: [{ kpIds: ['queue', 'facts'] }] })
  await store.writeJson(p.kp('queue'), { id: 'queue', title: '队列', kind: 'knowledge', phase: 'assess', models: [{ id: 'order', type: 'associative', input: '任务', output: '顺序', reference: '先进先出', phase: 'verify', targetMap: { examples: [] } }] })
  await store.writeJson(p.kp('facts'), { id: 'facts', title: '事实', kind: 'information', phase: 'memorize', facts: [{ prompt: '问', answer: '答' }], models: [] })
  const original = { id: 'v-old', kpId: 'queue', modelId: 'order', question: '原来的问题', answer: '错误答案', questionType: 'predict', verdict: 'wrong', sources: [], at: '2026-10-01T00:00:00Z' }
  await store.appendJsonl(p.verifications, original)
  return { cwd, p, original, env: { cwd, assessVerification, now: () => new Date('2026-10-02T00:00:00Z') } }
}

test('loadRetry requires a live mistake and the exact current target', async (t) => {
  const { cwd, p, original } = await fixture(t)
  assert.deepEqual(await loadRetry(cwd, original.id, { kpId: 'queue', modelId: 'order' }), original)
  for (const target of [{ kpId: 'queue', modelId: 'other' }, { kpId: 'facts', factId: 'fact-1' }, { kpId: 'queue', modelId: 'order', factId: 'x' }]) {
    await assert.rejects(loadRetry(cwd, original.id, target), /same kpId/)
  }
  await assert.rejects(loadRetry(cwd, 'missing'), /active wrong or partial/)
  await store.appendJsonl(p.verifications, { ...original, id: 'v-correct', verdict: 'correct' })
  await assert.rejects(loadRetry(cwd, 'v-correct'), /active wrong or partial/)
  await store.writeJson(p.course, { chapters: [{ kpIds: ['facts'] }] })
  await assert.rejects(loadRetry(cwd, original.id), /active wrong or partial/)
  assert.deepEqual(await listMistakes(cwd), [])
})

test('removed models and facts cannot be retried; legacy single fact remains usable', async (t) => {
  const { cwd, p, original } = await fixture(t)
  await store.appendJsonl(p.verifications, { ...original, id: 'v-fact', kpId: 'facts', modelId: undefined })
  assert.equal((await loadRetry(cwd, 'v-fact', { kpId: 'facts', factId: 'fact-1' })).factId, 'fact-1')
  const kp = await store.readJson(p.kp('facts'))
  kp.facts = [{ id: 'new', prompt: '新问', answer: '新答' }]
  await store.writeJson(p.kp('facts'), kp)
  await assert.rejects(loadRetry(cwd, 'v-fact'), /active wrong or partial/)
  const queue = await store.readJson(p.kp('queue'))
  queue.models = []
  await store.writeJson(p.kp('queue'), queue)
  await assert.rejects(loadRetry(cwd, original.id), /active wrong or partial/)
})

test('retry records use normal grading, compare answers and retain original history', async (t) => {
  const { cwd, p, original, env } = await fixture(t)
  const args = { kpId: 'queue', modelId: 'order', retryOf: original.id, question: '新情境下的任务顺序？', questionType: 'predict', answer: '正确顺序', verdict: 'correct', explainedRule: true }
  await assert.rejects(verificationRecord.execute({ ...args, question: '  原来的问题 \n' }, env), /new situation/)
  assert.equal((await store.readJsonl(p.verifications)).length, 1)
  const partial = parseView(await verificationRecord.execute({ ...args, verdict: 'partial' }, env))
  assert.equal(partial.retry.answer, original.answer)
  assert.ok((await listMistakes(cwd)).some((record) => record.id === original.id))
  const view = parseView(await verificationRecord.execute(args, env))
  assert.deepEqual(view.retry, { id: original.id, question: original.question, answer: original.answer, currentQuestion: args.question, currentAnswer: args.answer })
  const records = await store.readJsonl(p.verifications)
  assert.deepEqual(records[0], original)
  assert.equal(records.at(-1).retryOf, original.id)
  const kp = await store.readJson(p.kp('queue'))
  assert.equal(view.level.to, modelMastery(kp.models[0], records.map(({ retryOf, ...record }) => record)), 'retry uses ordinary mastery rules')
  assert.ok(!(await listMistakes(cwd)).some((record) => record.id === original.id))
})

test('mistakes_get lists newest first with bounds and kp filters', async (t) => {
  const { cwd, p, original, env } = await fixture(t)
  for (let i = 0; i < 35; i++) await store.appendJsonl(p.verifications, { ...original, id: `v-${i}`, at: `2026-10-02T00:00:${String(i).padStart(2, '0')}Z` })
  await store.appendJsonl(p.verifications, { ...original, id: 'v-fact', kpId: 'facts', modelId: undefined, verdict: 'partial' })
  assert.equal((await listMistakes(cwd, { limit: 100 })).length, 30)
  assert.equal((await listMistakes(cwd, { limit: 1 }))[0].id, 'v-34')
  assert.equal((await listMistakes(cwd, { kpId: 'facts' })).length, 1)
  assert.match(await mistakesGet.execute({ kpId: 'facts' }, env), /v-fact/)
  assert.match(await mistakesGet.execute({ kpId: 'missing' }, env), /没有可重赛/)
  assert.equal(ALL_TOOLS.find((tool) => tool.name === 'mistakes_get').readOnly, true)
})
