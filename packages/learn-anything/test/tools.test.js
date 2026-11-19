import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as t from '../src/host/tools.js'
import * as store from '../src/host/store.js'
import { assessVerification, evidence } from './helpers/assessment.js'
import { parseView } from '../src/host/render.js'

async function workspace(userTexts = [], legacy = false) {
  const cwd = await mkdtemp(join(tmpdir(), 'learn-'))
  if (legacy) { await mkdir(join(cwd, '.learn'), { recursive: true }); await writeFile(join(cwd, '.learn/course.json'), '{}') }
  let clock = new Date('2026-10-16T08:00:00Z')
  const env = {
    cwd,
    assessVerification,
    now: () => clock,
    userTexts: () => userTexts,
    advance: (days) => { clock = new Date(clock.getTime() + days * 86400000) },
  }
  return { env, cleanup: () => rm(cwd, { recursive: true, force: true }) }
}

const COURSE = {
  goal: '理解 JavaScript 闭包',
  status: 'planning',
  learner: { background: '会写基本 JS', preferOrder: 'unknown' },
  chapters: [
    { title: '作用域', kps: [{ id: 'scope', title: '词法作用域', kind: 'knowledge' }] },
    {
      title: '闭包',
      kps: [
        { id: 'closure', title: '闭包', kind: 'knowledge', prerequisites: ['scope'] },
        { id: 'iife', title: 'IIFE 的写法', kind: 'information' },
      ],
    },
  ],
}

test('learn_status without a course points to intake', async () => {
  const { env, cleanup } = await workspace()
  try {
    assert.match(await t.learnStatus.execute({}, env), /尚无课程/)
  } finally { await cleanup() }
})

test('course_save validates ids and prerequisites, keeps progress on re-save', async () => {
  const { env, cleanup } = await workspace()
  try {
    await assert.rejects(t.courseSave.execute({ ...COURSE, chapters: [{ title: 'x', kps: [{ id: 'a', title: 'a', kind: 'knowledge', prerequisites: ['zz'] }] }] }, env), /unknown prerequisites zz/)
    await assert.rejects(t.courseSave.execute({ ...COURSE, chapters: [{ title: 'x', kps: [{ id: '../a', title: 'a', kind: 'knowledge' }] }] }, env), /invalid id/)
    const out = await t.courseSave.execute(COURSE, env)
    assert.equal(await store.backend(env.cwd), 'sqlite', 'new learner workspaces use SQLite')
    const view = parseView(out)
    assert.equal(view.view, 'outline')
    assert.equal(view.chapters[1].kps.length, 2)
    await t.kpDefineModels.execute({ kpId: 'scope', models: [{ id: 'map', type: 'associative', input: '变量引用位置', output: '解析到的绑定', reference: '沿定义位置的作用域链向外查找' }] }, env)
    await t.courseSave.execute({ ...COURSE, status: 'active' }, env)
    const kp = await store.readJson(join(env.cwd, '.learn/kp/scope.json'))
    assert.equal(kp.models.length, 1, 're-saving the outline keeps defined models')
    assert.match(await t.learnStatus.execute({}, env), /当前知识点：词法作用域/)
  } finally { await cleanup() }
})

test('target_map_update only accepts the learner\'s own words', async () => {
  const said = ['我觉得闭包就是：函数记住了它定义时所在作用域里的变量，即使在外面调用也能用。']
  const { env, cleanup } = await workspace(said)
  try {
    await t.courseSave.execute(COURSE, env)
    await t.kpDefineModels.execute({ kpId: 'closure', models: [{ id: 'in', type: 'discriminative', concept: '闭包', reference: '函数 + 其定义时词法环境的引用' }] }, env)
    await assert.rejects(
      t.targetMapUpdate.execute({ kpId: 'closure', modelId: 'in', statement: '闭包是函数与其词法环境的组合' }, env),
      /does not appear in anything the learner typed/,
    )
    const ok = await t.targetMapUpdate.execute({ kpId: 'closure', modelId: 'in', statement: '函数记住了它定义时所在作用域里的变量，即使在外面调用也能用', show: true }, env)
    const view = parseView(ok)
    assert.equal(view.models[0].statement, '函数记住了它定义时所在作用域里的变量，即使在外面调用也能用')
    await t.targetMapUpdate.execute({ kpId: 'closure', modelId: 'in', addExamples: [{ tag: 'e', polarity: 'neg', input: 'function f(){ return 1 }', output: '不是闭包：没有引用外部变量', origin: 'ai' }] }, env)
    const kp = await store.readJson(join(env.cwd, '.learn/kp/closure.json'))
    assert.equal(kp.models[0].targetMap.examples[0].checked, false)
    assert.equal(kp.models[0].targetMap.statement.verified, true)
  } finally { await cleanup() }
})

