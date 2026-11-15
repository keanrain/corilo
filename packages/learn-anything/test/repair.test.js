import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreRepair, REPAIR_CHALLENGE } from '../eval/repair.js'
import { failuresOf } from '../eval/metrics.js'
import { marker } from '../src/host/render.js'
import { formatQuizAnswer } from '../src/quiz/answer.js'

const call = (id, name, args = {}) => ({ type: 'tool/call', data: { callId: id, name, arguments: JSON.stringify(args) } })
const result = (id, text) => ({ type: 'tool/result', data: { message: { toolCallId: id, content: [{ type: 'text', text }] } } })
const user = (text) => ({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
const baseline = { records: [], mastery: { kp: 'none', models: [['route', 'none']] }, reviews: null }
const answer = formatQuizAnswer({ id: 'q-fixed', title: '修订题', answers: [{ prompt: '改法与理由', value: '备用机改为0台、上限3台，全忙且队满就拒绝。' }] })
const events = [
  call('first', 'quiz_show'), result('first', marker({ view: 'quiz', id: 'q-bad', ui: '原题' })),
  user(REPAIR_CHALLENGE), call('hold', 'examiner'), result('hold', '【暂缓判定】缺少备用机启用条件。'),
  call('fix', 'quiz_show'), result('fix', marker({ view: 'quiz', id: 'q-fixed', ui: '补齐启用条件的题卡' })),
  user(answer), call('grade', 'examiner', { prompt: `重新判题，回答原文：${answer}` }), result('grade', '【判定】correct'),
  call('save', 'verification_record', { answer, verdict: 'correct' }), result('save', '已记录'),
]
const checkpoints = [
  { eventSeq: 0, state: baseline }, { eventSeq: 2, state: baseline }, { eventSeq: 7, state: baseline },
  { eventSeq: events.length, state: { ...baseline, records: [{ answer, verdict: 'correct' }] } },
]

test('repair acceptance recognises host-owned grading linked to the fresh answer', () => {
  const record = { answer, verdict: 'correct', evidence: { version: 1, sessionId: 'host-session', questionSeq: 6, messageSeq: 7, examinerDigest: 'c'.repeat(64) } }
  const changed = events.map((e, seq) => [8, 9].includes(seq) ? { type: 'test/unused', seq } :
    seq === 10 ? { ...call('save', 'verification_record', {}), seq } : { ...e, seq })
  const saved = checkpoints.map((c, i) => i === checkpoints.length - 1 ? { ...c, state: { ...c.state, records: [record] } } : c)
  assert.equal(scoreRepair(changed, saved).passed, true)
  assert.equal(scoreRepair(changed, saved.map((c) => ({ ...c, state: { ...c.state,
    records: c.state.records.map((r) => ({ ...r, evidence: { ...r.evidence, messageSeq: 2 } })) } }))).passed, false)
})

test('repair acceptance requires deferral, a fresh card/answer/grade, and one real store record', () => {
  assert.equal(scoreRepair(events, checkpoints).passed, true)
  assert.equal(scoreRepair(events.map((e) => e === events[9] ? result('grade', '## 判定\n**correct**') : e), checkpoints).passed, true, 'Markdown grading headings are equivalent')
  assert.equal(scoreRepair(events.map((e) => e === events[4] ? result('hold', '旧题应暂缓判定，不能作为掌握度证据。') : e), checkpoints).passed, true, 'an explicit prose deferral has the same meaning')
  assert.equal(scoreRepair(events.map((e) => e === events[4] ? result('hold', '旧题不需暂缓判定。') : e), checkpoints).passed, false)
  for (const remove of ['hold', 'fix', 'grade']) {
    const changed = events.filter((e) => e.data?.callId !== remove && e.data?.message?.toolCallId !== remove)
    assert.equal(scoreRepair(changed, checkpoints).passed, false, `missing ${remove} must fail`)
  }
  assert.equal(scoreRepair(events.map((e) => e === events[7] ? user(answer.replace('q-fixed', 'q-bad')) : e), checkpoints).passed, false, 'old card answer is not a fresh answer')
  assert.equal(scoreRepair(events, checkpoints.map((c, i) => i === 3 ? { ...c, state: baseline } : c)).passed, false, 'tool prose is not a stored record')
  assert.equal(scoreRepair(events, checkpoints.map((c, i) => i === 3 ? { ...c, state: { ...c.state, records: [{ answer, verdict: 'wrong' }] } } : c)).passed, false, 'store must follow the actual examiner verdict')
})

test('repair acceptance rejects attempted early writes, duplicates and premature mastery/review changes', () => {
  for (const changed of [
    [...events.slice(0, 5), call('early', 'verification_record', { answer: REPAIR_CHALLENGE }), ...events.slice(5)],
    [...events, call('duplicate', 'verification_record', { answer })],
  ]) assert.equal(scoreRepair(changed, checkpoints).passed, false)
  for (const state of [
    { ...baseline, records: [{ answer: REPAIR_CHALLENGE }] },
    { ...baseline, mastery: { ...baseline.mastery, kp: 'familiar' } },
    { ...baseline, reviews: [{ due: 'tomorrow' }] },
  ]) assert.equal(scoreRepair(events, checkpoints.map((c, i) => i === 2 ? { ...c, state } : c)).passed, false)
  assert.equal(failuresOf([{ id: 'repair/deferred', repair: scoreRepair([], []) }]).length > 0, true)
})
