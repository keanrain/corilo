import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/host/index.js'
import { DEFAULT_GATE } from '../src/host/mastery.js'
import { readJson, readJsonl, paths, requireKp } from '../src/host/store.js'
import { quizShowTool } from '../src/host/quiz.js'
import { parseView } from '../src/host/render.js'
import { formatQuizAnswer } from '../src/quiz/answer.js'

async function host() {
  const tools = new Map(), projections = new Map()
  const fixture = { grade: null }
  await apply({
    tools: { register: (tool) => tools.set(tool.name, tool), guard() {} },
    sessionProjections: {
      async register(projection) {
        projections.set(projection.key, projection)
        return { stateOf: (session) => session.userTexts }
      },
      stateOf() { throw new Error('deprecated projection read') },
    },
    inject(deps, setup) {
      if (!deps.includes('subagents')) return
      setup({ tools: { register: (tool) => tools.set(tool.name, tool) }, subagents: {
        async startActivation() { return { result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: JSON.stringify(fixture.grade) }] }), async dispose() {} } },
      } })
    },
    logger: { warn: (message) => { throw new Error(message) } },
  }, { ...DEFAULT_GATE, methodology: false, quizLang: false, interactiveQuiz: false })
  return { tools, projections, fixture }
}

async function workspace(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'learn-host-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const app = await host()
  const events = []
  const call = (name, args, userTexts = []) => {
    if (name === 'verification_record') {
      events.push({ type: 'assistant/message', data: { content: [{ type: 'text', text: args.question }] } },
        { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: args.answer }] } })
      app.fixture.grade = { verdict: args.verdict, questionType: args.questionType, difficulty: 2, novel: true, explainedRule: true, feedback: '测试考官反馈', output: '测试参考答案' }
    }
    return app.tools.get(name).execute(args, {
      agent: { session: { id: 'session', header: { cwd }, userTexts, seq: events.length, eventAt: (seq) => events[seq] } }, signal: new AbortController().signal,
    })
  }
  await call('course_save', { goal: '闭包', status: 'active', chapters: [{ title: '函数', kps: [{ id: 'closure', title: '闭包', kind: 'knowledge' }] }] })
  await call('kp_define_models', { kpId: 'closure', models: [{ id: 'm', type: 'discriminative', concept: '闭包', reference: '函数与词法环境的组合' }] })
  return { ...app, cwd, call }
}

test('card-generated text is excluded from new and previously cached learner-word evidence', async (t) => {
  const app = await workspace(t)
  const projection = app.projections.get('learn-anything/user-texts')
  const message = (text, kind = 'user') => ({ type: 'user/message', data: { source: { kind }, content: [{ type: 'text', text }] } })
  const rule = '闭包是函数与其词法环境的组合'
  const card = `【作答】${rule}\n· 选一个 → A. 是\n提示：0 次\n（互动题 q-test）`
  let state = projection.init()
  const help = `【学习补给】这个词不懂：${rule}（互动题 q-test）`
  for (const text of [card, ` 【求提示】${rule}`, `【换题】${rule}`, `【歇一会儿】${rule}`, `【闪卡自评】${rule}`, help]) state = projection.apply(state, message(text))
  assert.deepEqual(state, [])
  state = projection.apply(state, message(rule, 'tool'))
  assert.deepEqual(state, [])
  await assert.rejects(app.call('target_map_update', { kpId: 'closure', modelId: 'm', statement: rule }, [card]), /statement rejected/)
  await assert.rejects(app.call('target_map_update', { kpId: 'closure', modelId: 'm', statement: rule }, [help]), /statement rejected/)
  state = projection.apply(state, message(rule))
  await app.call('target_map_update', { kpId: 'closure', modelId: 'm', statement: rule }, state)
  assert.equal((await requireKp(app.cwd, 'closure')).models[0].targetMap.statement.verified, true)
})

test('learning help requests cannot create verification records or change mastery', async (t) => {
  const app = await workspace(t)
  const before = await requireKp(app.cwd, 'closure')
  for (const verdict of ['correct', 'wrong']) {
    await assert.rejects(app.call('verification_record', { kpId: 'closure', modelId: 'm', question: '原题', questionType: 'scenario',
      answer: '【学习补给】不知道从哪开始：原题（互动题 q-test）', verdict }), /求助，不是作答/)
  }
  assert.deepEqual(await requireKp(app.cwd, 'closure'), before)
  assert.deepEqual(await readJsonl(paths(app.cwd).verifications), [])
})