test('statement without learner evidence fails closed', async () => {
  const { env, cleanup } = await workspace()
  env.userTexts = () => null
  try {
    await t.courseSave.execute(COURSE, env)
    await t.kpDefineModels.execute({ kpId: 'closure', models: [{ id: 'in', type: 'discriminative', concept: '闭包', reference: 'r' }] }, env)
    await assert.rejects(t.targetMapUpdate.execute({ kpId: 'closure', modelId: 'in', statement: '函数加上它的环境' }, env), /evidence unavailable/)
  } finally { await cleanup() }
})

test('phase transitions are validated', async () => {
  const { env, cleanup } = await workspace()
  try {
    await t.courseSave.execute(COURSE, env)
    await t.kpDefineModels.execute({ kpId: 'closure', models: [{ id: 'in', type: 'discriminative', concept: '闭包', reference: 'r' }] }, env)
    await assert.rejects(t.kpSetPhase.execute({ kpId: 'closure', modelId: 'in', phase: 'verify', reason: 'skip' }, env), /cannot go from assess to verify/)
    await assert.rejects(t.kpSetPhase.execute({ kpId: 'closure', modelId: 'in', phase: 'mastered', reason: 'x' }, env), /unknown phase|mastered is set automatically/)
    await t.diagnosisRecord.execute({ kpId: 'closure', modelId: 'in', findings: [{ type: 'prefers-examples', evidence: '用户说“先给我看个例子吧”' }], prescription: ['先例后规'] }, env)
    const course = await store.readJson(join(env.cwd, '.learn/course.json'))
    assert.equal(course.learner.preferOrder, 'example-first')
    assert.match(await t.kpSetPhase.execute({ kpId: 'closure', modelId: 'in', phase: 'build', reason: '材料就绪' }, env), /→ build/)
    await t.kpSetPhase.execute({ kpId: 'closure', modelId: 'in', phase: 'verify', reason: '已写表述' }, env)
  } finally { await cleanup() }
})

test('an on-track diagnosis after a statement keeps verifying instead of re-prescribing', async () => {
  const { env, cleanup } = await workspace(['函数加上它记住的变量'])
  try {
    await t.courseSave.execute(COURSE, env)
    await t.kpDefineModels.execute({ kpId: 'closure', models: [{ id: 'in', type: 'discriminative', concept: '闭包', reference: 'r' }] }, env)
    await t.targetMapUpdate.execute({ kpId: 'closure', modelId: 'in', statement: '函数加上它记住的变量' }, env)
    const ok = await t.diagnosisRecord.execute({ kpId: 'closure', modelId: 'in', findings: [{ type: 'on-track', evidence: 'v-1 答对' }] }, env)
    assert.match(ok, /→ verify/)
    await t.kpSetPhase.execute({ kpId: 'closure', modelId: 'in', phase: 'assess', reason: '再诊断' }, env)
    const fix = await t.diagnosisRecord.execute({ kpId: 'closure', modelId: 'in', findings: [{ type: 'on-track', evidence: 'x' }, { type: 'mismatch', evidence: 'y' }] }, env)
    assert.match(fix, /→ prescribe/)
  } finally { await cleanup() }
})

