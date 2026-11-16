#!/usr/bin/env node
// Teaching-quality eval (design §7): 3 mini-courses × 5 learner defects.
// Each scenario seeds a workspace with a one-point course whose models are
// defined (the point sits in 评估学况), lets the tutor talk to an LLM-simulated
// learner that has the defect, and scores:
//   diagnosis   the tutor recorded a finding of the expected type (also: was it the first finding,
//               and how many other problem types were recorded)
//   prescription an LLM judge rates the prescription against the defect's remedy
//                (--no-judge falls back to keyword match)
//   不代写       every statement on the target map appears in what the learner typed
//                as a chat message (same rule as the tool layer: ask_user_question
//                answers do not count)
//   quiz        interactive cards: rendered share of quiz_show calls, examiner 【互动】 blocks, answer leaks
//   flow        novel-question records with a difficulty, how often that difficulty was the one the
//               staircase of src/host/flow.js suggested, and the easy / flow / hard mix of the answers
//               (a statistic of the verdict sequence, not of how well the difficulty fit)
//   cost        tokens (tutor + subagents), LLM requests, tool calls, web searches, turns
//   timing      accepted opening → first quiz ready, answer submission → feedback ready, tutor steps per question
//   materials   three real-block fixtures: supported citation, missing block, unsupported claim
// Safety gates: scenario errors, ghostwriting, answer leaks, broken citation chains and repair failures exit nonzero.
// Diagnosis hit rates remain a report. Timing measures Host results, not browser paint.
//
//   DEEPSEEK_API_KEY=… node eval/run.mjs [--only function] [--turns 8] [--until diagnosed|verified] [--verifications N]
//   (--verifications N with --until verified: run on until N questions are recorded, so the staircase can move)
//   node eval/run.mjs --mock          # plumbing check against test/boot/mock-llm.mjs
//   node eval/run.mjs --mock --only materials --until verified  # real files, scripted model decisions
//   node eval/run.mjs --quality [--mock | --anthropic]  # eight fixed examiner regressions
//   node eval/run.mjs --only repair --until verified --no-judge --keep  # controlled question repair, real agents
//   node eval/run.mjs --local-auth --only prerequisite-recovery --no-judge --keep # reuse DSH's stored API credential
//   node eval/run.mjs --anthropic     # tutor, learner and judge on $ANTHROPIC_BASE_URL / $ANTHROPIC_MODEL
//                                     # (bearer $ANTHROPIC_AUTH_TOKEN), as a route of dsh's Messages adapter
//
// LEARNER_MODEL / LEARNER_BASE_URL pick the simulated learner, JUDGE_MODEL / JUDGE_BASE_URL the
// prescription judge (default: the tutor's endpoint, deepseek-flash).
// LEARN_ANYTHING_DSH=<dsh lib/bin.js> uses a local dsh instead of npx.
//
//   node eval/run.mjs --anthropic --only function/memorized --inspect [--inspect-port 9229]
// captures the tutor's LLM requests for debugging: each scenario's dsh process starts paused under
// Node's inspector with network inspection; attach Chrome DevTools (chrome://inspect) and its Network
// panel shows every Messages request and SSE response, unredacted (bearer token included). Needs
// LEARN_ANYTHING_DSH. (dsh's own Developer Tools bundle needs the Web host, which `dsh x` lacks.)
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import * as tools from '../src/host/tools.js'
import { learnerDocument, learnerEvents } from './learner-store.js'
import { parseView } from '../src/host/render.js'
import { staircase } from '../src/host/flow.js'
import { ingestMaterial } from '../src/host/ingest.js'
import { failuresOf, practiceTiming, performanceTiming, materialStats, quizStats } from './metrics.js'
import { REPAIR_SCENARIO, scoreRepair } from './repair.js'
import { LEARNING_LOOP_SCENARIO, scoreLearningLoop } from './learning-loop.js'
import { RECOVERY_SCENARIO, scoreRecovery } from './prerequisite-recovery.js'
import { TRUST_SCENARIO, scoreTrust } from './trust.js'

