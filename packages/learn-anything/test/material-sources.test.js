import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as store from '../src/host/store.js'
import { ingestMaterial, validateSources } from '../src/host/ingest.js'
import { courseSave, kpDefineModels, kpGet, targetMapUpdate, verificationRecord } from '../src/host/tools.js'
import { quizShowTool } from '../src/host/quiz.js'
import { DELEGATES, delegateTool } from '../src/host/delegates.js'
import { parseView } from '../src/host/render.js'
import { assessVerification } from './helpers/assessment.js'

async function workspace(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'learn-sources-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const env = { cwd, assessVerification, now: () => new Date('2026-10-26T00:00:00Z') }
  await writeFile(join(cwd, 'notes.md'), '# 队列\n核心线程都忙时，队列未满就先排队。\n# 扩容\n队列已满且未达到线程数上限时才扩容。')
  const id = /id=(m-[a-z0-9]+)/.exec(await ingestMaterial.execute({ path: 'notes.md' }, env))[1]
  const sources = [`${id}#1`, `${id}#2`]
  const exec = { agent: { session: { header: { cwd } } }, signal: new AbortController().signal }
  return { env, exec, id, sources }
}

test('sources are checked against real blocks; URLs are preserved without fetching', async (t) => {
  const { env, sources, id } = await workspace(t)
  assert.deepEqual(await validateSources(env.cwd, [` ${sources[0]} `, sources[0], 'https://example.com/book#1']), [sources[0], 'https://example.com/book#1'])
  for (const source of [`${id}#99`, 'm-unknown#1', 'javascript:alert(1)', '../outside#1', '1', '']) {
    await assert.rejects(validateSources(env.cwd, [source]))
  }
  assert.deepEqual(await validateSources(env.cwd), [], 'courses without materials still work')
})

test('references survive examples, quizzes, grading records and both card views', async (t) => {
  const { env, exec, sources, id } = await workspace(t)
  const course = { goal: '理解线程池', status: 'active', chapters: [{ title: '并发', kps: [{ id: 'pool', title: '线程池', kind: 'knowledge', sources }] }] }
  await assert.rejects(courseSave.execute({ ...course, chapters: [{ title: '并发', kps: [{ ...course.chapters[0].kps[0], sources: [`${id}#99`] }] }] }, env), /no block/)
  assert.equal(await store.readJson(store.paths(env.cwd).kp('pool'), null), null)
  await courseSave.execute(course, env)
  await kpDefineModels.execute({ kpId: 'pool', models: [{ id: 'map', type: 'associative', input: '新任务', output: '任务去向', reference: '核心线程忙且队列未满时排队' }] }, env)
  const example = { tag: 'e', input: '核心线程忙，队列未满', output: '排队', origin: 'material', source: sources[0] }
  const target = parseView(await targetMapUpdate.execute({ kpId: 'pool', modelId: 'map', addExamples: [example], show: true }, env))
  assert.deepEqual(target.sources, sources)
  assert.deepEqual(target.models[0].examples[0].sources, [sources[0]])
  for (const source of [undefined, `${id}#99`]) {
    await assert.rejects(targetMapUpdate.execute({ kpId: 'pool', modelId: 'map', addExamples: [{ ...example, source }] }, env))
  }
  assert.equal(parseView(await kpGet.execute({ kpId: 'pool' }, env)).models[0].examples.length, 1)

  const quiz = { ui: 'root = Quiz("新任务", "predict", [Choice("放在哪里？", ["排队", "扩容"])])', question: '放在哪里？', sources }
  const shown = await quizShowTool.execute(quiz, exec)
  assert.deepEqual(parseView(shown).sources, sources)
  assert.doesNotMatch(shown, /队列已满且未达到/, 'no source text or answer is sent with the question')
  await assert.rejects(quizShowTool.execute({ ...quiz, sources: [`${id}#99`] }, exec), /no block/)

  const answer = { kpId: 'pool', modelId: 'map', question: quiz.question, questionType: 'predict', answer: '排队', verdict: 'correct', sources, expected: { output: '排队' } }
  await assert.rejects(verificationRecord.execute({ ...answer, sources: [`${id}#99`] }, env), /no block/)
  assert.deepEqual(await store.readJsonl(store.paths(env.cwd).verifications), [])
  const feedback = parseView(await verificationRecord.execute(answer, env))
  assert.deepEqual(feedback.sources, sources)
  const record = (await store.readJsonl(store.paths(env.cwd).verifications))[0]
  assert.deepEqual(record.sources, sources)
  const text = await kpGet.execute({ kpId: 'pool' }, env)
  const updated = parseView(text)
  assert.deepEqual(updated.models[0].examples.at(-1).sources, sources, 'answer turned into an example keeps its sources')
  assert.deepEqual(updated.models[0].verifications[0].sources, sources)
  assert.ok(text.slice(0, text.indexOf('<!--')).includes(sources[0]), 'sources are also visible to the tutor, not just the card')
})

test('checker and examiner receive citations; missing blocks fail before delegation', async (t) => {
  const { exec, sources, id } = await workspace(t)
  const calls = []
  const subagents = { startActivation: async (args) => {
    assert.equal(args.parent, exec.agent, 'the activation must receive the exact live parent')
    assert.equal(args.delivery, 'caller')
    assert.equal(args.signal, exec.signal)
    calls.push(args)
    return { result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: '已核对' }] }) }
  } }
  for (const definition of DELEGATES) {
    const tool = delegateTool(subagents, 'spawn', definition)
    const task = { description: '核对依据', prompt: '检查排队规则', sources }
    assert.equal(await tool.execute(task, exec), '已核对')
    assert.equal(calls.at(-1).agentPreset, definition.preset)
    if (definition.name === 'examiner') {
      assert.equal(calls.at(-1).agentOptions?.reasoningEffort, 'low', 'examiner retains reasoning with a bounded effort')
      assert.equal(calls.at(-1).agentOptions?.model, undefined, 'keep the selected model')
      await tool.execute({ ...task, reasoningEffort: 'high' }, exec)
      assert.equal(calls.at(-1).agentOptions.reasoningEffort, 'high', 'multi-step tasks retain a high-effort path')
    } else assert.equal(calls.at(-1).agentOptions, undefined, 'checker keeps its existing settings')
    for (const source of sources) assert.ok(calls.at(-1).prompt[0].text.includes(source))
    const count = calls.length
    await assert.rejects(tool.execute({ ...task, sources: [`${id}#99`] }, exec), /no block/)
    assert.equal(calls.length, count)
  }
})