test('verification gate: novice until streak + required types, then mastered and scheduled', async () => {
  const { env, cleanup } = await workspace()
  try {
    await t.courseSave.execute(COURSE, env)
    await t.kpDefineModels.execute({ kpId: 'scope', models: [{ id: 'map', type: 'associative', input: '引用位置', output: '绑定', reference: 'r' }] }, env)
    const rec = (questionType, verdict = 'correct', extra = {}) =>
      t.verificationRecord.execute({ kpId: 'scope', modelId: 'map', question: `q-${questionType}`, questionType, answer: 'a', verdict, hintsUsed: 0, ...extra }, env)
    await assert.rejects(rec('recall'), /recall questions do not verify knowledge/)
    assert.match(await rec('scenario', 'wrong', { attribution: 'memorized-wording' }), /未入门.*\n.*暂不排复习/)
    env.advance(1 / 24)
    assert.doesNotMatch(await t.learnStatus.execute({}, env), /待复习/)
    assert.match(await rec('predict'), /入门/)
    assert.match(await rec('discriminate-neg'), /离「熟练」还差：再连续答对 1 题.*rephrase/)
    assert.match(await rec('rephrase', 'correct', { expected: { output: '外层的 x' } }), /熟练.*\n.*\n该知识点已达标/)
    const kp = await store.readJson(join(env.cwd, '.learn/kp/scope.json'))
    assert.equal(kp.phase, 'mastered')
    assert.equal(kp.models[0].targetMap.examples.at(-1).tag, 'v')
    assert.equal(await t.reviewDue.execute({}, env), '今天没有到期的复习。')
    env.advance(1 / 24)
    assert.doesNotMatch(await t.learnStatus.execute({}, env), /待复习/)
    env.advance(60)
    const dueText = await t.reviewDue.execute({}, env)
    assert.match(dueText, /请 examiner 出一道新情况题/)
    assert.match(dueText, /^现在 \d{4}-\d\d-\d\d \d\d:\d\d。/, 'review_due gives the tutor the current time')
    assert.match(dueText, /上次答题 60 天前/, 'and when each item was last answered')
    assert.match(await t.learnStatus.execute({}, env), /待复习 1 项/)
    assert.deepEqual(await t.learnStats(env.cwd, env.now()), { goal: COURSE.goal, due: 1, total: 3, mastered: 1, percent: 33, streak: 0, today: false })
  } finally { await cleanup() }
})

test('a graded answer returns a feedback card: verdict, attribution, level-up and the flow state', async () => {
  const { env, cleanup } = await workspace()
  try {
    await t.courseSave.execute(COURSE, env)
    await t.kpDefineModels.execute({ kpId: 'scope', models: [{ id: 'map', type: 'associative', input: '引用位置', output: '绑定', reference: 'r' }] }, env)
    const rec = (questionType, verdict = 'correct', extra = {}) =>
      t.verificationRecord.execute({ kpId: 'scope', modelId: 'map', question: `q-${questionType}`, questionType, answer: 'a', verdict, hintsUsed: 0, feedback: '用 x 的反例追问', ...extra }, env)
    const wrong = parseView(await rec('scenario', 'wrong', { attribution: 'lower-layer-loss' }))
    assert.equal(wrong.view, 'feedback')
    assert.equal(wrong.attribution, 'lower-layer-loss')
    assert.equal(wrong.feedback, undefined, 'the examiner\'s notes stay with the tutor')
    assert.deepEqual(wrong.level, { from: 'none', to: 'none' })
    assert.deepEqual([wrong.flow.next, wrong.flow.last.zone], [1, 'hard'], 'a wrong answer at the default 2 steps down')
    const kpFile = () => store.readJson(join(env.cwd, '.learn/kp/scope.json'))
    assert.equal((await kpFile()).models[0].phase, 'assess')
    const quick = await rec('contrast', 'partial', { difficulty: 1, attribution: 'careless' })
    assert.match(quick, /回到评估学况/, 'an answer outside a practice run keeps the route to diagnosis')
    for (const phase of ['prescribe', 'build', 'verify']) await t.kpSetPhase.execute({ kpId: 'scope', modelId: 'map', phase, reason: 'r' }, env)
    const firstText = await rec('predict', 'correct', { difficulty: 1, confidence: 'unsure' })
    assert.match(firstText, /留在验证阶段/, 'in a practice run a correct answer keeps going without a diagnosis round')
    assert.equal((await kpFile()).models[0].phase, 'verify')
    const first = parseView(firstText)
    assert.deepEqual([first.level, first.attribution, first.calibration.kind], [{ from: 'none', to: 'novice' }, undefined, 'under'])
    assert.deepEqual(first.flow.progress, { target: 'proficient', streak: { have: 1, need: 3 }, missing: ['discriminate-neg', 'rephrase'] })
    const second = parseView(await rec('discriminate-neg', 'correct', { difficulty: 1 }))
    assert.deepEqual([second.flow.next, second.flow.last.zone], [2, 'flow'], 'two clean answers step up, the second still in the flow zone')
    const up = parseView(await rec('rephrase', 'correct', { difficulty: 2 }))
    assert.deepEqual([up.level, up.kpLevel, up.passed], [{ from: 'novice', to: 'proficient' }, { from: 'novice', to: 'proficient' }, true])
    assert.deepEqual(up.flow.progress, { target: 'expert', missing: ['transfer', 'own-pos', 'own-neg'] })
  } finally { await cleanup() }
})

