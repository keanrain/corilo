import { test } from 'node:test'
import assert from 'node:assert/strict'
import { failuresOf, practiceTiming, materialStats, quizStats } from '../eval/metrics.js'
import { marker } from '../src/host/render.js'
import { formatQuizAnswer } from '../src/quiz/answer.js'

const call = (callId, name, args = {}, time = 0) => ({ type: 'tool/call', time, data: { callId, name, arguments: JSON.stringify(args) } })
const result = (callId, view, time = 0, isError = false) => ({ type: 'tool/result', time, data: { message: { toolCallId: callId, content: [{ type: 'text', text: typeof view === 'string' ? view : marker(view) }], isError } } })
const user = (text, time) => ({ type: 'user/message', time, data: { content: [{ type: 'text', text }], source: { kind: 'user' } } })
const step = (time) => ({ type: 'step/start', time, data: {} })

test('quiz leak check stops private answers at Markdown headings and still catches actual leaks', () => {
  const events = [call('show', 'quiz_show'), result('show', { view: 'quiz', id: 'q-1', ui: 'Scene("背景。请只改一条条件，其他保持不变。")' })]
  const examiner = [{ type: 'assistant/message', data: { content: '## 【标准答案】\n备用机改为零台\n\n## 【判分要点】\n解释上限变化\n\n## 【互动】\nScene("背景。请只改一条条件，其他保持不变。")' } }]
  assert.deepEqual(quizStats(events, examiner).leaks, [], 'the card itself must not be parsed as part of the private answer')
  for (const wrap of ['**', '__']) {
    const formatted = examiner.map((event) => ({ ...event, data: { content: event.data.content.replace(/## (【[^】]+】)/g, `${wrap}$1${wrap}`) } }))
    assert.deepEqual(quizStats(events, formatted).leaks, [], 'formatted headings must not swallow the interaction block')
    const realLeak = [{ type: 'assistant/message', data: { content: `${wrap}【标准答案】${wrap}请只改一条条件，其他保持不变\n${wrap}【判分要点】${wrap}解释` } }]
    assert.deepEqual(quizStats(events, realLeak).leaks, ['q-1'], 'formatting must not hide an actual answer leak')
  }
  const leaked = [{ type: 'assistant/message', data: { content: '【标准答案】请只改一条条件，其他保持不变\n【判分要点】解释' } }]
  assert.deepEqual(quizStats(events, leaked).leaks, ['q-1'])
  assert.deepEqual(quizStats(events, [{ type: 'assistant/message', data: { content: leaked[0].data.content + '\n【标准答案】另一个私有答案' } }]).leaks, ['q-1'], 'repeated answer sections must all be checked')
})

test('eval fails safety regressions and scenario errors, while diagnosis rates stay descriptive', () => {
  assert.deepEqual(failuresOf([{ id: 'missed-diagnosis', hit: false, diagnosed: false, ghostwritten: [], quiz: { leaks: [] } }]), [])
  const failures = failuresOf([
    { id: 'error', error: 'connection failed' },
    { id: 'ghost', ghostwritten: ['a statement'] },
    { id: 'leak', quiz: { leaks: ['q-1'] } },
    { id: 'bad-ref', material: { invalidStored: true } },
    { id: 'lost-ref', material: { sourceChainIntact: false } },
    { id: 'assisted', learningLoop: { failures: ['assisted answer counted as clean'] } },
    { id: 'recovery', recovery: { failures: ['没有把基础排到原任务之前'] } },
  ])
  assert.equal(failures.length, 7)
  for (const id of ['error', 'ghost', 'leak', 'bad-ref', 'lost-ref', 'assisted', 'recovery']) assert.ok(failures.some((failure) => failure.startsWith(`${id}:`)))
})

test('an unmarked answer option is not a leak, while the same answer in a prompt or scene is', () => {
  const answer = '不会剩下，正好全部分完'
  const examiner = [{ type: 'assistant/message', data: { content: `【标准答案】${answer}\n【判分要点】说明理由` } }]
  const ui = `root = Quiz("合并", "predict", [Choice("是否会剩下？", ["${answer}", "会剩下一个"]), Reason("为什么？")])`
  const leaks = (ui) => quizStats([call('show', 'quiz_show'), result('show', { view: 'quiz', id: 'q-options', ui })], examiner).leaks
  assert.deepEqual(leaks(ui), [])
  assert.deepEqual(leaks(ui.replace('Reason("为什么？")', `Reason("为什么？", "${answer}")`)), ['q-options'])
  assert.deepEqual(leaks(ui.replace('Reason("为什么？")', `Scene("${answer}"), Reason("为什么？")`)), ['q-options'])
  assert.deepEqual(leaks(ui.replace(answer, `${answer}（正确答案）`)), ['q-options'])
})

test('practice timing excludes learner thinking from grading and counts generation/grading steps separately', () => {
  const answer = formatQuizAnswer({ id: 'q-1', title: '问题', answers: [{ prompt: '选择', value: '排队' }], confidence: 'sure' })
  const events = [
    user('开始学习', 1000), step(1100), call('read', 'material_read'), result('read', '原文', 1200),
    step(1300), call('quiz', 'quiz_show'), result('quiz', { view: 'quiz', id: 'q-1' }, 2000),
    user(answer, 62000), step(62100), call('grade', 'verification_record'), result('grade', { view: 'feedback', id: 'v-1' }, 63000),
    step(64000), call('quiz-2', 'quiz_show'), result('quiz-2', { view: 'quiz', id: 'q-2' }, 65000),
  ]
  assert.deepEqual(practiceTiming(events), { firstQuizMs: 1000, questions: [
    { id: 'q-1', questionLlmSteps: 2, feedbackMs: 1000, gradingLlmSteps: 1, nextQuizMs: 2000 },
    { id: 'q-2', questionLlmSteps: 1, feedbackMs: null, gradingLlmSteps: null, nextQuizMs: null },
  ] })
  assert.deepEqual(practiceTiming([user('开始', 0), step(1), call('broken', 'quiz_show'), result('broken', '无法显示', 2, true)]), { firstQuizMs: null, questions: [] })
  const actualOrder = [...events.slice(0, 7), { type: 'turn/start', time: 61900, data: { turn: 2 } }, step(62000), user(answer, 62001), call('grade', 'verification_record'), result('grade', { view: 'feedback', id: 'v-1' }, 63000)]
  assert.equal(practiceTiming(actualOrder).questions[0].gradingLlmSteps, 1, 'step/start before user/message counts as a grading call')
})

test('next quiz timing measures only automatic continuation, excluding later user turns', () => {
  const answer = formatQuizAnswer({ id: 'q-1', title: '问题', answers: [{ prompt: '选择', value: '排队' }] })
  const graded = [user('开始', 0), call('q', 'quiz_show'), result('q', { view: 'quiz', id: 'q-1' }, 1000),
    user(answer, 60000), call('v', 'verification_record'), result('v', { view: 'feedback', id: 'v-1' }, 61000)]
  const next = [call('q2', 'quiz_show'), result('q2', { view: 'quiz', id: 'q-2' }, 181000)]
  assert.equal(practiceTiming(graded).questions[0].nextQuizMs, null, 'no following question leaves timing unknown')
  assert.equal(practiceTiming([...graded, ...next]).questions[0].nextQuizMs, 120000, 'a slow automatic generation still counts')
  assert.equal(practiceTiming([...graded, user('再来一题', 180000), ...next]).questions[0].nextQuizMs, null, 'learner thinking is excluded')
  assert.equal(practiceTiming([...graded, { type: 'turn/end', time: 62000 }, { type: 'turn/start', time: 180000 }, ...next]).questions[0].nextQuizMs, null, 'a later turn is not automatic continuation')
})

test('material eval follows citations through actual answer formatting and detects bad or lost references', () => {
  const material = { case: 'missing-block', sources: ['m-book#1', 'm-book#2'], invalidSource: 'm-book#99' }
  const quiz = { view: 'quiz', id: 'q-1', question: '新任务去哪里？', sources: material.sources }
  const events = [
    call('read', 'material_read', { blocks: material.sources }), result('read', '原文'),
    call('bad', 'examiner', { sources: [material.invalidSource] }), result('bad', 'no block 99', 0, true),
    call('show', 'quiz_show', quiz), result('show', quiz),
    call('open', 'quiz_show'), result('open', { ...quiz, id: 'q-2' }),
  ]
  const history = [{ who: 'learner', text: formatQuizAnswer({ id: 'q-1', title: '任务', answers: [{ prompt: '选择', value: '排队' }], sources: material.sources }) }]
  const verified = [{ question: quiz.question, sources: material.sources }]
  const sub = [{ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'rule：不通过 —— 原文不支持这个说法。' }] } } }]
  assert.deepEqual(materialStats(events, sub, verified, history, material), {
    case: 'missing-block', readBlocks: material.sources, quizShown: 2, submitted: 1, sourceChainIntact: true,
    invalidRejected: true, invalidStored: false, unsupportedDetected: true,
  })
  assert.equal(materialStats(events, [], [{ question: quiz.question, sources: [] }], history, material).sourceChainIntact, false)
  assert.equal(materialStats(events, [], verified, [{ who: 'learner', text: formatQuizAnswer({ id: 'q-1', title: '任务', answers: [] }) }], material).sourceChainIntact, false)
  assert.equal(materialStats(events, [], [{ sources: [material.invalidSource] }], history, material).invalidStored, true)
})
