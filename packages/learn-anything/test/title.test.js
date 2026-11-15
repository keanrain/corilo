import { test } from 'node:test'
import assert from 'node:assert/strict'
import { titleAfterGoal } from '../src/host/title.js'

/** Stand-in for dsh-session-title: one session, latest title wins. */
function fakeTitles(source) {
  let current = source ? { title: 'old', source: { kind: source } } : undefined
  return {
    get: () => current,
    rename: (_session, title) => { current = { title, source: { kind: 'user' } }; return current },
    current: () => current,
  }
}

test('course goal replaces an automatic or missing title, once', () => {
  for (const source of [undefined, 'fallback', 'provider']) {
    const titles = fakeTitles(source)
    assert.equal(titleAfterGoal(titles, {}, '理解 JavaScript 闭包'), true)
    assert.equal(titles.current().title, '理解 JavaScript 闭包')
    assert.equal(titleAfterGoal(titles, {}, '另一个目标'), false, 'a later course_save keeps the title')
    assert.equal(titles.current().title, '理解 JavaScript 闭包')
  }
})

test('a title the learner set by hand is kept', () => {
  const titles = fakeTitles('user')
  assert.equal(titleAfterGoal(titles, {}, '理解 JavaScript 闭包'), false)
  assert.equal(titles.current().title, 'old')
  assert.equal(titleAfterGoal(fakeTitles(), {}, '  '), false)
})