test('gentle wrong answers: the first wrong in a verify run stays in verify; repeated attribution or a confident miss goes to assess', async () => {
  const { env, cleanup } = await workspace()
  try {
    await t.courseSave.execute(COURSE, env)
    await t.kpDefineModels.execute({ kpId: 'scope', models: [{ id: 'map', type: 'associative', input: '引用位置', output: '绑定', reference: 'r' }] }, env)
    const kpFile = () => store.readJson(join(env.cwd, '.learn/kp/scope.json'))
    let n = 0
    const rec = (verdict, extra = {}) => t.verificationRecord.execute({ kpId: 'scope', modelId: 'map', question: `g-${++n}`, questionType: 'scenario', answer: 'a', verdict, hintsUsed: 0, difficulty: 2, ...extra }, env)
    const toVerify = async () => { for (const phase of ['prescribe', 'build', 'verify']) await t.kpSetPhase.execute({ kpId: 'scope', modelId: 'map', phase, reason: 'r' }, env) }
    await toVerify()
    assert.equal((await kpFile()).models[0].phase, 'verify')

    const first = await rec('wrong', { attribution: 'lower-layer-loss', confidence: 'unsure' })
    assert.match(first, /留在验证阶段/)
    assert.match(first, /第一次答错/)
    assert.doesNotMatch(first, /回到评估学况/)
    assert.equal((await kpFile()).models[0].phase, 'verify')
    assert.equal(parseView(first).flow.next, 1, 'difficulty still drops')
    assert.equal(parseView(first).flow.last.zone, 'hard')

    const second = await rec('wrong', { attribution: 'lower-layer-loss', confidence: 'unsure' })
    assert.match(second, /同一归因连续答错.*回到评估学况/)
    assert.equal((await kpFile()).models[0].phase, 'assess')

    await toVerify()
    const diff = await rec('wrong', { attribution: 'mismatch' })
    assert.match(diff, /留在验证阶段/, 'a different attribution after a wrong stays gentle')
    assert.equal((await kpFile()).models[0].phase, 'verify')

    await rec('correct', { difficulty: 1 })
    const afterCorrect = await rec('wrong', { attribution: 'mismatch' })
    assert.match(afterCorrect, /留在验证阶段/, 'a correct answer in between breaks the consecutive run')

    const sure = await rec('wrong', { attribution: 'concept-confusion', confidence: 'sure' })
    assert.match(sure, /「稳」却答错.*回到评估学况/)
    assert.equal((await kpFile()).models[0].phase, 'assess')

    await toVerify()
    assert.equal((await kpFile()).models[0].phase, 'verify')
  } finally { await cleanup() }
})

test('streak counts days in a row with an answer', () => {
  const at = (d, h = 12) => new Date(2026, 9, d, h).toISOString()
  const now = new Date(2026, 9, 22, 20)
  const vs = [{ at: at(19), verdict: 'correct' }, { at: at(20), verdict: 'wrong' }, { at: at(21), verdict: 'correct' }, { at: at(21, 13), verdict: 'correct' }]
  assert.deepEqual(t.streakOf(vs, now), { streak: 3, today: false }, 'alive until today ends')
  assert.deepEqual(t.streakOf([...vs, { at: at(22), verdict: 'correct' }], now), { streak: 4, today: true })
  assert.deepEqual(t.streakOf(vs, new Date(2026, 9, 23, 9)), { streak: 0, today: false }, 'a missed day resets it')
})

