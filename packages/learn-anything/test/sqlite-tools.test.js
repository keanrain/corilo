// SQLite integration of real public tool definitions; examiner results are an
// explicit seam here. Native host/browser evidence is covered separately.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as store from '../src/host/store.js'
import * as tools from '../src/host/tools.js'
import { readTargetMap, saveTargetMap } from '../src/host/target-edit.js'
import { readOutline, saveOutline } from '../src/host/tools/course.js'
import { editModels } from '../src/client/target-editor.js'

async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'learn-sqlite-tools-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const env = { cwd, now: () => new Date('2026-11-16T02:00:00Z'), gate: { streak: 1, requiredTypes: [], recallStreak: 1 },
    userTexts: () => ['用户原话：输入变化决定输出变化'],
    assessVerification: async () => ({ answer: '输入变化决定输出变化', verdict: 'correct', questionType: 'scenario', difficulty: 2,
      novel: true, explainedRule: true, expected: { output: '正确输出' }, feedback: '根据规律作答', confidence: 'sure', hintsUsed: 0,
      evidence: { version: 1, sessionId: 'sqlite-integration', questionSeq: 1, messageSeq: 2, examinerDigest: 'a'.repeat(64) } }),
  }
  await tools.courseSave.execute({ goal: 'SQLite integration', status: 'planning', chapters: [{ title: 'ch', kps: [{ id: 'kp', title: 'KP', kind: 'knowledge' }] }] }, env)
  await tools.kpDefineModels.execute({ kpId: 'kp', models: [{ id: 'map', type: 'associative', input: '输入', output: '输出', reference: '输入变化决定输出变化' }] }, env)
  return { cwd, env }
}
const args = { kpId: 'kp', modelId: 'map', question: '在新情境下预测输出', questionType: 'scenario' }

test('public grading commits verification, examples, mastery and review atomically without JSON mirrors', async (t) => {
  const { cwd, env } = await fixture(t)
  assert.equal(await store.backend(cwd), 'sqlite')
  await tools.verificationRecord.execute(args, env)
  const records = await store.readJsonl(store.paths(cwd).verifications)
  const kp = await store.requireKp(cwd, 'kp')
  const reviews = await store.readJson(store.paths(cwd).reviews, null)
  assert.equal(records.length, 1)
  assert.equal(kp.mastery, 'proficient')
  assert.equal(kp.models[0].targetMap.examples[0].verificationId, records[0].id)
  assert.ok(reviews.cards['kp/map'].card.due)
  for (const path of [store.paths(cwd).course, store.paths(cwd).kp('kp'), store.paths(cwd).verifications, store.paths(cwd).reviews]) await assert.rejects(access(path), { code: 'ENOENT' })
})

test('failure after grading rolls back every staged learner update, then retry succeeds once', async (t) => {
  const { cwd, env } = await fixture(t)
  const before = await store.requireKp(cwd, 'kp')
  await assert.rejects(store.withWorkspaceWrite(cwd, async () => {
    await tools.verificationRecord.execute(args, env)
    assert.equal((await store.readJsonl(store.paths(cwd).verifications)).length, 1)
    assert.equal((await store.requireKp(cwd, 'kp')).mastery, 'proficient')
    assert.ok((await store.readJson(store.paths(cwd).reviews, null)).cards['kp/map'])
    throw new Error('interrupted before commit')
  }), /interrupted before commit/)
  assert.deepEqual(await store.requireKp(cwd, 'kp'), before)
  assert.deepEqual(await store.readJsonl(store.paths(cwd).verifications), [])
  assert.equal(await store.readJson(store.paths(cwd).reviews, null), null)
  await tools.verificationRecord.execute(args, env)
  await assert.rejects(tools.verificationRecord.execute(args, env), /unique|duplicate|already|constraint|重复/i)
  assert.equal((await store.readJsonl(store.paths(cwd).verifications)).length, 1)
  assert.equal((await store.requireKp(cwd, 'kp')).models[0].targetMap.examples.length, 1)
})

test('SQLite outline and target-map actions persist through logical keys with stale guards', async (t) => {
  const { cwd } = await fixture(t)
  const outline = await readOutline(cwd)
  const chapters = outline.view.chapters
  chapters[0].kps[0].title = 'Edited KP'
  const saved = await saveOutline(cwd, { expected: outline.revision, chapters, status: 'active' })
  assert.equal(saved.view.status, 'active')
  assert.equal((await store.requireKp(cwd, 'kp')).title, 'Edited KP')
  const target = await readTargetMap(cwd, 'kp')
  const models = editModels(target.view)
  models[0].annotation = 'SQLite note'
  await saveTargetMap(cwd, { kpId: 'kp', expected: target.revision, models })
  assert.equal((await store.requireKp(cwd, 'kp')).models[0].targetMap.annotation, 'SQLite note')
  await assert.rejects(saveTargetMap(cwd, { kpId: 'kp', expected: target.revision, models }), (error) => error.status === 409)
  assert.deepEqual(await store.readJsonl(store.paths(cwd).verifications), [])
})

