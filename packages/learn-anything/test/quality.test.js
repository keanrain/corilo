import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { rm } from 'node:fs/promises'
import { dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { QUALITY_CASES } from '../eval/quality-cases.js'
import { qualityPrompt, scoreQuality, runQuality } from '../eval/quality.js'
import { checkQuiz } from '../src/host/quiz.js'

test('eight fixed quality fixtures pass structural checks and their offline response contracts', () => {
  assert.equal(QUALITY_CASES.length, 8)
  assert.equal(new Set(QUALITY_CASES.map((c) => c.id)).size, 8)
  for (const c of QUALITY_CASES) {
    assert.deepEqual(checkQuiz(c.ui), [], c.id)
    assert.deepEqual(scoreQuality(c, c.sample).failures, [], c.id)
    for (const wrap of ['**', '__']) assert.deepEqual(scoreQuality(c, c.sample.replace(/^(【[^】]+】)/gm, `${wrap}$1${wrap}`)).failures, [], `${c.id}: formatted headings`)
    const prompt = qualityPrompt(c)
    assert.ok(prompt.includes(c.answer))
    assert.ok(prompt.includes(c.ui))
    assert.ok(!prompt.includes(c.sample), 'offline expected responses must not reach the model')
    assert.ok(!prompt.includes(c.title) && !prompt.includes(c.id), 'case labels can reveal the expected verdict')
    assert.ok(!prompt.includes('mentions') && !prompt.includes('forbidden'))
  }
})

test('known grading regressions fail instead of being averaged away', () => {
  const find = (id) => QUALITY_CASES.find((c) => c.id === id)
  for (const c of QUALITY_CASES) assert.ok(scoreQuality(c, '').failures.length, c.id)
  const missing = find('missing-card-rule')
  assert.ok(scoreQuality(missing, missing.sample + '\n【判定】wrong').failures.length)
  assert.ok(scoreQuality(missing, missing.sample + '\n【归因】missing-prereq').failures.length)
  const deadline = find('unsupported-deadline')
  assert.deepEqual(scoreQuality(deadline, '【暂缓判定】缺少贴卡和配送所需时长，无法保证代包取回后的时间窗足够完成交付。').failures, [])
  assert.ok(scoreQuality(deadline, '【暂缓判定】题面有问题，先补齐信息。').failures.length, 'a vague deferral still misses the known gap')
  const alternative = find('alternative-solution')
  assert.ok(scoreQuality(alternative, alternative.sample.replace('correct', 'wrong')).failures.length)
  const partial = find('right-choice-wrong-reason')
  assert.ok(scoreQuality(partial, partial.sample.replace('partial', 'correct')).failures.length)
  assert.deepEqual(scoreQuality(partial, partial.sample.replace('【能否说清规律】', '这违背「队满才加人」的参考规律。\n【能否说清规律】')).failures, [])
  const evidence = find('grounded-feedback')
  const quoted = (quote) => evidence.sample.replace('改去备用就把前面40分钟白等了', quote)
  assert.deepEqual(scoreQuality(evidence, quoted('都已经等了40分钟……改去备用就把前面40分钟白等了')).failures, [])
  assert.ok(scoreQuality(evidence, quoted('改去备用就把前面40分钟白等了……都已经等了40分钟')).failures.length)
  assert.ok(scoreQuality(evidence, quoted('……')).failures.length)
  assert.ok(scoreQuality(evidence, evidence.sample.replace('改去备用就把前面40分钟白等了', '26比20小')).failures.length)
  assert.ok(scoreQuality(evidence, evidence.sample + '\n他把26和20的大小关系读反了。').failures.length)
})

test('quality requests use the production examiner and fail on HTTP errors or truncated output', async () => {
  const c = QUALITY_CASES.find((c) => c.id === 'alternative-solution')
  const route = { base: 'https://example.invalid', headers: { authorization: 'Bearer test-only' }, model: 'test' }
  const run = (fetcher) => runQuality({ only: c.id, route, fetcher })
  const passed = await run(async (_url, init) => {
    const request = JSON.parse(init.body)
    assert.ok(request.system.includes('你是「考官」'))
    assert.equal(request.messages[0].content, qualityPrompt(c))
    return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: c.sample }] }))
  })
  assert.equal(passed.summary.passed, 1)
  const rejected = await run(async () => new Response('', { status: 429 }))
  assert.equal(rejected.summary.errors, 1)
  assert.equal(rejected.summary.failed, 0, 'request errors are not semantic failures')
  const truncated = await run(async () => new Response(JSON.stringify({ stop_reason: 'max_tokens', content: [{ type: 'text', text: c.sample }] })))
  assert.equal(truncated.summary.errors, 1)
  await assert.rejects(runQuality({ mock: true, only: 'not-a-case' }), /no quality cases/)
})

test('the quality CLI exits nonzero for a grading regression', { timeout: 15000 }, async () => {
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: '【判定】wrong\n【能否说清规律】否' }] }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  let output = ''
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    const child = spawn(process.execPath, ['eval/run.mjs', '--quality', '--only', 'correct-control'], {
      env: { ...process.env, DEEPSEEK_API_KEY: 'test-only', DEEPSEEK_BASE_URL: base, JUDGE_BASE_URL: base, JUDGE_MODEL: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    const [code] = await once(child, 'close')
    assert.equal(code, 1, output)
    assert.match(output, /"failed":1/)
    assert.match(output, /预期correct，实际wrong/)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    const report = /eval: results in ([^\r\n]+)/.exec(output)?.[1]
    const resultsDir = fileURLToPath(new URL('../eval/results/', import.meta.url)).replace(/\/$/, '')
    if (report && dirname(report) === resultsDir && /^quality-.*\.json$/.test(basename(report))) await rm(report)
  }
})