test('learnStats is null without a course', async () => {
  const { env, cleanup } = await workspace()
  try {
    assert.equal(await t.learnStats(env.cwd, env.now()), null)
  } finally { await cleanup() }
})

test('timeAgo says how long ago in the learner\'s words', () => {
  const now = new Date(2026, 9, 22, 20, 0)
  assert.equal(t.timeAgo(new Date(2026, 9, 22, 19, 59, 30), now), '刚刚')
  assert.equal(t.timeAgo(new Date(2026, 9, 22, 19, 48), now), '12 分钟前')
  assert.equal(t.timeAgo(new Date(2026, 9, 22, 9, 30), now), '10 小时前')
  assert.equal(t.timeAgo(new Date(2026, 9, 21, 23, 30), now), '昨天 23:30')
  assert.equal(t.timeAgo(new Date(2026, 9, 18, 8, 0), now), '4 天前')
})

test('information points use facts and recall', async () => {
  const { env, cleanup } = await workspace()
  try {
    await t.courseSave.execute(COURSE, env)
    await assert.rejects(t.kpDefineModels.execute({ kpId: 'iife', models: [{ id: 'x', type: 'discriminative', concept: 'c', reference: 'r' }] }, env), /is information/)
    assert.match(await t.kpDefineModels.execute({ kpId: 'iife', facts: [{ prompt: 'IIFE 的基本写法？', answer: '(function(){ ... })()' }] }, env), /记忆阶段/)
    for (let i = 0; i < 2; i++) await t.verificationRecord.execute({ kpId: 'iife', question: 'IIFE 写法', questionType: 'recall', answer: '(function(){})()', verdict: 'correct' }, env)
    const kp = await store.readJson(join(env.cwd, '.learn/kp/iife.json'))
    assert.equal(kp.mastery, 'proficient')
    assert.equal(kp.phase, 'mastered')
  } finally { await cleanup() }
})

test('progress_get reports weak points with attributions', async () => {
  const { env, cleanup } = await workspace()
  try {
    await t.courseSave.execute(COURSE, env)
    await t.kpDefineModels.execute({ kpId: 'closure', models: [{ id: 'in', type: 'discriminative', concept: '闭包', reference: 'r' }] }, env)
    for (const attribution of ['memorized-wording', 'mismatch']) {
      await t.verificationRecord.execute({ kpId: 'closure', modelId: 'in', question: 'q', questionType: 'scenario', answer: 'a', verdict: 'wrong', attribution }, env)
    }
    const view = parseView(await t.progressGet.execute({}, env))
    assert.equal(view.total, 3)
    assert.equal(view.weak[0].id, 'closure')
    assert.match(view.weak[0].reason, /记言代学、下上错配/)
  } finally { await cleanup() }
})

test('outline links only web resources; an empty target map says it has no models', async () => {
  const { env, cleanup } = await workspace()
  try {
    const resources = [{ title: 'MDN 闭包', url: 'https://developer.mozilla.org/docs/Web/JavaScript/Closures' }, { title: '课本', url: 'm-ab12' }]
    const out = await t.courseSave.execute({ ...COURSE, resources }, env)
    assert.match(out, /- \[MDN 闭包\]\(https:\/\/developer\.mozilla\.org/)
    assert.match(out, /- 课本（材料 m-ab12）/)
    assert.doesNotMatch(out, /\]\(m-ab12\)/)
    assert.match(await t.kpGet.execute({ kpId: 'closure' }, env), /（还没有模型）/)
  } finally { await cleanup() }
})

