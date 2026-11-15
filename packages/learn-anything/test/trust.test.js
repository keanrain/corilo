import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as tools from '../src/host/tools.js'
import { modelMastery, informationMastery } from '../src/host/mastery.js'

async function workspace(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'learn-trust-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const env = { cwd, now: () => new Date(), userTexts: () => null }
  await tools.courseSave.execute({ goal: '学习', status: 'active', chapters: [{ title: 'ch', kps: [
    { id: 'advanced', title: '高级内容', kind: 'knowledge', prerequisites: ['basic'] },
    { id: 'basic', title: '基础', kind: 'knowledge' },
  ] }] }, env)
  await tools.kpDefineModels.execute({ kpId: 'basic', models: [{ id: 'm', type: 'discriminative', concept: '规则', reference: '参考规律' }] }, env)
  return env
}

test('invented correct answers without session/examiner evidence cannot be recorded', async (t) => {
  const env = await workspace(t)
  for (const questionType of ['scenario', 'discriminate-neg', 'rephrase']) await assert.rejects(tools.verificationRecord.execute({
    kpId: 'basic', modelId: 'm', question: `虚构的${questionType}题`, questionType, answer: '虚构的答案', verdict: 'correct',
  }, env), /evidence|会话|证据/)
  await assert.rejects(readFile(join(env.cwd, '.learn/verifications.jsonl')), { code: 'ENOENT' })
})

test('missing learner history and fragments of help requests cannot establish a rule', async (t) => {
  const env = await workspace(t)
  for (const texts of [null, ['【学习补给】这个词不懂：参考规律'], ['不知道参考规律是什么']]) {
    env.userTexts = () => texts
    await assert.rejects(tools.targetMapUpdate.execute({ kpId: 'basic', modelId: 'm', statement: '参考规律' }, env))
  }
})

test('legacy self-reported successes do not establish trusted mastery', () => {
  const records = ['scenario', 'discriminate-neg', 'rephrase'].map((questionType) => ({ questionType, verdict: 'correct' }))
  assert.equal(modelMastery({ targetMap: { examples: [] } }, records), 'none')
  assert.equal(informationMastery([{ questionType: 'recall', verdict: 'correct' }, { questionType: 'recall', verdict: 'correct' }]), 'none')
})

test('selection follows prerequisites even when the outline puts advanced content first', async (t) => {
  const env = await workspace(t)
  assert.match(await tools.learnStatus.execute({}, env), /当前知识点：基础/)
})

test('skip requires learner intent, does not claim mastery, and can be restored', async (t) => {
  const env = await workspace(t)
  await assert.rejects(tools.kpSkip.execute({ kpId: 'basic', skipped: true }, env), /明确请求/)
  env.userTexts = () => ['请跳过基础']
  await tools.kpSkip.execute({ kpId: 'basic', skipped: true }, env)
  assert.match(await tools.learnStatus.execute({}, env), /当前知识点：高级内容/)
  env.userTexts = () => ['恢复基础']
  await tools.kpSkip.execute({ kpId: 'basic', skipped: false }, env)
  assert.match(await tools.learnStatus.execute({}, env), /当前知识点：基础/)
})

test('cyclic prerequisites are rejected before saving any course change', async (t) => {
  const env = await workspace(t)
  const before = await readFile(join(env.cwd, '.learn/course.json'), 'utf8')
  await assert.rejects(tools.courseSave.execute({ goal: '循环', status: 'active', chapters: [{ title: 'ch', kps: [
    { id: 'a', title: 'a', kind: 'knowledge', prerequisites: ['b'] },
    { id: 'b', title: 'b', kind: 'knowledge', prerequisites: ['a'] },
  ] }] }, env), /cyclic/)
  assert.equal(await readFile(join(env.cwd, '.learn/course.json'), 'utf8'), before)
})
