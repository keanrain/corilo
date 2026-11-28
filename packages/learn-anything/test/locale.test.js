import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { translateUi, t, installLocale, labels, provideEnglish, uiLanguage, ENGLISH_URL } from '../src/client/locale.js'

const table = JSON.parse(readFileSync(new URL('../src/client/ui-en.json', import.meta.url)))
import { formatFlashcardReview } from '../src/quiz/flashcard.js'

test('UI dictionaries preserve interpolation and do not translate learner content', () => {
  provideEnglish(table)
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

test('the English table loads from the Host on demand; Chinese shows until it arrives or if it fails', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  let reply = () => Promise.resolve(new Response('nope', { status: 503 }))
  globalThis.fetch = (url, init) => { requests.push([url, init]); return reply() }
  let active = 'en'
  const listeners = new Set()
  const locale = { getSnapshot: () => ({ active }), register: () => () => {}, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) } }
  provideEnglish({})
  const dispose = installLocale(locale)
  try {
    assert.equal(uiLanguage(), 'en')
    assert.equal(t('翻面核对'), '翻面核对', 'the Chinese source shows while the table loads')
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(requests.map(([url]) => url), [ENGLISH_URL])
    uiLanguage(); t('翻面核对')
    assert.equal(requests.length, 1, 'a failed load is not retried on every render')
    provideEnglish({})
    reply = () => Promise.resolve(Response.json({ 翻面核对: 'Reveal answer' }))
    uiLanguage()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(t('翻面核对'), 'Reveal answer')
    assert.equal(requests.length, 2)
    active = 'zh'
    assert.equal(t('翻面核对'), '翻面核对')
    uiLanguage()
    assert.equal(requests.length, 2, 'Chinese never fetches')
  } finally { dispose(); globalThis.fetch = originalFetch; provideEnglish(table) }
})

test('every learner-facing sentence the Host writes into feedback cards has an English entry', async () => {
  const { changeReason, calibration } = await import('../src/host/flow.js')
  const texts = new Set([changeReason(null)])
  for (const why of ['down', 'floor', 'up', 'ceiling', 'below', 'hold']) texts.add(changeReason({ why }))
  for (const confidence of ['sure', 'unsure', 'guess']) for (const verdict of ['correct', 'partial', 'wrong']) texts.add(calibration(confidence, verdict).text)
  for (const text of texts) assert.ok(Object.hasOwn(table, text), `missing English for Host text: ${text}`)
})