test('example ids stay unique after a removal', async () => {
  const { env, cleanup } = await workspace()
  try {
    await t.courseSave.execute(COURSE, env)
    await t.kpDefineModels.execute({ kpId: 'scope', models: [{ id: 'map', type: 'associative', input: 'x', output: 'y', reference: 'r' }] }, env)
    const ex = (i) => ({ tag: 'e', input: `i${i}`, output: 'o', origin: 'ai' })
    await t.targetMapUpdate.execute({ kpId: 'scope', modelId: 'map', addExamples: [ex(1), ex(2), ex(3)] }, env)
    await t.targetMapUpdate.execute({ kpId: 'scope', modelId: 'map', removeExampleIds: ['map-e2'] }, env)
    await t.targetMapUpdate.execute({ kpId: 'scope', modelId: 'map', addExamples: [ex(4)] }, env)
    await t.verificationRecord.execute({ kpId: 'scope', modelId: 'map', question: 'q', questionType: 'predict', answer: 'a', verdict: 'correct', hintsUsed: 0, expected: { output: 'y' } }, env)
    const kp = await store.readJson(join(env.cwd, '.learn/kp/scope.json'))
    assert.deepEqual(kp.models[0].targetMap.examples.map((e) => e.id), ['map-e1', 'map-e3', 'map-e4', 'map-e5'])
  } finally { await cleanup() }
})

test('a discriminate question writes its example back with the polarity of its type', async () => {
  const { env, cleanup } = await workspace()
  try {
    await t.courseSave.execute(COURSE, env)
    await t.kpDefineModels.execute({ kpId: 'scope', models: [{ id: 'map', type: 'associative', input: 'x', output: 'y', reference: 'r' }] }, env)
    const record = (questionType, polarity) => t.verificationRecord.execute({ kpId: 'scope', modelId: 'map', question: questionType, questionType, answer: 'a', verdict: 'correct', expected: { output: 'o', polarity } }, env)
    await record('discriminate-neg', 'pos')
    await record('discriminate-pos')
    await record('predict', 'neg')
    const kp = await store.readJson(join(env.cwd, '.learn/kp/scope.json'))
    assert.deepEqual(kp.models[0].targetMap.examples.map((e) => e.polarity), ['neg', 'pos', 'neg'])
  } finally { await cleanup() }
})

test('kp views only show verifications of that point', async () => {
  const { env, cleanup } = await workspace()
  try {
    await t.courseSave.execute(COURSE, env)
    for (const kpId of ['scope', 'closure']) {
      await t.kpDefineModels.execute({ kpId, models: [{ id: 'map', type: 'associative', input: 'x', output: 'y', reference: 'r' }] }, env)
    }
    await t.verificationRecord.execute({ kpId: 'scope', modelId: 'map', question: 'on-scope', questionType: 'predict', answer: 'a', verdict: 'wrong', hintsUsed: 0, attribution: 'memorized-wording' }, env)
    const view = parseView(await t.kpGet.execute({ kpId: 'closure' }, env))
    assert.deepEqual(view.models[0].verifications ?? [], [])
  } finally { await cleanup() }
})

test('kp_define_models rejects duplicate model ids', async () => {
  const { env, cleanup } = await workspace()
  try {
    await t.courseSave.execute(COURSE, env)
    const m = { id: 'in', type: 'discriminative', concept: '闭包', reference: 'r' }
    await assert.rejects(t.kpDefineModels.execute({ kpId: 'closure', models: [m, m] }, env), /duplicate model id in/)
  } finally { await cleanup() }
})

test('course_save checks the complete outline before writing any knowledge point', async () => {
  const { env, cleanup } = await workspace()
  try {
    await t.courseSave.execute(COURSE, env)
    await t.kpDefineModels.execute({ kpId: 'closure', models: [{ id: 'map', type: 'associative', input: 'x', output: 'y', reference: 'r' }] }, env)
    const courseBefore = JSON.stringify(await store.readJson(join(env.cwd, '.learn/course.json')))
    const scopeBefore = JSON.stringify(await store.readJson(join(env.cwd, '.learn/kp/scope.json')))
    await assert.rejects(t.courseSave.execute({ ...COURSE, chapters: [{ title: 'new', kps: [
      { id: 'scope', title: 'changed', kind: 'knowledge' },
      { id: 'new-point', title: 'new', kind: 'knowledge' },
      { id: 'closure', title: 'invalid conversion', kind: 'information' },
    ] }] }, env), /different id instead of changing its kind/)
    assert.equal(JSON.stringify(await store.readJson(join(env.cwd, '.learn/course.json'))), courseBefore)
    assert.equal(JSON.stringify(await store.readJson(join(env.cwd, '.learn/kp/scope.json'))), scopeBefore)
    assert.equal(await store.readJson(join(env.cwd, '.learn/kp/new-point.json'), null), null)
  } finally { await cleanup() }
})

