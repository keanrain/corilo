import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { translateUi, t, installLocale, labels } from '../src/client/locale.js'
import { formatFlashcardReview } from '../src/quiz/flashcard.js'

test('UI dictionaries preserve interpolation and do not translate learner content', () => {
  assert.equal(translateUi('提交作答', 'en'), 'Submit answer')
  assert.equal(translateUi('提交作答', 'zh'), '提交作答')
  for (const key of ['toString', '__proto__', 'constructor']) {
    assert.equal(translateUi(key, 'en'), key)
    assert.equal(labels({ ready: '已完成' })[key], undefined)
  }
  assert.equal(translateUi('进阶挑战 · {title}', 'en', { title: '提交作答' }), 'Advanced challenge · 提交作答')
  const en = JSON.parse(readFileSync(new URL('../src/client/ui-en.json', import.meta.url)))
  for (const [key, value] of Object.entries(en)) {
    const placeholders = (text) => [...text.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort()
    assert.deepEqual(placeholders(key), placeholders(value), key)
  }
})

test('host locale changes UI labels without changing flashcard protocol', () => {
  let active = 'zh'
  const listeners = new Set()
  const locale = { getSnapshot: () => ({ active }), register: () => () => {}, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) } }
  const dispose = installLocale(locale)
  try {
    const view = { id: 'f1', kp: { id: 'kp1', title: '用户课程' }, fact: { id: 'fact1' } }
    const before = formatFlashcardReview(view, 'sure', 'remembered')
    assert.equal(t('翻面核对'), '翻面核对')
    active = 'en'; listeners.forEach((fn) => fn())
    assert.equal(t('翻面核对'), 'Reveal answer')
    assert.equal(formatFlashcardReview(view, 'sure', 'remembered'), before)
    assert.match(before, /【闪卡自评】/)
  } finally { dispose() }
})