// Keep the runtime gate aligned with package.json engines.
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number)
if (nodeMajor < 24 || (nodeMajor === 24 && nodeMinor < 9)) {
  console.error(`eval: dsh needs Node.js >= 24.9, this is ${process.versions.node}`)
  process.exit(2)
}

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const { values: opt } = parseArgs({
  options: {
    mock: { type: 'boolean', default: false },
    quality: { type: 'boolean', default: false },
    only: { type: 'string' },
    turns: { type: 'string' },
    until: { type: 'string', default: 'diagnosed' },
    verifications: { type: 'string', default: '1' },
    keep: { type: 'boolean', default: false },
    'no-judge': { type: 'boolean', default: false },
    anthropic: { type: 'boolean', default: false },
    'local-auth': { type: 'boolean', default: false },
    inspect: { type: 'boolean', default: false },
    'inspect-port': { type: 'string', default: '9229' },
  },
})
if (!['diagnosed', 'verified'].includes(opt.until)) {
  console.error('eval: --until must be diagnosed or verified')
  process.exit(2)
}
const verifications = Number(opt.verifications)
if (!Number.isInteger(verifications) || verifications < 1) {
  console.error('eval: --verifications must be a positive integer')
  process.exit(2)
}
if (opt.anthropic && !(process.env.ANTHROPIC_BASE_URL && process.env.ANTHROPIC_AUTH_TOKEN && process.env.ANTHROPIC_MODEL)) {
  console.error('eval: --anthropic needs ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN and ANTHROPIC_MODEL')
  process.exit(2)
}
if (opt['local-auth'] && (opt.mock || opt.anthropic || !opt['no-judge'] || !['prerequisite-recovery', 'trust'].includes(opt.only))) {
  console.error('eval: --local-auth requires --only prerequisite-recovery|trust --no-judge, without --mock or --anthropic')
  process.exit(2)
}
if (!opt.mock && !opt.anthropic && !opt['local-auth'] && !process.env.DEEPSEEK_API_KEY) {
  console.error('eval: set DEEPSEEK_API_KEY, or pass --anthropic (Anthropic-compatible gateway) or --mock (plumbing only)')
  process.exit(2)
}

const MOCK_PORT = process.env.MOCK_PORT ?? '18798'
const MOCK_ENV = { DEEPSEEK_API_KEY: 'sk-test', DEEPSEEK_BASE_URL: `http://127.0.0.1:${MOCK_PORT}` }
/** Endpoint overrides for the tutor (dsh) and learner. */
const LLM_ENV = opt.mock ? MOCK_ENV : opt.anthropic ? { LA_EVAL_ANTHROPIC: '1' } : {}

if (opt.quality) {
  const { runQuality } = await import('./quality.js')
  const report = await runQuality({ mock: opt.mock, only: opt.only, route: opt.mock ? undefined : judgeEndpoint() })
  const dir = join(here, 'results')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `quality-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}${opt.mock ? '-mock' : ''}.json`)
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report.summary))
  console.error(`eval: results in ${file}`)
  for (const failure of report.failures) console.error(`eval: FAIL ${failure}`)
  process.exit(report.failures.length ? 1 : 0)
}

const spec = JSON.parse(readFileSync(join(here, 'scenarios.json'), 'utf8'))
const materials = JSON.parse(readFileSync(join(here, 'material-scenarios.json'), 'utf8'))
const scenarios = [...spec.courses.flatMap((course) => Object.entries(course.personas).map(([defect, persona]) => ({
  id: `${course.id}/${defect}`, course, defect, persona, expect: spec.defects[defect],
}))), ...materials.cases.map((materialCase) => ({
  id: `materials/${materialCase.id}`, course: materials.course, defect: 'lower-layer-loss', persona: materials.persona,
  expect: spec.defects['lower-layer-loss'], materialCase,
})), ...(!opt.mock && opt.only ? [REPAIR_SCENARIO, LEARNING_LOOP_SCENARIO, RECOVERY_SCENARIO, TRUST_SCENARIO] : [])].filter((s) => !opt.only || s.id.includes(opt.only))
if (!scenarios.length) throw new Error(`no scenarios match --only ${opt.only}`)

