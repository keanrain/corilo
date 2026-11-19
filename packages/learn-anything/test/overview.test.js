import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as react from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Overview, gateText } from '../src/client/overview.js'
import { installLocale } from '../src/client/locale.js'

const h = react.createElement
const empty = h('div', { className: 'empty' }, '开始练习后，题目会留在这里。')
const base = { goal: '理解闭包', due: 2, total: 4, mastered: 1, percent: 25, streak: 3, today: true }
const html = (stats, extra = {}) => renderToStaticMarkup(h(Overview, { stats, empty, canStart: true, onStart() {}, ...extra }))

function inEnglish(fn) {
  const locale = { getSnapshot: () => ({ active: 'en' }), register: () => () => {}, subscribe: () => () => {} }
  const dispose = installLocale(locale)
  try { return fn() } finally { dispose() }
}

const current = {
  id: 'closure', title: '闭包', phase: 'verify', kind: 'knowledge',
  gate: { target: 'proficient', streak: { have: 1, need: 3 }, missing: ['discriminate-neg', 'rephrase'] },
}

test('overview shows goal, progress, current point, step, what is left and due reviews (zh)', () => {
  const out = html({ ...base, current })
  for (const text of ['理解闭包', '已掌握 1/4 个知识点 · 25%', '闭包', '新情境检验', '第 5/5 步', '离「熟练」还差：再连续答对 2 题（无提示、不是蒙的）、一道反例判别题、一道换说法题', '今日复习 2 项', '开始复习', '🔥 3 天']) {
    assert.ok(out.includes(text), text)
  }
  assert.ok(out.includes('width:25%'))
})

test('overview is localised (en) with the agreed step names', () => {
  const out = inEnglish(() => html({ ...base, current }))
  for (const text of ['理解闭包', '1 of 4 knowledge points mastered · 25%', 'Try new situations', 'Step 5 of 5', 'Still needed for Proficient: 2 more correct in a row (no hints, no guesses), a counterexample discrimination question, a rephrased question', '2 reviews due today', 'Start review', '🔥 3 days']) {
    assert.ok(out.includes(text), text)
  }
  const names = ['describe', 'assess', 'prescribe', 'build', 'verify', 'memorize', 'mastered']
  const labels = names.map((phase) => inEnglish(() => html({ ...base, current: { id: 'a', title: 'A', phase } })).match(/data-phase="[a-z]+">([^<]+)</)[1])
  assert.deepEqual(labels, ['Get the gist', 'Find the sticking point', 'Prepare materials', 'Sum it up in your words', 'Try new situations', 'Memorize', 'Mastered'])
})

test('overview step wording in zh and information points', () => {
  const zh = ['describe', 'assess', 'prescribe', 'build', 'verify', 'memorize', 'mastered']
    .map((phase) => html({ ...base, current: { id: 'a', title: 'A', phase } }).match(/data-phase="[a-z]+">([^<]+)</)[1])
  assert.deepEqual(zh, ['认识要点', '找出卡点', '准备材料', '用自己的话总结', '新情境检验', '记忆', '已掌握'])
  const info = html({ ...base, current: { id: 'f', title: '写法', phase: 'memorize', kind: 'information' } })
  assert.ok(info.includes('第 2/2 步'))
  assert.ok(!html({ ...base, current: { id: 'a', title: 'A', phase: 'mastered' } }).includes('第 '))
})

test('expert gate lists the learner\'s own examples; a met gate says nothing', () => {
  assert.equal(gateText({ target: 'expert', missing: ['transfer', 'own-pos', 'own-neg'] }), '离「精通」还差：一道迁移题、自己举一个正例、自己举一个反例')
  assert.equal(gateText({ target: 'proficient', streak: { have: 3, need: 3 }, missing: [] }), '')
  assert.equal(gateText(undefined), '')
  assert.equal(gateText({ target: 'proficient', missing: ['future-type'] }), '离「熟练」还差：future-type')
})

test('due reviews start through the composer prompt; no reviews, no button', () => {
  assert.ok(html({ ...base, current }, { canStart: false }).includes('disabled'))
  assert.ok(!html({ ...base, current }).includes('disabled'))
  const none = html({ ...base, due: 0, current })
  assert.ok(none.includes('今天没有到期的复习') && !none.includes('<button'))
})

test('no course keeps the empty state; old-shape stats and finished or empty routes still render', () => {
  assert.equal(renderToStaticMarkup(h(Overview, { stats: null, empty })), renderToStaticMarkup(empty))
  assert.equal(renderToStaticMarkup(h(Overview, { stats: undefined, empty })), renderToStaticMarkup(empty))
  const old = html({ goal: '理解闭包', due: 0, total: 4, mastered: 1, percent: 25 })
  assert.ok(old.includes('理解闭包') && old.includes('已掌握 1/4 个知识点 · 25%'))
  assert.ok(!old.includes('当前知识点') && !old.includes('🔥'))
  assert.ok(html({ ...base, current: null, mastered: 4, percent: 100 }).includes('路线里的知识点都已达标或跳过'))
  const noPoints = html({ goal: '空路线', due: 0, total: 0, mastered: 0, percent: 0, current: null })
  assert.ok(noPoints.includes('路线里还没有知识点') && !noPoints.includes('都已达标'))
})