test('answered model definitions need a new id when their meaning changes', async () => {
  const { env, cleanup } = await workspace()
  try {
    await t.courseSave.execute(COURSE, env)
    const model = { id: 'map', type: 'associative', input: 'x', output: 'y', reference: 'y=2x' }
    await t.kpDefineModels.execute({ kpId: 'scope', models: [model] }, env)
    for (const questionType of ['scenario', 'discriminate-neg', 'rephrase']) {
      await t.verificationRecord.execute({ kpId: 'scope', modelId: 'map', question: questionType, questionType, answer: 'a', verdict: 'correct' }, env)
    }
    const file = join(env.cwd, '.learn/kp/scope.json')
    const before = JSON.stringify(await store.readJson(file))
    await assert.rejects(t.kpDefineModels.execute({ kpId: 'scope', models: [{ ...model, reference: 'y=x*x' }] }, env), /use a new model id/)
    assert.equal(JSON.stringify(await store.readJson(file)), before)
    await t.kpDefineModels.execute({ kpId: 'scope', models: [model] }, env)
    assert.equal((await store.readJson(file)).mastery, 'proficient')
    await t.kpDefineModels.execute({ kpId: 'scope', models: [{ ...model, id: 'new-map', reference: 'y=x*x' }] }, env)
    assert.equal((await store.readJson(file)).mastery, 'none')
    await assert.rejects(t.kpDefineModels.execute({ kpId: 'scope', models: [model] }, env), /use a new model id/)
  } finally { await cleanup() }
})

test('every information fact must pass, while fact ids survive ordinary saves', async () => {
  const { env, cleanup } = await workspace()
  try {
    await t.courseSave.execute(COURSE, env)
    const facts = [{ prompt: 'A?', answer: 'a' }, { prompt: 'B?', answer: 'b' }]
    await t.kpDefineModels.execute({ kpId: 'iife', facts }, env)
    const file = join(env.cwd, '.learn/kp/iife.json')
    const load = async () => await store.readJson(file)
    const ids = (await load()).facts.map((fact) => fact.id)
    const rec = (factId, extra = {}) => t.verificationRecord.execute({ kpId: 'iife', factId, question: 'recall', questionType: 'recall', answer: 'a', verdict: 'correct', ...extra }, env)
    await assert.rejects(rec(undefined), /valid factId/)
    await assert.rejects(rec('missing'), /valid factId/)
    await assert.rejects(rec(ids[0], { questionType: 'scenario' }), /need recall/)
    assert.deepEqual(await store.readJsonl(store.paths(env.cwd).verifications), [])
    await rec(ids[0])
    const afterA = await rec(ids[0])
    assert.match(afterA, new RegExp(`未达标记忆卡：${ids[1]}；`))
    assert.match(await t.kpGet.execute({ kpId: 'iife' }, env), new RegExp(`${ids[0]}: A\\? → a（熟练）`))
    assert.notEqual((await load()).phase, 'mastered')
    await rec(ids[1]); await rec(ids[1])
    assert.equal((await load()).mastery, 'proficient')
    await t.kpDefineModels.execute({ kpId: 'iife', facts }, env)
    assert.deepEqual((await load()).facts.map((fact) => fact.id), ids)
    assert.equal((await load()).mastery, 'proficient')
    await assert.rejects(t.kpDefineModels.execute({ kpId: 'iife', facts: [{ ...facts[0], id: ids[0], answer: 'changed' }] }, env), /new fact id/)
    await t.kpDefineModels.execute({ kpId: 'iife', facts: [facts[0], { prompt: 'C?', answer: 'c' }] }, env)
    assert.equal((await load()).facts[0].id, ids[0])
    assert.notEqual((await load()).facts[1].id, ids[1])
    assert.equal((await load()).mastery, 'none')
    assert.equal((await load()).phase, 'memorize')
    assert.match(await t.kpGet.execute({ kpId: 'iife' }, env), new RegExp(ids[0]))
  } finally { await cleanup() }
})

