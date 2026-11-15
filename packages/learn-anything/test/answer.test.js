import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatQuizAnswer, parseQuizAction, quizAnswerDisplay, quizHistory, HELP_PREFIX } from '../src/quiz/answer.js'

test('learning help remains an open exercise and counts assistance separately from hint levels', () => {
  const help = `${HELP_PREFIX}这个词不懂：原题（互动题 q-help）`
  assert.deepEqual(parseQuizAction(help), { id: 'q-help', action: 'help' })
  const node = (text, seq) => ({ kind: 'user', seq, content: [{ type: 'text', text }] })
  const state = quizHistory({ legacy: { nodes: [
    node(help, 2), node('【求提示】原题（互动题 q-help，第 1 次提示）', 3),
    node(`${HELP_PREFIX}不知道从哪开始（互动题 q-help）`, 4),
    node(`${HELP_PREFIX}另一题（互动题 q-other）`, 5), node(`引用：${help}`, 6),
  ] } }, 'q-help')
  assert.deepEqual(state, { closed: null, answerText: null, hints: 1, helpRequests: 2, lastSeq: 4 })
})

test('retry identity reaches grading without cluttering the displayed answer', () => {
  const text = formatQuizAnswer({ id: 'q-retry', title: '换个场景再试', retryOf: 'v-original',
    answers: [{ prompt: '你的判断', value: '先判断核心线程数量\n再看队列容量' }], sources: ['m-book#1'], confidence: 'sure' })
  assert.ok(text.includes('重赛记录：v-original'))
  assert.equal(parseQuizAction(text).id, 'q-retry')
  const display = quizAnswerDisplay(text)
  assert.ok(display.includes('先判断核心线程数量\n再看队列容量'))
  assert.ok(display.includes('把握：稳'))
  assert.ok(!display.includes('v-original'))
  assert.ok(!display.includes('m-book#1'))
})

test('practice answers retain coaching intent through submission and history display', () => {
  const text = formatQuizAnswer({ id: 'q-practice', title: '对照观察', purpose: 'practice',
    answers: [{ prompt: '判断依据', value: '先看每路原片是否清晰' }] })
  assert.match(text, /^【作答】对照观察\n用途：理解练习（不计掌握度）\n/)
  assert.equal(parseQuizAction(text).id, 'q-practice')
  assert.equal(parseQuizAction(text).action, 'answered')
  assert.equal(quizAnswerDisplay(text), '· 判断依据 → 先看每路原片是否清晰\n提示：0 次')
})

test('a new flashcard closes the previous unanswered quiz', () => {
  const chat = { timeline: { turns: new Map([[1, { data: new Map([['learn-anything', { views: [
    { seq: 2, view: { view: 'quiz', id: 'q-old' } }, { seq: 5, view: { view: 'flashcard', id: 'f-new' } },
  ] }]]) }]]) } }
  assert.equal(quizHistory(chat, 'q-old').closed, 'superseded')
})
