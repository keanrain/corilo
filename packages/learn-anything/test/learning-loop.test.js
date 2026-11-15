import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreLearningLoop } from '../eval/learning-loop.js'
import { marker } from '../src/host/render.js'
import { formatQuizAnswer } from '../src/quiz/answer.js'

const call = (id, name, args = {}) => ({ type: 'tool/call', data: { callId: id, name, arguments: JSON.stringify(args) } })
const result = (id, value) => ({ type: 'tool/result', data: { message: { toolCallId: id, content: [{ type: 'text', text: value }] } } })
const user = (text) => ({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
const answer = (id, hints) => formatQuizAnswer({ id, title: '本题', answers: [{ prompt: '推理', value: id === 'first' ? assisted.answer : independent.answer }], confidence: 'sure', hints })
const baseline = { records: [], mastery: 'none', progress: { streak: { have: 0, need: 3 } }, reviews: null }
const assisted = { kpId: 'task-routing', modelId: 'route', question: '第一场景问题', answer: '先检查等待位是否已满，再决定排队、加机或拒绝。', verdict: 'correct', hintsUsed: 1, confidence: 'sure' }
const independent = { kpId: 'task-routing', modelId: 'route', question: '第二场景问题', answer: '等候区还有空位就排队，即使处理位已到上限也不拒绝。', verdict: 'correct', hintsUsed: 0, confidence: 'sure' }
const states = [baseline, baseline, baseline, { ...baseline, mastery: 'novice', records: [assisted] }, { ...baseline, mastery: 'novice', records: [assisted, independent], progress: { streak: { have: 1, need: 3 } } }]
const events = [
  call('q1', 'quiz_show'), result('q1', marker({ view: 'quiz', id: 'first', ui: '第一场景' })),
  user('【学习补给】等待区是什么意思？\n（互动题 first）'),
  user(answer('first', 1)), call('g1', 'examiner', { prompt: assisted.answer }), result('g1', '【判定】correct'), call('r1', 'verification_record', assisted), result('r1', '已记录'),
  call('q2', 'quiz_show'), result('q2', marker({ view: 'quiz', id: 'next', ui: '新场景' })),
  user(answer('next', 0)), call('g2', 'examiner', { prompt: independent.answer }), result('g2', '【判定】correct'), call('r2', 'verification_record', independent), result('r2', '已记录'),
]
const checkpoints = [0, 2, 3, 10, events.length].map((eventSeq, i) => ({ eventSeq, state: states[i] }))

test('learning-loop acceptance also validates host-owned grading without tutor-supplied verdicts', () => {
  const proof = (messageSeq) => ({ version: 1, sessionId: 'host-session', messageSeq, questionSeq: 0, examinerDigest: 'b'.repeat(64) })
  const records = [{ ...assisted, answer: answer('first', 1), evidence: proof(3) }, { ...independent, answer: answer('next', 0), evidence: proof(10) }]
  const changed = events.map((event, seq) => {
    if ([4, 5, 11, 12].includes(seq)) return { type: 'test/unused', seq }
    if ([6, 13].includes(seq)) {
      const record = records[seq === 6 ? 0 : 1]
      return { ...call(`host-${seq}`, 'verification_record', { kpId: record.kpId, modelId: record.modelId, question: record.question }), seq }
    }
    return { ...event, seq }
  })
  const saved = checkpoints.map((c) => ({ ...c, state: { ...c.state, records: records.slice(0, c.state.records.length) } }))
  assert.equal(scoreLearningLoop(changed, saved).passed, true)
  assert.equal(scoreLearningLoop(changed, saved.map((c) => ({ ...c, state: { ...c.state,
    records: c.state.records.map((r) => ({ ...r, evidence: { ...r.evidence, messageSeq: 2 } })) } }))).passed, false)
})

test('learning loop requires same-card assisted practice then a fresh independent clean answer', () => {
  assert.equal(scoreLearningLoop(events, checkpoints).passed, true)
  assert.equal(scoreLearningLoop(events.map((e) => e === events[11] ? call('g2', 'examiner', { prompt: '旧题答案' }) : e), checkpoints).passed, false, 'fresh answer must actually reach the examiner')
  assert.equal(scoreLearningLoop(events.filter((e) => e !== events[3]), checkpoints).passed, false, 'cannot skip original answer')
  assert.equal(scoreLearningLoop(events.map((e) => e === events[10] ? user(answer('first', 0)) : e), checkpoints).passed, false, 'old card is not fresh evidence')
  assert.equal(scoreLearningLoop(events, checkpoints.map((c, i) => i === 4 ? { ...c, state: { ...c.state, progress: { streak: { have: 2 } } } } : c)).passed, false, 'assisted answer cannot contribute to streak')
  const operator = '当 x < 3 时排队，否则拒绝；新增成本是 y + 1。'
  const modified = { ...independent, answer: operator }
  const operatorEvents = events.map((e, i) => i === 10 ? user(formatQuizAnswer({ id: 'next', title: '本题', answers: [{ prompt: '推理', value: operator }], confidence: 'sure' }))
    : i === 11 ? call('g2', 'examiner', { prompt: operator }) : i === 13 ? call('r2', 'verification_record', modified) : e)
  const operatorCheckpoints = checkpoints.map((c, i) => i === 4 ? { ...c, state: { ...c.state, records: [assisted, modified] } } : c)
  assert.equal(scoreLearningLoop(operatorEvents, operatorCheckpoints).passed, true)
  for (const changedPrompt of [operator.replace('<', '>'), operator.replace('+', '-')]) {
    assert.equal(scoreLearningLoop(operatorEvents.map((e, i) => i === 11 ? call('g2', 'examiner', { prompt: changedPrompt }) : e), operatorCheckpoints).passed, false, 'comparison/arithmetic changes must not normalize away')
  }

})

test('help must not trigger grading, a new card or mastery writes; store evidence is mandatory', () => {
  for (const name of ['examiner', 'verification_record']) assert.equal(scoreLearningLoop([...events.slice(0, 3), call('early', name), ...events.slice(3)], checkpoints).passed, false)
  assert.equal(scoreLearningLoop([...events.slice(0, 3), call('replace', 'quiz_show'), result('replace', marker({ view: 'quiz', id: 'replacement' })), ...events.slice(3)], checkpoints).passed, false)
  for (const change of [{ records: [assisted] }, { mastery: 'proficient' }, { reviews: { cards: {} } }]) {
    assert.equal(scoreLearningLoop(events, checkpoints.map((c, i) => i === 2 ? { ...c, state: { ...c.state, ...change } } : c)).passed, false)
  }
  assert.equal(scoreLearningLoop(events, checkpoints.slice(0, -1)).passed, false)
  for (const change of [{ question: assisted.question }, { kpId: 'other-point' }, { answer: '旧辅助答案', hintsUsed: 0 }]) {
    const changed = { ...independent, ...change }
    const modifiedEvents = events.map((e) => e === events[13] ? call('r2', 'verification_record', changed) : e)
    const modifiedCheckpoints = checkpoints.map((c, i) => i === 4 ? { ...c, state: { ...c.state, records: [assisted, changed] } } : c)
    if (change.answer) {
      // A fresh grade of the old answer must not stand in for the independent answer.
      modifiedEvents[11] = call('g2', 'examiner', { prompt: change.answer })
    }
    assert.equal(scoreLearningLoop(modifiedEvents, modifiedCheckpoints).passed, false)
  }
})