const dshBin = process.env.LEARN_ANYTHING_DSH
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const dsh = dshBin ? [process.execPath, dshBin] : ['npx', '-y', `@deepseek-ai/dsh@${pkg.engines.dsh}`]
if (opt.inspect && !dshBin) {
  console.error('eval: --inspect needs LEARN_ANYTHING_DSH (Node rejects network inspection in NODE_OPTIONS)')
  process.exit(2)
}
/** Node flags for the scenario runs: paused under the inspector with fetch capture, when asked. */
const inspectFlags = opt.inspect ? [`--inspect-wait=127.0.0.1:${opt['inspect-port']}`, '--experimental-network-inspection'] : []
const work = mkdtempSync(join(tmpdir(), 'la-eval-'))
const baseEnv = { ...process.env, DSH_HOME: join(work, 'home') }
// Let DSH resolve its stored credentials; the eval never reads or copies their contents.
const authPatch = join(work, 'local-auth.json')
if (opt['local-auth']) writeFileSync(authPatch, JSON.stringify([
  { id: 'credentials', disabled: false, config: { path: join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), '.credentials.yaml'), watch: false } },
]))

function run(args, opts = {}) {
  const node = opts.inspect ? inspectFlags : []
  const r = spawnSync(dsh[0], [...node, ...dsh.slice(1), ...args], { env: { ...baseEnv, ...opts.env }, cwd: opts.cwd ?? work, encoding: 'utf8', timeout: opts.timeout })
  if (r.status !== 0) throw new Error(`dsh ${args.join(' ')} failed (${r.status ?? r.signal}):\n${r.stdout}\n${r.stderr}`)
  return r
}

const tail = (text, n = 800) => (text ?? '').slice(-n).trim() || '(empty)'

/** Seed `.learn/` through the product's own tools, so the eval exercises real data shapes. */
async function seed(cwd, s) {
  const env = { cwd, now: () => new Date(), userTexts: () => null }
  let material
  if (s.course.material) {
    writeFileSync(join(cwd, s.course.material.path), s.course.material.text)
    const imported = await ingestMaterial.execute({ path: s.course.material.path }, env)
    const id = /id=(m-[a-z0-9]+)/.exec(imported)[1]
    material = { id, sources: s.course.material.blocks.map((n) => `${id}#${n}`), invalidSource: `${id}#99`, case: s.materialCase.id }
  }
  await tools.courseSave.execute({
    goal: s.course.goal,
    status: 'active',
    learner: { background: s.course.background, preferOrder: 'unknown' },
    chapters: [{ title: s.course.kp.title, kps: [{ ...s.course.kp, ...(material ? { sources: material.sources } : {}) }, ...(s.course.basics ?? [])] }],
  }, env)
  await tools.kpDefineModels.execute({ kpId: s.course.kp.id, models: s.course.models }, env)
  if (s.repair || s.learningLoop || s.recovery || s.trust) {
    await tools.targetMapUpdate.execute({ kpId: s.course.kp.id, modelId: 'route', statement: s.statement }, { ...env, userTexts: () => [s.opening] })
    for (const phase of ['prescribe', 'build', 'verify']) await tools.kpSetPhase.execute({ kpId: s.course.kp.id, modelId: 'route', phase, reason: '验收前已完成规律构建' }, env)
  }
  return material
}

/** Messages endpoint, auth headers and model for the prescription judge. */
function judgeEndpoint() {
  if (opt.anthropic) {
    return {
      base: process.env.JUDGE_BASE_URL ?? process.env.ANTHROPIC_BASE_URL,
      headers: { authorization: `Bearer ${process.env.ANTHROPIC_AUTH_TOKEN}` },
      model: process.env.JUDGE_MODEL ?? process.env.ANTHROPIC_MODEL,
    }
  }
  return {
    base: process.env.JUDGE_BASE_URL ?? LLM_ENV.DEEPSEEK_BASE_URL ?? process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/anthropic',
    headers: { 'x-api-key': LLM_ENV.DEEPSEEK_API_KEY ?? process.env.DEEPSEEK_API_KEY },
    model: process.env.JUDGE_MODEL ?? 'deepseek-flash',
  }
}

