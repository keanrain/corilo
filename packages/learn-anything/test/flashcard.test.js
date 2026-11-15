import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { buildSync } from 'esbuild'
import * as react from 'react'
import { flashcardShowTool } from '../src/host/flashcard.js'
import { verificationRecord } from '../src/host/tools.js'
import { paths, writeJson } from '../src/host/store.js'
import { parseView } from '../src/host/render.js'
import { flashcardHistory, formatFlashcardReview } from '../src/quiz/flashcard.js'

async function snapshot(dir) {
  const files = await readdir(dir, { recursive: true, withFileTypes: true })
  return Promise.all(files.filter((f) => f.isFile()).map(async (f) => [join(f.parentPath, f.name), await readFile(join(f.parentPath, f.name), 'utf8')]))
}
async function workspace(fn) {
  const cwd = await mkdtemp(join(tmpdir(), 'la-flashcard-'))
  const p = paths(cwd)
  await writeJson(p.course, { chapters: [{ kpIds: ['info', 'knowledge'] }] })
  await writeJson(p.kp('info'), { id: 'info', title: '端口', kind: 'information', facts: [{ prompt: 'HTTP 默认端口？', answer: '80' }] })
  await writeJson(p.kp('knowledge'), { id: 'knowledge', kind: 'knowledge' })
  try { await fn(cwd, p, { agent: { session: { header: { cwd } } } }) }
  finally { await rm(cwd, { recursive: true, force: true }) }
}

test('flashcard uses a saved fact, legacy stable id, validated sources and never writes learner data', async () => workspace(async (cwd, p, exec) => {
  const before = await snapshot(cwd)
  const result = await flashcardShowTool.execute({ kpId: 'info' }, exec)
  const view = parseView(result)
  assert.equal(view.view, 'flashcard')
  assert.equal(view.fact.id, 'fact-1')
  assert.equal(view.fact.answer, '80')
  assert.deepEqual(view.sources, [])
  assert.match(result, /不写入 verification_record/)
  assert.deepEqual(await snapshot(cwd), before)
}))

test('flashcard rejects unavailable facts, inactive points and invalid material refs', async () => workspace(async (cwd, p, exec) => {
  await assert.rejects(flashcardShowTool.execute({ kpId: 'gone' }, exec), /不在当前课程/)
  await assert.rejects(flashcardShowTool.execute({ kpId: 'knowledge' }, exec), /information/)
  await assert.rejects(flashcardShowTool.execute({ kpId: 'info', factId: 'nope' }, exec), /factId 不存在/)
  const kp = JSON.parse(await readFile(p.kp('info'), 'utf8'))
  kp.facts.push({ id: 'second', prompt: 'HTTPS?', answer: '443' })
  await writeJson(p.kp('info'), kp)
  await assert.rejects(flashcardShowTool.execute({ kpId: 'info' }, exec), /指定 factId/)
  assert.equal(parseView(await flashcardShowTool.execute({ kpId: 'info', factId: 'second' }, exec)).fact.answer, '443')
  kp.sources = ['m-missing#1']
  await writeJson(p.kp('info'), kp)
  const before = await snapshot(cwd)
  await assert.rejects(flashcardShowTool.execute({ kpId: 'info', factId: 'second' }, exec))
  assert.deepEqual(await snapshot(cwd), before)
  kp.sources = []
  kp.facts = []
  await writeJson(p.kp('info'), kp)
  await assert.rejects(flashcardShowTool.execute({ kpId: 'info' }, exec), /保存记忆卡/)
  kp.facts = [{ prompt: 'empty?', answer: '  ' }]
  await writeJson(p.kp('info'), kp)
  await assert.rejects(flashcardShowTool.execute({ kpId: 'info' }, exec), /不能为空/)
}))

const view = { view: 'flashcard', id: 'f-test', kp: { id: 'info', title: '端口' }, fact: { id: 'fact-1', prompt: 'HTTP 默认端口？', answer: 'SECRET_ANSWER' }, sources: ['m-test#1'] }
test('flashcard self-ratings cannot be recorded as recall evidence or alter mastery and reviews', async () => workspace(async (cwd) => {
  const before = await snapshot(cwd)
  for (const result of ['remembered', 'again']) {
    const answer = `  \n${formatFlashcardReview(view, 'sure', result)}`
    await assert.rejects(verificationRecord.execute({ kpId: 'info', factId: 'fact-1', question: view.fact.prompt, questionType: 'recall', answer, verdict: 'correct' }, { cwd, now: () => new Date() }), /不是独立回忆的验证证据/)
    assert.deepEqual(await snapshot(cwd), before, 'rejected self-rating must leave all learning records unchanged')
  }
}))

function history(entries = [{ seq: 1, view }], nodes = []) {
  return { timeline: { turns: new Map([[1, { data: new Map([['learn-anything', { views: entries }]]) }]]) }, legacy: { nodes } }
}
const node = (text, seq = 3) => ({ kind: 'user', seq, content: [{ type: 'text', text }] })