test('host commits before external reminder creation and does not replay an examiner on conflict', async (t) => {
  const { apply } = await import('../src/host/index.js')
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const { cwd, env } = await fixture(t)
  const registered = new Map()
  let exams = 0, reminders = 0, timerRead
  const storeUrl = new URL('../src/host/store.js', import.meta.url).href
  const data = { cwd, course: store.paths(cwd).course }
  const ctx = {
    tools: { register: (tool) => registered.set(tool.name, tool), guard() {} },
    sessionProjections: { async register() { return { stateOf: () => [] } } },
    effect: (fn) => fn(),
    logger: { warn() {} },
    inject(dependencies, setup) {
      if (dependencies.includes('subagents')) setup({ tools: ctx.tools, subagents: {
        async startActivation() {
          exams++
          // Another host commits while this host awaits an examiner. No SQLite
          // write lock may span the network wait, and no automatic replay follows.
          if (exams === 1) await promisify(execFile)(process.execPath, ['--input-type=module', '-e',
            `import * as s from ${JSON.stringify(storeUrl)}; const d=JSON.parse(process.argv[1]); await s.withWorkspaceWrite(d.cwd, async()=>{const c=await s.readJson(d.course); await s.writeJson(d.course,{...c,goal:'Concurrent course edit'})})`, JSON.stringify(data)])
          return { result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: JSON.stringify({ verdict: 'correct', questionType: 'scenario', difficulty: 2, novel: true, explainedRule: true, feedback: '新情境回答正确', output: '正确输出' }) }] }), async dispose() {} }
        },
      } })
      if (dependencies.includes('schedule')) setup({ tools: ctx.tools, effect: ctx.effect, schedule: {
        async catalog() { return [] },
        async create() {
          reminders++
          // Native scheduler timers created here must not inherit a finished
          // learner transaction when they deliver their future session turn.
          timerRead = new Promise((resolve, reject) => setTimeout(() => {
            tools.learnStatus.execute({}, env).then(resolve, reject)
          }, 10))
          return { id: 'native-reminder' }
        },
      } })
    },
  }
  await apply(ctx, { streak: 1, requiredTypes: [], recallStreak: 1, methodology: false, interactiveQuiz: false, reminderTime: '20:00', reminderTimeZone: 'UTC' })
  const events = [
    { type: 'assistant/message', data: { content: [{ type: 'text', text: args.question }] } },
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '输入变化决定输出变化，所以这里输出变化。' }] } },
  ]
  const exec = { agent: { session: { id: 'host-sqlite', header: { cwd }, seq: events.length, eventAt: (index) => events[index] } }, signal: new AbortController().signal }
  await assert.rejects(registered.get('verification_record').execute(args, exec), (error) => error.status === 409)
  assert.equal(exams, 1)
  assert.equal(reminders, 0)
  assert.deepEqual(await store.readJsonl(store.paths(cwd).verifications), [])
  assert.equal((await store.requireKp(cwd, 'kp')).mastery, 'none')
  assert.equal((await store.requireCourse(cwd)).goal, 'Concurrent course edit')
  await registered.get('verification_record').execute(args, exec)
  assert.equal(exams, 2)
  assert.equal(reminders, 1)
  assert.equal((await store.readJsonl(store.paths(cwd).verifications)).length, 1)
  assert.equal((await store.readJson(store.paths(cwd).reminder, null)).id, 'native-reminder')
})

test('read-only tools use a coherent committed snapshot without waiting behind an awaiting writer', async (t) => {
  const { cwd, env } = await fixture(t)
  let entered, release
  const started = new Promise((resolve) => { entered = resolve })
  const waiting = new Promise((resolve) => { release = resolve })
  const writer = store.withWorkspaceWrite(cwd, async () => {
    const course = await store.requireCourse(cwd)
    await store.writeJson(store.paths(cwd).course, { ...course, goal: 'not committed yet' })
    entered()
    await waiting
  })
  await started
  try {
    const response = await Promise.race([
      tools.learnStatus.execute({}, env),
      new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('read-only tool waited for the writer')), 2000); timer.unref() }),
    ])
    assert.match(response, /SQLite integration/)
    assert.doesNotMatch(response, /not committed yet/)
  } finally { release() }
  await writer
  assert.match(await tools.learnStatus.execute({}, env), /not committed yet/)
})

test('cancellation during examiner await rolls back staged grades before commit', async (t) => {
  const { cwd, env } = await fixture(t)
  const controller = new AbortController()
  const assess = env.assessVerification
  env.signal = controller.signal
  env.assessVerification = async () => {
    const result = await assess()
    controller.abort(new Error('cancelled during examiner'))
    return result
  }
  const before = await store.requireKp(cwd, 'kp')
  await assert.rejects(tools.verificationRecord.execute(args, env), /cancelled during examiner/)
  assert.deepEqual(await store.requireKp(cwd, 'kp'), before)
  assert.deepEqual(await store.readJsonl(store.paths(cwd).verifications), [])
  assert.equal(await store.readJson(store.paths(cwd).reviews, null), null)
})

test('an aborted UI request cannot commit a staged action result', async (t) => {
  const { registerLearningApi } = await import('../src/host/ui.js')
  const { cwd } = await fixture(t)
  const controller = new AbortController()
  const routes = new Map()
  const before = await store.requireCourse(cwd)
  registerLearningApi({
    effect: (fn) => fn(),
    sessions: { get: () => ({ header: { cwd, agentPreset: 'learn-tutor' } }) },
    connection: { fetch: { register: (route) => routes.set(route.path, route) } },
  }, {
    async saveOutline() {
      await store.writeJson(store.paths(cwd).course, { ...before, goal: 'cancelled UI edit' })
      controller.abort()
      return { saved: true }
    },
  })
  const response = await routes.get('/api/learn-anything/outline/save').fetch(new Request('http://localhost/api/learn-anything/outline/save', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'tutor' }), signal: controller.signal,
  }))
  assert.equal(response.status, 503)
  assert.deepEqual(await store.requireCourse(cwd), before)
})