test('moving a prerequisite before an unfinished point preserves evidence and returns after learning it', async (t) => {
  const app = await workspace(t)
  await app.call('verification_record', { kpId: 'closure', modelId: 'm', question: '换个函数还能保留环境吗？',
    questionType: 'scenario', answer: '我认为环境指调用处的变量', verdict: 'partial' })
  const before = await requireKp(app.cwd, 'closure')
  const records = await readJsonl(paths(app.cwd).verifications)
  await app.call('course_save', { goal: '闭包', status: 'active', chapters: [{ title: '先补基础', kps: [
    { id: 'scope', title: '作用域', kind: 'information' },
    { id: 'closure', title: '闭包', kind: 'knowledge', prerequisites: ['scope'] },
  ] }] })
  assert.match((await app.call('learn_status', {})).text, /当前知识点：作用域/)
  assert.deepEqual((await requireKp(app.cwd, 'closure')).models, before.models)
  await app.call('kp_define_models', { kpId: 'scope', facts: [{ prompt: '作用域是什么？', answer: '名字可见的范围' }] })
  await app.call('kp_set_phase', { kpId: 'scope', phase: 'memorize', reason: '先熟悉事实，再独立回忆' })
  const factId = (await requireKp(app.cwd, 'scope')).facts[0].id
  for (let i = 0; i < 3; i++) await app.call('verification_record', { kpId: 'scope', factId,
    question: '作用域是什么？', questionType: 'recall', answer: '名字可见的范围', verdict: 'correct' })
  assert.match((await app.call('learn_status', {})).text, /当前知识点：闭包/)
  assert.deepEqual((await requireKp(app.cwd, 'closure')).models, before.models)
  assert.deepEqual((await readJsonl(paths(app.cwd).verifications)).slice(0, records.length), records)
})

test('showing and submitting an understanding practice cannot create mastery evidence', async (t) => {
  const app = await workspace(t)
  const before = await requireKp(app.cwd, 'closure')
  const text = await quizShowTool.execute({ purpose: 'practice', question: '两个例子的区别在哪里？',
    ui: 'root = Quiz("对照观察", "contrast", [Reason("你的观察依据？")])',
  }, { agent: { session: { header: { cwd: app.cwd } } } })
  const view = parseView(text)
  const answer = formatQuizAnswer({ id: view.id, purpose: view.purpose, title: '对照观察', answers: [{ prompt: '你的观察依据？', value: '看定义环境是否被保留' }] })
  for (const verdict of ['correct', 'partial', 'wrong']) await assert.rejects(app.call('verification_record', {
    kpId: 'closure', modelId: 'm', question: view.question, questionType: 'contrast', answer, verdict,
  }), /理解练习不记验证结果/)
  assert.deepEqual(await requireKp(app.cwd, 'closure'), before)
  assert.deepEqual(await readJsonl(paths(app.cwd).verifications), [])
  assert.equal(await readJson(paths(app.cwd).reviews, null), null)
})

test('registered write tools serialize updates from separate sessions sharing a workspace', async (t) => {
  const { tools, cwd } = await workspace(t)
  await Promise.all(Array.from({ length: 5 }, (_, i) => tools.get('target_map_update').execute({
    kpId: 'closure', modelId: 'm', addExamples: [{ tag: 'e', input: `情境 ${i}`, output: '闭包', origin: 'ai' }],
  }, { agent: { session: { id: `session-${i}`, header: { cwd }, userTexts: [] } }, signal: new AbortController().signal })))
  const examples = (await requireKp(cwd, 'closure')).models[0].targetMap.examples
  assert.equal(examples.length, 5)
  assert.equal(new Set(examples.map((example) => example.id)).size, 5)
})

test('the stats projection carries the current knowledge point and still accepts the old shape', async (t) => {
  const { call, projections } = await workspace(t)
  const result = await call('course_get', {})
  const projection = projections.get('learn-anything/stats')
  const meta = { learnStats: result.stats }
  const state = projection.apply(null, { type: 'tool/result', data: { meta } })
  const parsed = projection.stateSchema.parse(state)
  assert.deepEqual(parsed.current, { id: 'closure', title: '闭包', phase: 'assess', kind: 'knowledge', gate: { target: 'proficient', streak: { have: 0, need: 3 }, missing: ['discriminate-neg', 'rephrase'] } })
  assert.deepEqual(projection.wire.viewSchema.parse(projection.wire.view(state)).current, parsed.current)
  // Sessions recorded before `current` existed, and a finished route, must still validate.
  const old = { goal: '闭包', due: 0, total: 1, mastered: 0, percent: 0, streak: 2, today: true }
  assert.deepEqual(projection.stateSchema.parse(old), old)
  assert.equal(projection.stateSchema.parse({ ...old, current: null }).current, null)
  assert.equal(projection.stateSchema.parse(null), null)
  assert.equal(projection.apply(state, { type: 'user/message', data: {} }), state, 'unrelated events keep the last stats')
})

test('examiner and verification_record share one parallel pool; other writers stay exclusive', async () => {
  const { tools } = await host()
  // dsh-tools batch.ts groups only consecutive concurrency-safe calls (and invalid arguments fall back to exclusive):
  // the next question can be written while grading runs.
  const calls = {
    examiner: { description: '出题', prompt: 'p' }, verification_record: { kpId: 'k', question: 'q', questionType: 'scenario' },
    kp_get: { kpId: 'k' }, checker: { description: '核对', prompt: 'p' },
    target_map_update: { kpId: 'k' }, course_save: { goal: 'g', status: 'active', chapters: [] }, diagnosis_record: { kpId: 'k', findings: [] },
  }
  const parallel = (name) => tools.get(name).isConcurrencySafe?.(calls[name]) === true
  assert.deepEqual(['examiner', 'verification_record', 'kp_get'].map(parallel), [true, true, true])
  assert.deepEqual(['checker', 'target_map_update', 'course_save', 'diagnosis_record'].map(parallel), [false, false, false, false])
})