/** The mock tutor's script for one scenario: show a quiz card, probe with a question, record the answer (with difficulty and confidence), then the expected diagnosis. */
function mockScript(s, material) {
  const kpId = s.course.kp.id
  const modelId = s.course.models[0].id
  if (material) {
    const sources = material.sources
    const prompt = material.case === 'unsupported-claim' ? s.course.material.unsupportedClaim : s.course.models[0].reference
    const question = '核心线程都忙，队列还有空位，新任务应该排队还是扩容？'
    return {
      pauseAfter: ['quiz_show'],
      checkerReply: material.case === 'unsupported-claim' ? `rule：不通过 —— 原文不支持这个说法；队列未满时应先排队。依据：${sources[0]}` : `rule：通过 —— 已核对原文中的排队和扩容条件。依据：${sources.join('、')}`,
      plan: [
        { name: 'material_search', input: { query: '核心 队列 扩容', materialId: material.id } },
        { name: 'material_read', input: { blocks: sources } },
        { name: 'checker', input: { description: '核对教材', prompt, sources } },
        ...(material.case === 'missing-block' ? [{ name: 'examiner', input: { description: '核对错引', prompt: '先核对这个引用是否存在。', sources: [material.invalidSource] } }] : []),
        { name: 'examiner', input: { description: '依据教材出题', prompt: `按原文出一道题，不沿用错误说法：${s.course.models[0].reference}`, sources } },
        { name: 'quiz_show', input: { ui: 'root = Quiz("任务去向", "predict", [Choice("新任务去哪里？", ["排队", "扩容"])])', question, sources } },
        { name: 'verification_record', input: { kpId, modelId, question, questionType: 'predict', answer: '排队', verdict: 'correct', difficulty: 2, confidence: 'unsure', sources, expected: { output: '排队' } } },
        { name: 'diagnosis_record', input: { kpId, modelId, findings: [{ type: s.expect.expect[0], evidence: '开始时不会把条件用到具体任务上' }], prescription: ['用具体情境对比队列未满和已满两个例子'] } },
      ],
    }
  }
  return {
    plan: 'learn_status,kp_get,quiz_show,ask_user_question,verification_record,diagnosis_record',
    inputs: {
      kp_get: { kpId },
      quiz_show: {
        ui: `root = Quiz("热身", "rephrase", [Rewrite("用你自己的话说说", "${s.course.kp.title}")])`,
        question: `用你自己的话说说「${s.course.kp.title}」是什么？`,
      },
      ask_user_question: { questions: [{ id: 'probe', question: `用你自己的话说说「${s.course.kp.title}」是什么？` }] },
      verification_record: {
        kpId, modelId, question: `用你自己的话说说「${s.course.kp.title}」是什么？`, questionType: 'scenario',
        answer: '我记得定义是这么说的，但换个说法我就不太确定了。', verdict: 'partial', difficulty: 2, confidence: 'unsure', attribution: s.expect.expect[0],
      },
      diagnosis_record: { kpId, modelId, findings: [{ type: s.expect.expect[0], evidence: '用户只能复述原句' }], prescription: [`换说法提问，准备${s.expect.prescriptionKeywords[0]}`] },
    },
  }
}