test('review queues and counts ignore dropped points and replaced models without deleting history', async () => {
  const { env, cleanup } = await workspace()
  env.gate = { streak: 1, requiredTypes: [], recallStreak: 2 }
  try {
    const point = (id) => ({ id, title: id, kind: 'knowledge' })
    const course = { goal: 'review', status: 'active', chapters: [{ title: 'c', kps: ['active', 'replaced', 'dropped'].map(point) }] }
    await t.courseSave.execute(course, env)
    const model = { id: 'map', type: 'associative', input: 'x', output: 'y', reference: 'r' }
    for (const kpId of ['active', 'replaced', 'dropped']) {
      await t.kpDefineModels.execute({ kpId, models: [model] }, env)
      await t.verificationRecord.execute({ kpId, modelId: 'map', question: 'q', questionType: 'scenario', answer: 'a', verdict: 'correct' }, env)
    }
    const historyBefore = JSON.stringify(await store.readJson(join(env.cwd, '.learn/reviews.json')))
    await t.kpDefineModels.execute({ kpId: 'replaced', models: [{ ...model, id: 'new' }] }, env)
    await t.courseSave.execute({ ...course, chapters: [{ title: 'c', kps: ['active', 'replaced'].map(point) }] }, env)
    env.advance(365)
    const queue = await t.reviewDue.execute({}, env)
    assert.match(queue, /到期复习 1 项/)
    assert.match(queue, /active \/ map/)
    assert.doesNotMatch(queue, /replaced|dropped|（信息）/)
    assert.match(await t.learnStatus.execute({}, env), /待复习 1 项/)
    assert.equal(parseView(await t.progressGet.execute({}, env)).due, 1)
    assert.equal((await t.learnStats(env.cwd, env.now())).due, 1)
    assert.equal(JSON.stringify(await store.readJson(join(env.cwd, '.learn/reviews.json'))), historyBefore)
  } finally { await cleanup() }
})
test('old unlabelled recalls only prove the original single fact, not a multi-fact point', async () => {
  const { env, cleanup } = await workspace([], true)
  const { writeFile } = await import('node:fs/promises')
  try {
    await t.courseSave.execute(COURSE, env)
    const file = join(env.cwd, '.learn/kp/iife.json')
    const kp = JSON.parse(await readFile(file, 'utf8'))
    const legacy = { ...kp, phase: 'mastered', mastery: 'proficient', facts: [{ prompt: 'A?', answer: 'a' }, { prompt: 'B?', answer: 'b' }] }
    const records = [1, 2].map((i) => ({ id: `v-${i}`, kpId: 'iife', questionType: 'recall', question: 'A?', answer: 'a', verdict: 'correct', evidence: evidence(), at: env.now().toISOString() }))
    await writeFile(file, JSON.stringify(legacy))
    await writeFile(join(env.cwd, '.learn/verifications.jsonl'), records.map((v) => JSON.stringify(v)).join('\n') + '\n')
    assert.equal(parseView(await t.courseGet.execute({}, env)).chapters[1].kps[1].mastery, 'none')
    assert.equal((await t.learnStats(env.cwd, env.now())).mastered, 0)
    const rawBefore = await readFile(file, 'utf8')
    assert.equal(parseView(await t.kpGet.execute({ kpId: 'iife' }, env)).kp.phase, 'memorize')
    assert.equal(await readFile(file, 'utf8'), rawBefore, 'reads correct the view without rewriting old data')
    legacy.facts.pop()
    await writeFile(file, JSON.stringify(legacy))
    assert.equal((await t.learnStats(env.cwd, env.now())).mastered, 1, 'legacy single-fact progress stays valid')
    await t.kpDefineModels.execute({ kpId: 'iife', facts: legacy.facts }, env)
    assert.equal(JSON.parse(await readFile(file, 'utf8')).mastery, 'proficient')
    await t.kpDefineModels.execute({ kpId: 'iife', facts: [{ prompt: 'new?', answer: 'new' }] }, env)
    assert.equal(JSON.parse(await readFile(file, 'utf8')).mastery, 'none', 'new content cannot inherit unlabelled old answers')
  } finally { await cleanup() }
})
