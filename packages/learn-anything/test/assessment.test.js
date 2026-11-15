import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { answerEvidence, assessAnswer } from '../src/host/assessment.js'
import { marker } from '../src/host/render.js'
import { formatQuizAnswer } from '../src/quiz/answer.js'
import * as tools from '../src/host/tools.js'
import { modelMastery } from '../src/host/mastery.js'

const question = '换一个领域判断条件是否充分，并说明理由。'
const user = (text) => ({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
const shown = (purpose = 'verify') => ({ type: 'tool/result', data: { message: { content: [{ type: 'text', text: marker({ view: 'quiz', id: 'q-auth', question, purpose, ui: 'root = Quiz("真实问题", "scenario", [Reason("说明理由")], 2)' }) }] } } })
const answer = formatQuizAnswer({ id: 'q-auth', title: '真实问题', answers: [{ prompt: '说明理由', value: '我认为只要出现结果，就证明这一个原因。' }], confidence: 'guess' })
const session = (events) => ({ id: 'real-session', seq: events.length, eventAt: (i) => events[i] })
const grade = { verdict: 'wrong', questionType: 'scenario', difficulty: 2, novel: true, explainedRule: false, feedback: '结论不能唯一推出原因', output: '还需要排除其他原因' }

test('grading uses the actual shown card and learner event, not the tutor supplied answer/verdict', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'learn-assess-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const events = [shown(), user('【学习补给】这个词不懂\n（互动题 q-auth）'), user(answer)]
  const env = { cwd, now: () => new Date(), assessVerification: (args, context) => assessAnswer(session(events), args, context, async ({ prompt }) => {
    assert.equal(JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n') + 2)).learnerAnswer, answer)
    assert.ok(!prompt.includes('导师虚构的正确回答'))
    return JSON.stringify(grade)
  }) }
  await tools.courseSave.execute({ goal: '辨因果', status: 'active', chapters: [{ title: '规律', kps: [{ id: 'cause', title: '因果', kind: 'knowledge' }] }] }, env)
  await tools.kpDefineModels.execute({ kpId: 'cause', models: [{ id: 'm', type: 'discriminative', concept: '充分证据', reference: '一个结果可能有多个原因' }] }, env)
  const args = { kpId: 'cause', modelId: 'm', question, questionType: 'transfer', answer: '导师虚构的正确回答', verdict: 'correct', hintsUsed: 0, confidence: 'sure' }
  await tools.verificationRecord.execute(args, env)
  const records = (await readFile(join(cwd, '.learn/verifications.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
  assert.equal(records[0].answer, answer)
  assert.equal(records[0].verdict, 'wrong')
  assert.equal(records[0].questionType, 'scenario')
  assert.equal(records[0].confidence, 'guess')
  assert.equal(records[0].hintsUsed, 1)
  assert.match(records[0].evidence.examinerDigest, /^[a-f0-9]{64}$/)
  await assert.rejects(tools.verificationRecord.execute(args, env), /已记录/)
  assert.equal((await readFile(join(cwd, '.learn/verifications.jsonl'), 'utf8')).trim().split('\n').length, 1)
})

test('practice, missing messages, controls, different cards and invented questions fail closed', () => {
  for (const events of [[], [shown()], [user(answer)], [shown('practice'), user(answer)],
    [shown(), user('【求提示】真实问题\n（互动题 q-auth）')], [shown(), user(answer.replace('q-auth', 'q-other'))]]) {
    assert.throws(() => answerEvidence(session(events), question))
  }
  assert.throws(() => answerEvidence(session([shown(), user(answer)]), '未展示的题目'))
})

test('unavailable, incomplete or deferred examiner results cannot produce an assessment', async () => {
  const args = { question }, context = { target: {}, reference: '规律', records: [], examples: [] }
  for (const output of ['not JSON', '{}', JSON.stringify({ ...grade, verdict: 'deferred' }), JSON.stringify({ ...grade, novel: undefined })]) {
    await assert.rejects(assessAnswer(session([shown(), user(answer)]), args, context, async () => output))
  }
  await assert.rejects(assessAnswer(session([shown(), user(answer)]), args, context, async () => { throw new Error('request failed') }))
})

test('body repetitions cannot launder a practice card or erase help history', () => {
  const body = { type: 'assistant/message', data: { content: [{ type: 'text', text: question }] } }
  assert.throws(() => answerEvidence(session([shown('practice'), body, user('我认为这里的条件是充分的。')]), question))
  const result = answerEvidence(session([shown(), user('【求提示】再提示一下\n（互动题 q-auth）'), body, user(answer)]), question)
  assert.equal(result.hintsUsed, 1)
  assert.equal(result.evidence.questionSeq, 0)
  assert.throws(() => answerEvidence(session([body, user('[SCHEDULE REMINDER BATCH]\nThis is a scheduled message from the user')]), question))
})

test('a repeated practice question cannot become independent mastery even if the examiner calls it novel', async () => {
  const events = [shown('practice'), user('我先练过这道题。'), shown(), user(answer)]
  const result = await assessAnswer(session(events), { question }, { target: {}, reference: '规律', records: [], examples: [] },
    async () => JSON.stringify({ ...grade, verdict: 'correct', novel: true }))
  assert.equal(result.novel, false)
  assert.equal(modelMastery({ targetMap: { examples: [] } }, [result]), 'none')
})