test('flashcard lifecycle comes from real messages and newer exercises, never the generated question text', () => {
  const text = formatFlashcardReview(view, 'unsure', 'again')
  assert.ok(!text.includes(view.fact.answer))
  assert.equal(flashcardHistory(history([], [node(text)]), view.id).result, '再练一次')
  assert.equal(flashcardHistory(history([], [node(`unrelated ${text}`)]), view.id).closed, null)
  assert.equal(flashcardHistory(history([{ seq: 1, view }, { seq: 4, view: { ...view, id: 'f-next' } }]), view.id).closed, 'superseded')
  assert.equal(flashcardHistory(history([{ seq: 1, view }, { seq: 4, view: { view: 'quiz', id: 'q-next' } }]), view.id).closed, 'superseded')
  assert.equal(flashcardHistory(undefined, view.id).closed, null)
})

const require = createRequire(import.meta.url)
const source = buildSync({ entryPoints: ['src/client/flashcard.js'], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'] }).outputFiles[0].text
function card() {
  let cursor = 0, states = [], chat = history(), input = { phase: 'plain', draft: '', attachmentIds: [] }, sent = null, fail = false
  const storage = new Map()
  const runtime = { ...react, useSyncExternalStore: (_subscribe, snapshot) => snapshot(), useState(initial) {
    const index = cursor++
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
    return [states[index], (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next }]
  } }
  const module = { exports: {} }
  runInNewContext(source, { module, exports: module.exports, require: (name) => name === 'react' ? runtime : require(name), localStorage: {
    getItem: (key) => storage.get(key) ?? null, setItem: (key, val) => storage.set(key, val),
  } })
  const actions = { setDraft(text) { input.draft = text }, submit() { if (fail) throw new Error('offline'); sent = input.draft } }
  const render = () => { cursor = 0; return module.exports.FlashcardCard({ view, useInput: (f) => f(input), useConversation: (f) => f({ views: new Map([['chat', chat]]) }), inputActions: actions }) }
  return { render, input, storage, actions, remount() { states = [] }, set fail(value) { fail = value }, get sent() { return sent }, set chat(value) { chat = value } }
}
function elements(tree) {
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(elements)]
}
function text(tree) { return JSON.stringify(tree) }
function button(tree, label) { return elements(tree).find((e) => e.type === 'button' && [e.props.children].flat(Infinity).includes(label)) }

test('flashcard conceals answer and sources until recall confidence and reveal; failures preserve retry until history confirms', async () => {
  const app = card()
  let tree = app.render()
  assert.ok(!text(tree).includes('SECRET_ANSWER'))
  assert.ok(!text(tree).includes('m-test#1'))
  assert.equal(button(tree, '翻面核对').props.disabled, true)
  button(tree, '只记得一部分').props.onClick()
  tree = app.render()
  button(tree, '翻面核对').props.onClick({ detail: 0 })
  tree = app.render()
  assert.ok(text(tree).includes('SECRET_ANSWER'))
  assert.ok(text(tree).includes('m-test#1'))
  app.input.draft = '用户正在写的内容'
  assert.equal(button(app.render(), '记住了').props.disabled, true)
  await button(app.render(), '记住了').props.onClick()
  assert.equal(app.input.draft, '用户正在写的内容')
  app.input.draft = ''
  app.fail = true
  await button(app.render(), '再练一次').props.onClick()
  assert.ok(text(app.render()).includes('发送失败'))
  assert.equal(button(app.render(), '重试：再练一次').props.disabled, false)
  app.fail = false
  await button(app.render(), '重试：再练一次').props.onClick()
  assert.ok(text(app.render()).includes('尚未确认发送'))
  app.chat = history(undefined, [node(app.sent)])
  app.storage.clear()
  app.remount()
  tree = app.render()
  assert.ok(text(tree).includes('已告诉导师：再练一次'))
  assert.ok(!button(tree, '再练一次'))
  assert.ok(text(tree).includes('SECRET_ANSWER'))
})

test('new exercises close an unanswered flashcard without revealing its answer', () => {
  const app = card()
  app.chat = history([{ seq: 1, view }, { seq: 2, view: { view: 'quiz', id: 'q-later' } }])
  const tree = app.render()
  assert.ok(text(tree).includes('本卡已结束'))
  assert.ok(!text(tree).includes('SECRET_ANSWER'))
  assert.ok(!button(tree, '翻面核对'))
})

test('asynchronous submit errors are retryable and cached self-rating is not delivery proof', async () => {
  const app = card()
  button(app.render(), '能独立回忆').props.onClick()
  button(app.render(), '翻面核对').props.onClick({ detail: 1 })
  app.actions.submit = async () => { throw new Error('async offline') }
  await button(app.render(), '记住了').props.onClick()
  app.remount()
  const tree = app.render()
  assert.equal(button(tree, '重试：记住了').props.disabled, false)
  assert.ok(!text(tree).includes('已告诉导师'))
})
