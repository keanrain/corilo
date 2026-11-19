import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as store from '../src/host/store.js'
import { validateComparison, conceptCompareView } from '../src/host/concept-compare.js'
import { ConceptCompareCard } from '../src/client/concept-compare.js'
import { forgottenExamples, examplePracticeText, grade, emptyReviews } from '../src/host/review.js'
import { diagnosisRecord, courseSave, kpDefineModels, reviewDue, verificationRecord } from '../src/host/tools.js'
import { parseView } from '../src/host/render.js'
import { assessVerification, evidence } from './helpers/assessment.js'

const comparison = {
  left: '正方形', right: '矩形', relation: 'subset',
  features: [{ feature: '四边等长', left: '必需', right: '非必需' }],
  examples: [{ input: '边长 2 的正方形', left: true, right: true, reason: '同时满足两种定义' }, { input: '长 3 宽 2 的矩形', left: false, right: true, reason: '相邻边不等长' }],
}
async function workspace(run) {
  const cwd = await mkdtemp(join(tmpdir(), 'learn-methodology-'))
  const env = { cwd, now: () => new Date('2026-11-16T08:00:00Z'), assessVerification }
  try {
    await courseSave.execute({ goal: '几何', status: 'active', learner: {}, chapters: [{ title: '形状', kps: [{ id: 'shape', title: '四边形', kind: 'knowledge' }] }] }, env)
    await kpDefineModels.execute({ kpId: 'shape', models: [{ id: 'a', type: 'discriminative', concept: '正方形', reference: '四边相等且四角直角' }] }, env)
    await run(env)
  } finally { await rm(cwd, { recursive: true, force: true }) }
}

test('concept confusion requires a valid comparison before persisting diagnosis or phase', async () => workspace(async (env) => {
  const args = { kpId: 'shape', modelId: 'a', findings: [{ type: 'concept-confusion', evidence: '将长方形称为正方形' }] }
  await assert.rejects(diagnosisRecord.execute(args, env), /requires comparison/)
  assert.deepEqual(await store.readJsonl(store.paths(env.cwd).diagnoses), [])
  assert.equal((await store.requireKp(env.cwd, 'shape')).models[0].phase, 'assess')
  const result = await diagnosisRecord.execute({ ...args, comparison }, env)
  assert.equal(parseView(result).view, 'concept-compare')
  assert.equal((await store.requireKp(env.cwd, 'shape')).models[0].phase, 'prescribe')
  assert.deepEqual((await store.readJsonl(store.paths(env.cwd).diagnoses))[0].comparison, comparison)
}))

test('comparison rejects contradictions and incomplete matrices; all relations render safely', () => {
  assert.throws(() => validateComparison({ ...comparison, relation: 'disjoint' }), /contradicts/)
  assert.throws(() => validateComparison({ ...comparison, features: [] }), /feature/)
  assert.throws(() => validateComparison({ ...comparison, examples: [{ ...comparison.examples[0], left: 'yes' }, comparison.examples[1]] }), /booleans/)
  for (const relation of ['equal', 'subset', 'superset', 'overlap', 'disjoint']) {
    const value = { ...comparison, relation, examples: relation === 'equal' ? [comparison.examples[0], { ...comparison.examples[0], input: '另一个共同例子' }] : relation === 'superset' ? comparison.examples.map((e) => ({ ...e, left: e.right, right: e.left })) : relation === 'disjoint' ? [{ ...comparison.examples[0], right: false }, comparison.examples[1]] : comparison.examples }
    const view = parseView(conceptCompareView({ id: 'shape', title: '<script>bad()</script>' }, { id: 'a' }, validateComparison(value)))
    const html = renderToStaticMarkup(createElement(ConceptCompareCard, { view }))
    assert.match(html, /<svg/)
    assert.match(html, /<table/)
    assert.match(html, /四边等长/)
    assert.doesNotMatch(html, /<script>/)
  }
})

test('forgotten examples retain evidence and expose only checked previously-correct model examples', () => {
  const model = { id: 'a', targetMap: { examples: [
    { id: 'ok', tag: 'v', checked: true, verificationId: 'good', input: 'old', output: 'answer' },
    { id: 'wrong', tag: 'v', checked: true, verificationId: 'wrong' },
    { id: 'unchecked', tag: 'v', verificationId: 'good' },
    { id: 'current', tag: 'v', checked: true, verificationId: 'current' },
    { id: 'other', tag: 'v', checked: true, verificationId: 'other' },
    { id: 'untrusted', tag: 'v', checked: true, verificationId: 'untrusted' },
  ] } }
  const before = JSON.stringify(model)
  const examples = forgottenExamples(model, [
    { id: 'good', modelId: 'a', verdict: 'correct', evidence: evidence() },
    { id: 'wrong', modelId: 'a', verdict: 'wrong', evidence: evidence() },
    { id: 'current', modelId: 'a', verdict: 'correct', evidence: evidence() },
    { id: 'untrusted', modelId: 'a', verdict: 'correct', evidence: {} },
    { id: 'other', modelId: 'b', verdict: 'correct', evidence: evidence() },
  ], 'current')
  assert.deepEqual(examples.map((e) => e.id), ['ok'])
  assert.equal(JSON.stringify(model), before)
  assert.match(examplePracticeText(examples), /purpose 设为 practice/)
})

test('a failed scheduled review returns old examples for practice immediately and when due again', async () => workspace(async (env) => {
  await verificationRecord.execute({ kpId: 'shape', modelId: 'a', question: '旧正例问题', questionType: 'discriminate-pos', answer: '是', verdict: 'correct', expected: { output: '是正方形' } }, env)
  const reviews = emptyReviews()
  grade(reviews, { id: 'shape/a', kpId: 'shape', modelId: 'a' }, 3, env.now())
  await store.writeJson(store.paths(env.cwd).reviews, reviews)
  const result = await verificationRecord.execute({ kpId: 'shape', modelId: 'a', question: '新问题', questionType: 'discriminate-neg', answer: '是', verdict: 'wrong' }, env)
  assert.match(result, /relearning-reference/)
  assert.match(result, /旧正例问题/)
  assert.equal((await store.requireKp(env.cwd, 'shape')).models[0].phase, 'assess')
  assert.equal((await store.requireKp(env.cwd, 'shape')).models[0].targetMap.examples[0].tag, 'v')
  env.now = () => new Date('2030-01-01T00:00:00Z')
  const due = await reviewDue.execute({}, env)
  assert.match(due, /relearning-reference/)
  assert.match(due, /旧正例问题/)
  assert.match(due, /正式验证仍须另出实质新情境/)
}))

test('fast-start prompts: one intake question, skeleton outline, probe card, editor-first statements', async () => {
  const { readFile } = await import('node:fs/promises')
  const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8')
  const plan = await read('skills/plan-course/SKILL.md')
  assert.match(plan, /只问一个问题/)
  assert.match(plan, /前两个知识点写完整/)
  assert.match(plan, /联网调研（可选/)
  assert.doesNotMatch(plan, /第二步：确认并锁定/)
  assert.match(await read('skills/diagnose/SKILL.md'), /一张\*\*理解练习题卡当探针/)
  const coach = await read('skills/coach-statements/SKILL.md')
  assert.match(coach, /编辑靶图/)
  assert.match(coach, /direct-edit/)
  const { PHASE_GUIDE } = await import('../src/host/phases.js')
  assert.match(PHASE_GUIDE.build, /编辑靶图/)
  assert.match(PHASE_GUIDE.assess, /探针/)
  assert.match(await read('prompts/persona.md'), /编辑靶图/)
})
