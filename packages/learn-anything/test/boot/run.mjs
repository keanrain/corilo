#!/usr/bin/env node
// Boot check: compose the bundle in a throwaway DSH_HOME, drive one session
// under the learn-tutor preset against a mock LLM, and assert what the model
// would see — tools, persona, methodology section, skill catalog, and the
// examiner subagent's preset (persona, read-only tools) and its synchronous result.
//
//   LEARN_ANYTHING_DSH=<path to dsh lib/bin.js> node test/boot/run.mjs
import { spawn, spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Keep the runtime gate aligned with package.json engines.
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number)
if (nodeMajor < 24 || (nodeMajor === 24 && nodeMinor < 9)) {
  console.error(`boot: dsh needs Node.js >= 24.9, this is ${process.versions.node}`)
  process.exit(2)
}

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const dshBin = process.env.LEARN_ANYTHING_DSH
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const dsh = dshBin ? [process.execPath, dshBin] : ['npx', '-y', `@deepseek-ai/dsh@${pkg.engines.dsh}`]
const work = mkdtempSync(join(tmpdir(), 'la-boot-'))
const env = { ...process.env, DSH_HOME: join(work, 'home'), MOCK_OUT: join(work, 'requests'), MOCK_PORT: process.env.MOCK_PORT ?? '18799' }
mkdirSync(env.MOCK_OUT)
mkdirSync(join(work, 'ws'))

function run(args, opts = {}) {
  const r = spawnSync(dsh[0], [...dsh.slice(1), ...args], { env: { ...env, ...opts.env }, cwd: opts.cwd ?? work, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`dsh ${args.join(' ')} failed:\n${r.stdout}\n${r.stderr}`)
  return r.stderr
}

run(['--profile', 'boot', '--from-default-profile', 'headless', '--dump-config'])
run(['plugin', '--profile', 'boot', 'add', root])
run(['plugin', '--profile', 'boot', 'add', join(here, 'driver')])

// The tutor tries to write the learning record directly (the guard must refuse), then calls the examiner.
const MOCK_PLAN = 'learn_status,write,examiner'
const MOCK_INPUTS = JSON.stringify({ write: { file_path: '.learn/course.json', content: '{}' } })
const mock = spawn(process.execPath, [join(here, 'mock-llm.mjs')], { env: { ...env, MOCK_PLAN, MOCK_INPUTS }, stdio: ['ignore', 'pipe', 'inherit'] })
await new Promise((ok) => mock.stdout.once('data', ok))
let log
try {
  log = run(['--profile', 'boot', 'x'], {
    cwd: join(work, 'ws'),
    env: { DEEPSEEK_API_KEY: 'sk-test', DEEPSEEK_BASE_URL: `http://127.0.0.1:${env.MOCK_PORT}`, DSH_PERMISSION_MODE: 'danger-full-access' },
  })
} finally {
  mock.kill()
}

const requests = readdirSync(env.MOCK_OUT).sort().map((f) => JSON.parse(readFileSync(join(env.MOCK_OUT, f), 'utf8')))
const tutor = requests.filter((r) => /学习导师/.test(r.system ?? ''))
const examiner = requests.filter((r) => /判分要点/.test(r.system ?? '') && !/学习导师/.test(r.system ?? ''))
const names = (r) => (r.tools ?? []).map((t) => t.name)

assert.match(log, /default preset = learn-tutor/)
assert.match(log, /native reminder create\/pause\/restore\/delete passed/)
assert.match(log, /native timer delivery\/paused\/exactly-once passed/)
assert.ok(tutor.some((request) => JSON.stringify(request.messages).includes('boot-only scheduled reminder')), 'the due reminder reaches a real model request')
assert.ok(!requests.some((request) => JSON.stringify(request.messages).includes('boot-only paused reminder')), 'paused reminders never reach the model')
assert.ok(tutor.length >= 2, 'tutor requests recorded')
for (const tool of ['learn_status', 'course_save', 'kp_get', 'target_map_update', 'verification_record', 'diagnosis_record',
  'ingest_material', 'material_read', 'material_search', 'review_due', 'progress_get', 'examiner', 'checker', 'web_search', 'ask_user_question', 'quiz_show', 'flashcard_show', 'mistakes_get']) {
  assert.ok(names(tutor[0]).includes(tool), `tutor has ${tool}`)
}
for (const dropped of ['bash', 'workflow', 'subagent', 'subagent_fork', 'todo_write', 'create_goal', 'job_list', 'send_message']) {
  assert.ok(!names(tutor[0]).includes(dropped), `tutor lacks coding-agent tool ${dropped}`)
}
assert.match(tutor[0].system, /渐构/, 'methodology section present')
const firstTurn = JSON.stringify(tutor[0].messages)
for (const skill of ['plan-course', 'describe-knowledge', 'diagnose', 'make-materials', 'coach-statements', 'examine']) {
  assert.ok(firstTurn.includes(skill), `skill catalog lists ${skill}`)
}
assert.match(JSON.stringify(tutor[1].messages.at(-1)), /尚无课程/, 'learn_status ran against an empty workspace')
assert.match(JSON.stringify(tutor[2].messages.at(-1)), /holds the learning record/, 'write into .learn/ is refused')
assert.ok(!existsSync(join(work, 'ws', '.learn', 'course.json')), 'no course written behind the tools')
// Stats for the Web composer chip ride the tool result's meta (logged), never the model's messages.
const logged = requests.flatMap((r) => r.dsh_session_log?.events ?? [])
assert.ok(logged.some((e) => e.type === 'tool/result' && e.data.meta?.learnStats === null), 'learn_status logs learnStats meta (null: no course)')
assert.ok(!requests.some((r) => JSON.stringify(r.messages).includes('learnStats')), 'learnStats stays out of model input')
assert.equal(examiner.length, 1, 'examiner subagent called once')
assert.equal(examiner[0].thinking?.type, 'enabled', 'examiner keeps reasoning enabled')
assert.equal(examiner[0].output_config?.effort, 'low', 'examiner effort reaches the real provider request')
const exTools = names(examiner[0])
for (const forbidden of ['course_save', 'target_map_update', 'verification_record', 'quiz_show', 'flashcard_show', 'write', 'edit', 'bash']) {
  assert.ok(!exTools.includes(forbidden), `examiner lacks ${forbidden}`)
}
assert.ok(exTools.includes('kp_get') && exTools.includes('material_search'), 'examiner can read')
assert.match(examiner[0].system, /## 互动题（【互动】）[\s\S]*Pick\(/, 'examiner gets the quiz-card language section')
assert.doesNotMatch(tutor[0].system, /openui-lang/, 'the tutor does not')
assert.ok(tutor.some((request) => /tool_result.*示例题/.test(JSON.stringify(request.messages.at(-1)))), 'the examiner\'s reply returns to the tutor as the tool result, in the same turn')
console.log(`boot check passed (${requests.length} LLM requests; tutor tools ${names(tutor[0]).length}, examiner tools ${exTools.length})`)
writeFileSync(join(work, 'summary.txt'), log)