function readJsonl(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

const normalize = (t) => t.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')

const JUDGE_SYSTEM = [
  '你是教学处方评审。给定一种学习缺陷、对它的合格补救思路，以及导师实际开出的诊断和处方，判断处方是否对症。',
  '对症 = 处方里的教学动作能针对这种缺陷起作用（不要求措辞一致）；只写空话、只针对别的缺陷、或照搬原文让用户背，都算不对症。',
  '用户明确选了先看规律还是先看例子时，按用户的选择排顺序不算错；只看处方整体有没有补上这种缺陷（例如先讲规律，再让用户用规律判断新例子、用自己的话说规律，也能补上层丢失）。',
  '只输出一个 JSON 对象：{"fit": true|false, "reason": "一句话理由"}',
].join('\n')

/** LLM judge for one prescription. Returns { fit, reason, usage }. */
async function judgePrescription(s, findings, prescription) {
  const { base, headers, model } = judgeEndpoint()
  const content = [
    `缺陷：${s.expect.label}（${s.defect}）`,
    `合格补救思路：${s.expect.remedy}`,
    `导师的诊断：${findings.map((f) => `${f.type}：${f.evidence}`).join('；') || '（无）'}`,
    `导师的处方：${prescription || '（无）'}`,
  ].join('\n')
  const request = () => fetch(`${base.replace(/\/$/, '')}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', ...headers },
    body: JSON.stringify({ model, max_tokens: 2048, thinking: { type: 'disabled' }, system: JUDGE_SYSTEM, messages: [{ role: 'user', content }] }),
    signal: AbortSignal.timeout(120000),
  })
  // One retry on a network error: scenarios run long enough for a pooled keep-alive socket to go stale.
  const res = await request().catch((error) => (error instanceof TypeError ? request() : Promise.reject(error)))
  if (!res.ok) throw new Error(`judge LLM ${res.status}: ${await res.text()}`)
  const body = await res.json()
  const text = (body.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('')
  const verdict = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? 'null') ?? {}
  if (typeof verdict.fit !== 'boolean') throw new Error(`judge gave no verdict: ${text.slice(0, 200)}`)
  return { fit: verdict.fit, reason: String(verdict.reason ?? ''), usage: body.usage }
}

/** Token usage, steps, and tool calls from session events (the tutor's, or its subagents'). */
function collect(events) {
  const cost = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, llmSteps: 0, toolCalls: {}, statementRejected: 0 }
  for (const ev of events) {
    if (!ev) continue
    if (ev.type === 'step/start') cost.llmSteps++
    if (ev.type === 'tool/call') {
      const name = ev.data?.name ?? '?'
      cost.toolCalls[name] = (cost.toolCalls[name] ?? 0) + 1
    }
    if (ev.type === 'tool/result' && /statement rejected/.test(JSON.stringify(ev.data ?? ''))) cost.statementRejected++
    if (ev.type === 'assistant/message') {
      const u = ev.data?.usage
      if (u) {
        cost.inputTokens += u.inputTokens ?? 0
        cost.outputTokens += u.outputTokens ?? 0
        cost.cacheReadTokens += u.cacheReadTokens ?? u.cachedInputTokens ?? 0
        cost.cacheWriteTokens += u.cacheWriteTokens ?? 0
      }
    }
  }
  return cost
}

const textOf = (content) => (typeof content === 'string' ? content : (content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join(''))

/** Difficulty coverage, adherence to the suggested difficulty, and flow-channel zones, per model in order. */
function flowStats(verified) {
  const novel = verified.filter((v) => v.questionType !== 'recall')
  const zones = { easy: 0, flow: 0, hard: 0 }
  let followed = 0
  for (const list of Map.groupBy(novel, (v) => `${v.kpId}/${v.modelId}`).values()) {
    for (let i = 0; i < list.length; i++) {
      if (list[i].difficulty === staircase(list.slice(0, i)).level) followed++
      zones[staircase(list.slice(0, i + 1)).last.zone]++
    }
  }
  return { novel: novel.length, withDifficulty: novel.filter((v) => Number.isInteger(v.difficulty)).length, followed, zones, maxDifficulty: Math.max(0, ...novel.map((v) => v.difficulty ?? 0)) }
}

const NOT_PROBLEMS = new Set(['positive-transfer', 'prefers-examples', 'prefers-rules', 'on-track'])

async function score(s, ws, out, material) {
  const transcript = JSON.parse(readFileSync(join(out, 'transcript.json'), 'utf8'))
  if (transcript.error) throw new Error(`${transcript.stop}: ${transcript.error}`)
  if (!transcript.history.some((m) => m.who === 'tutor' && !m.silent)) throw new Error('the tutor never spoke')
  const events = readJsonl(join(out, 'events.jsonl'))
  const subEvents = readJsonl(join(out, 'subagent-events.jsonl'))
  const diagnoses = learnerEvents(ws, 'diagnoses').filter((d) => d.kpId === s.course.kp.id)
  const findings = diagnoses.flatMap((d) => d.findings)
  const found = [...new Set(findings.map((f) => f.type))]
  const prescription = diagnoses.flatMap((d) => d.prescription).join('；')
  const keywordHit = s.expect.prescriptionKeywords.some((k) => prescription.includes(k))
  // A failed judge call falls back to keywords instead of discarding the whole scenario.
  let judgeError
  const judge = diagnoses.length && !opt['no-judge']
    ? await judgePrescription(s, findings, prescription).catch((error) => { judgeError = error.message.slice(0, 500); return null })
    : null
  const kp = learnerDocument(ws, `kp/${s.course.kp.id}`)
  const learnerSaid = transcript.history.filter((m) => m.who === 'learner' && m.via !== 'ask_user_question').map((m) => normalize(m.text))
  const statements = kp.models.map((m) => m.targetMap.statement?.text).filter(Boolean)
  const ghostwritten = statements.filter((t) => !learnerSaid.some((said) => said.includes(normalize(t))))
  const learnerTurns = transcript.history.filter((m) => m.who === 'learner').length
  // The tutor may insert a prerequisite point and verify that instead, so count every point of the course.
  const course = learnerDocument(ws, 'course')
  const courseKps = new Set(course.chapters.flatMap((c) => c.kpIds))
  const verified = learnerEvents(ws, 'verifications').filter((v) => courseKps.has(v.kpId))
  return {
    id: s.id,
    defect: s.defect,
    stop: transcript.stop,
    diagnosed: diagnoses.length > 0,
    hit: found.some((t) => s.expect.expect.includes(t)),
    firstHit: s.expect.expect.includes(found[0]),
    found,
    // Problem types recorded beyond the expected one (strengths, preferences and on-track excluded).
    extraFindings: found.filter((t) => !s.expect.expect.includes(t) && !NOT_PROBLEMS.has(t)),
    prescriptionHit: judge ? judge.fit : keywordHit,
    prescriptionBy: judge ? 'judge' : 'keywords',
    prescriptionReason: judge?.reason,
    keywordHit,
    prescription,
    statements: statements.length,
    ghostwritten,
    learnerTurns,
    verifications: verified.length,
    kpVerifications: verified.filter((v) => v.kpId === s.course.kp.id).length,
    statementsByModel: Object.fromEntries(kp.models.map((m) => [m.id, Boolean(m.targetMap.statement?.text)])),
    phases: Object.fromEntries(kp.models.map((m) => [m.id, m.phase])),
    cost: collect(events),
    subagentCost: collect(subEvents),
    quiz: quizStats(events, subEvents),
    timing: practiceTiming(events),
    performance: performanceTiming(events, subEvents),
    material: materialStats(events, subEvents, verified, transcript.history, material),
    repair: s.repair ? scoreRepair(events, transcript.checkpoints ?? []) : undefined,
    learningLoop: s.learningLoop ? scoreLearningLoop(events, transcript.checkpoints ?? []) : undefined,
    recovery: s.recovery ? scoreRecovery(ws, events, transcript.history) : undefined,
    trust: s.trust ? scoreTrust(events, verified) : undefined,
    flow: flowStats(verified),
    judgeUsage: judge?.usage,
    judgeError,
  }
}

async function main() {
  console.error(`eval: ${scenarios.length} scenario(s), work dir ${work}`)
  run(['--profile', 'eval', '--from-default-profile', 'headless', '--dump-config'])
  run(['plugin', '--profile', 'eval', 'add', root])
  run(['plugin', '--profile', 'eval', 'add', join(here, 'driver')])

  let server
  if (opt.mock) {
    mkdirSync(join(work, 'requests'))
    server = spawn(process.execPath, [join(root, 'test/boot/mock-llm.mjs')], {
      env: { ...process.env, MOCK_OUT: join(work, 'requests'), MOCK_PORT, MOCK_CONFIG: join(work, 'mock.json') },
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    await new Promise((ok) => server.stdout.once('data', ok))
  }

  const results = []
  try {
    for (const s of scenarios) {
      const dir = join(work, s.id.replace('/', '__'))
      const ws = join(dir, 'ws')
      mkdirSync(ws, { recursive: true })
      const material = await seed(ws, s)
      const scenarioFile = join(dir, 'scenario.json')
      writeFileSync(scenarioFile, JSON.stringify({
        goal: s.course.goal,
        background: s.course.background,
        persona: s.persona,
        opening: s.opening ?? `我想${s.course.goal}。我是${s.course.background}。我们直接从「${s.course.kp.title}」开始吧。${material ? `教材在 ${s.course.material.path}，已导入为 ${material.id}。${s.materialCase.request}` : ''}`,
        repair: s.repair,
        learningLoop: s.learningLoop,
        recovery: s.recovery,
        trust: s.trust,
        answer: s.answer,
        followup: s.followup,
        maxTurns: Number(opt.turns ?? (s.recovery ? 2 : opt.until === 'verified' ? 16 + 3 * (verifications - 1) : 8)),
        until: s.repair || s.learningLoop || s.trust ? 'verified' : opt.until,
        verifications: s.learningLoop ? 2 : verifications,
      }))
      if (opt.mock) writeFileSync(join(work, 'mock.json'), JSON.stringify(mockScript(s, material)))
      const started = Date.now()
      try {
        if (opt.inspect) console.error(`  ${s.id}: waiting for a debugger on 127.0.0.1:${opt['inspect-port']} (chrome://inspect)`)
        const x = run(['--profile', 'eval', ...(opt['local-auth'] ? ['--patch', authPatch] : []), 'x'], {
          inspect: true,
          cwd: ws,
          timeout: 30 * 60 * 1000,
          env: { LA_EVAL_SCENARIO: scenarioFile, LA_EVAL_OUT: dir, ...LLM_ENV },
        })
        if (!existsSync(join(dir, 'transcript.json'))) {
          throw new Error(`dsh x exited 0 but produced no transcript (${join(dir, 'transcript.json')}); is the eval driver plugin loaded?\n` +
            `--- stdout (tail) ---\n${tail(x.stdout)}\n--- stderr (tail) ---\n${tail(x.stderr)}`)
        }
        const r = { ...(await score(s, ws, dir, material)), seconds: Math.round((Date.now() - started) / 1000) }
        results.push(r)
        console.error(`  ${(r.trust ? r.trust.passed : r.recovery ? r.recovery.passed : r.learningLoop ? r.learningLoop.passed : r.repair ? r.repair.passed : r.hit) ? '✓' : '✗'} ${s.id.padEnd(32)} found=[${r.found.join(',')}] rx=${r.prescriptionHit ? '✓' : '✗'} 代写=${r.ghostwritten.length} turns=${r.learnerTurns} ${r.seconds}s`)
      } catch (error) {
        results.push({ id: s.id, defect: s.defect, error: String(error.message ?? error).slice(0, 2000) })
        console.error(`  ! ${s.id}: ${String(error.message ?? error).split('\n')[0]}`)
      }
    }
  } finally {
    server?.kill()
  }

  const ok = results.filter((r) => !r.error)
  const rate = (f) => (ok.length ? Math.round((ok.filter(f).length / ok.length) * 100) : 0)
  const sum = (f) => ok.reduce((n, r) => n + f(r), 0)
  // dsh reports uncached input apart from cache reads/writes; count all of them, so totals stay
  // comparable between runs with and without prompt caching.
  const tokens = (c) => c.inputTokens + c.cacheReadTokens + c.cacheWriteTokens + c.outputTokens
  const avg = (f) => (ok.length ? Math.round(sum(f) / ok.length) : 0)
  const firstQuizTimes = ok.map((r) => r.timing.firstQuizMs).filter((v) => v !== null)
  const feedbackTimes = ok.flatMap((r) => r.timing.questions).map((q) => q.feedbackMs).filter((v) => v !== null)
  const mean = (values) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null
  const summary = {
    scenarios: results.length,
    errors: results.length - ok.length,
    diagnosisHitRate: rate((r) => r.hit),
    firstFindingHitRate: rate((r) => r.firstHit),
    verifiedRate: rate((r) => r.verifications > 0),
    avgExtraFindings: ok.length ? Math.round((sum((r) => r.extraFindings.length) / ok.length) * 10) / 10 : 0,
    prescriptionHitRate: rate((r) => r.prescriptionHit),
    ghostwriteViolations: sum((r) => r.ghostwritten.length),
    statementRejections: sum((r) => r.cost.statementRejected),
    prescriptionJudgeKeywordAgreement: rate((r) => r.prescriptionBy !== 'judge' || r.prescriptionHit === r.keywordHit),
    avgTokensPerScenario: avg((r) => tokens(r.cost)),
    avgSubagentTokensPerScenario: avg((r) => tokens(r.subagentCost)),
    avgCacheReadTokensPerScenario: avg((r) => r.cost.cacheReadTokens + r.subagentCost.cacheReadTokens),
    avgCacheWriteTokensPerScenario: avg((r) => r.cost.cacheWriteTokens + r.subagentCost.cacheWriteTokens),
    avgWebSearches: ok.length ? sum((r) => r.cost.toolCalls.web_search ?? 0) / ok.length : 0,
    quizShown: sum((r) => r.quiz.shown),
    // Rendered share of quiz_show calls (null: no quiz was attempted).
    quizParseRate: sum((r) => r.quiz.calls) ? Math.round((sum((r) => r.quiz.shown) / sum((r) => r.quiz.calls)) * 100) : null,
    examinerQuizBlocks: sum((r) => r.quiz.examinerBlocks),
    quizLeaks: sum((r) => r.quiz.leaks.length),
    // Of the novel-question records: tagged with a difficulty, asked at the staircase's suggestion, landed in the flow zone.
    difficultyRecordedRate: sum((r) => r.flow.novel) ? Math.round((sum((r) => r.flow.withDifficulty) / sum((r) => r.flow.novel)) * 100) : null,
    difficultyFollowedRate: sum((r) => r.flow.novel) ? Math.round((sum((r) => r.flow.followed) / sum((r) => r.flow.novel)) * 100) : null,
    flowZoneShare: sum((r) => r.flow.zones.easy + r.flow.zones.flow + r.flow.zones.hard)
      ? Math.round((sum((r) => r.flow.zones.flow) / sum((r) => r.flow.zones.easy + r.flow.zones.flow + r.flow.zones.hard)) * 100) : null,
    avgLearnerTurns: ok.length ? sum((r) => r.learnerTurns) / ok.length : 0,
    avgFirstQuizMs: mean(firstQuizTimes),
    avgSubmissionToFeedbackMs: mean(feedbackTimes),
    byDefect: Object.fromEntries(Object.keys(spec.defects).map((d) => {
      const rs = ok.filter((r) => r.defect === d)
      return [d, `${rs.filter((r) => r.hit).length}/${rs.length}`]
    })),
  }
  const resultsDir = join(here, 'results')
  mkdirSync(resultsDir, { recursive: true })
  const file = join(resultsDir, `${new Date().toISOString().replace(/[:.]/g, '-')}${opt.mock ? '-mock' : opt.anthropic ? '-anthropic' : ''}.json`)
  const failures = failuresOf(results)
  writeFileSync(file, JSON.stringify({ mock: opt.mock, localAuth: opt['local-auth'], anthropic: opt.anthropic ? process.env.ANTHROPIC_MODEL : undefined, until: opt.until, verifications, summary, failures, results }, null, 2))
  console.log(JSON.stringify(summary, null, 2))
  console.error(`eval: results in ${file}${opt.keep || opt.mock ? `; sessions in ${work}` : ''}`)
  if (opt.mock) {
    const requests = readdirSync(join(work, 'requests')).length
    console.error(`eval: mock served ${requests} requests`)
  }
  for (const failure of failures) console.error(`eval: FAIL ${failure}`)
  if (failures.length) process.exitCode = 1
}

await main()
