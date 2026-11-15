import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as store from '../src/host/store.js'
import { quizShowTool } from '../src/host/quiz.js'
import { parseView } from '../src/host/render.js'

const ui = 'root = Quiz("新情境", "predict", [Choice("任务去了哪里？", ["排队", "拒绝"]), Reason("为什么？")])'

async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'learn-quiz-retry-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const p = store.paths(cwd)
  await store.writeJson(p.course, { chapters: [{ kpIds: ['queue'] }] })
  await store.writeJson(p.kp('queue'), { id: 'queue', kind: 'knowledge', models: [{ id: 'order' }] })
  const original = { id: 'v-old', kpId: 'queue', modelId: 'order', question: '原题 有 空格', answer: '旧错误答案', verdict: 'wrong' }
  await store.appendJsonl(p.verifications, original)
  return { original, exec: { agent: { session: { header: { cwd } } } } }
}

test('quiz_show attaches a validated mistake without using its answer as a new answer', async (t) => {
  const { original, exec } = await fixture(t)
  const view = parseView(await quizShowTool.execute({ ui, question: '换一个任务场景', retryOf: original.id }, exec))
  assert.deepEqual(view.retry, { id: original.id, kpId: original.kpId, modelId: original.modelId, question: original.question, answer: original.answer })
  assert.equal(view.question, '换一个任务场景')
  assert.equal(view.answer, undefined)
  assert.doesNotMatch(view.ui, /旧错误答案/)
})

test('quiz_show rejects missing mistakes and whitespace-only changes to the original question before showing a card', async (t) => {
  const { original, exec } = await fixture(t)
  await assert.rejects(quizShowTool.execute({ ui, question: '新情境', retryOf: 'missing' }, exec), /active wrong or partial/)
  await assert.rejects(quizShowTool.execute({ ui, question: '  原题\n  有 \t 空格 ', retryOf: original.id }, exec), /new situation/)
})
