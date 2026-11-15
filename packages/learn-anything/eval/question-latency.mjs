#!/usr/bin/env node
// Direct examiner benchmark; no learner session, local credential discovery or semantic judge.
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
import { checkQuiz, quizLanguageSection } from '../src/host/quiz.js'
import { EXAMINER_EFFORT } from '../src/host/delegates.js'
import { examinerSections } from './sections.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const options = { runs: 1, case: 'order', prompt: 'current', thinking: 'enabled', reasoning: EXAMINER_EFFORT, maxTokens: 256000 }
const flags = { '--runs': 'runs', '--case': 'case', '--prompt': 'prompt', '--thinking': 'thinking', '--reasoning': 'reasoning', '--max-tokens': 'maxTokens', '--model': 'model', '--base-url': 'base', '--system-file': 'systemFile' }
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i]
  if (flag === '--help' || flag === '-h') {
    console.log('DEEPSEEK_API_KEY=... node eval/question-latency.mjs [--runs N] [--case order|spot|counterexample|minimal-change|dual-predict|transfer] [--prompt baseline|current] [--thinking enabled|disabled] [--reasoning off|low|high|max] [--max-tokens N] [--model NAME] [--base-url URL] [--system-file FILE]\n--self-check runs offline mock validation only. Baseline defaults to eval/results/question-latency-baseline.txt (full system prompt). Results: eval/results/question-latency-*.json. Semantic correctness requires human review.')
    process.exit(0)
  }
  if (flag === '--self-check') { options.selfCheck = true; continue }
  if (!flags[flag] || !process.argv[i + 1] || process.argv[i + 1].startsWith('--')) throw new Error(`unknown or missing option: ${flag}`)
  options[flags[flag]] = process.argv[++i]
}
options.runs = Number(options.runs)
options.maxTokens = Number(options.maxTokens)
if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 100) throw new Error('--runs must be 1..100')
if (!Number.isInteger(options.maxTokens) || options.maxTokens < 1) throw new Error('--max-tokens must be a positive integer')
if (!['order', 'spot', 'counterexample', 'minimal-change', 'dual-predict', 'transfer'].includes(options.case) || !['baseline', 'current'].includes(options.prompt) || !['enabled', 'disabled'].includes(options.thinking) || !['off', 'low', 'high', 'max'].includes(options.reasoning)) throw new Error('invalid --case, --prompt, --thinking or --reasoning')

if (options.reasoning === 'off') options.thinking = 'disabled'

const tasks = {
  order: '请出一道 FIFO 队列的 OrderSteps 排序题，难度 2。模型：队列先进先出，入队发生在队尾，出队发生在队首。学习者表述：先排进去的先出来。旧例：食堂排队、任务 A/B/C；本题避开这些情境。给定一个新的具体情境，把操作步骤打乱；必须只有唯一正确顺序，逐一验证每个操作后的队列状态，标准答案写出顺序和状态以供人工核对。题面与互动组件都不能透露正确顺序。无教材依据。',
  spot: '请出一道 FIFO 队列的 SpotError 找茬题，难度 2。模型：队列先进先出，入队发生在队尾，出队发生在队首。学习者表述：先排进去的先出来。旧例：食堂排队、任务 A/B/C；本题避开这些情境。给三至四行简短的操作描述或伪代码，恰好一行关键错误，请学习者选中并修正。标准答案说明错误行、修正方法和执行结果，供人工核对；题面不暗示错误位置。无教材依据。',
  counterexample: '请用 Counterexample 出一道反例侦探，questionType=discriminate-neg，难度2。目标是辨清“缓存命中”和“数据仍然新鲜”。规律：缓存保存的是某一时刻的副本，是否新鲜取决于源数据是否改变、是否完成失效或更新；命中本身不保证新鲜。学习者表述：“拿到缓存只能说明有副本，不能保证副本跟现在一样。”旧例是浏览器头像，本题换实质不同的具体情境。给一个过度概括的说法和3个条件完整的新案例，恰好一个足以推翻说法，要求选择并说明缺失条件。标准答案与理由只在私有判分部分，无教材依据。',
  'minimal-change': '请用 MinimalChange 出一道最小改动题，questionType=scenario，难度2。规律：有空闲核心线程就执行；核心线程都忙而队列未满就排队；队列满且线程数低于max则扩容；线程数与队列都达上限则拒绝。学习者表述：“先用核心，再排队，排满才加人，全满拒绝。”旧例是餐厅，本题用新具体情境。提供完整初始状态和3至5条可编辑条件，让学习者只改其中一条，使新任务进入等待队列而不是直接执行或拒绝，并解释，其余条件保持。允许多种符合规律的单条件解，私有判分逐一说明接受范围。无需追求数值全局最优。标准答案不进入互动，无教材依据。',
  'dual-predict': '请用 DualPredict 出一道双局预测题，questionType=predict，难度2。规律：核心线程都忙时先排队，队列满且线程数小于max才新建线程，二者都满才拒绝。学习者表述：“排满以后才考虑加线程。”具体情境自拟，旧例餐厅不复用。两局共享核心数2、最大数4、两线程都忙、队列容量2，仅改变当前等待任务数：局一1个，局二2个，然后各来一个新任务。同一组选项让用户分别预测任务去向并说明差异，所有必要条件写在卡片内，结果只在私有标准答案，无教材依据。',
  transfer: '请用 TransferTask 出一道短迁移任务，questionType=transfer，难度3。目标规律：做当前决策时比较从现在起的新增代价与收益，已经付出且无法收回的代价不影响两种后续方案的比较。学习者原话：“已经花掉的拿不回来，选接下来更合适的路。”旧例是已经买票的电影要不要继续看，现换成技术操作中的时间决策。请围绕一份尚未下载完的文件构造新场景：只选继续当前下载或换到备用服务器重新下载，给出两种方案从现在起的预计剩余时间、必要限制和已经耗费的时间；文件内容相同、时间估计可靠、一次只能选择一种方案。目标只是尽早拿到完整文件，让用户给出一个决策与适用理由，避免组合优化和额外算费。私有标准答案说明为何过去耗时不决定当前选择，题卡不直接写结论，无教材依据。',
}

function extract(text) {
  const sections = Object.fromEntries(examinerSections(text))
  const ui = /```openui-lang\s*\n([\s\S]*?)```/u.exec(sections['互动'] ?? '')?.[1]?.trim() ?? null
  return { question: sections['题目'] ?? null, standardAnswer: sections['标准答案'] ?? null, grading: sections['判分要点'] ?? null, ui, openuiErrors: ui ? checkQuiz(ui) : ['missing fenced 【互动】 program'], semanticStatus: 'needs-human-review' }
}

async function request(fetcher, { endpoint, key, model, system }) {
  const start = performance.now()
  const response = await fetcher(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': key },
    body: JSON.stringify({ model, max_tokens: options.maxTokens, thinking: { type: options.thinking }, ...(options.thinking === 'enabled' ? { output_config: { effort: options.reasoning } } : {}), system, messages: [{ role: 'user', content: tasks[options.case] }] }),
    signal: AbortSignal.timeout(300000),
  })
  if (!response.ok) throw new Error(`Messages API HTTP ${response.status}`)
  const body = await response.json()
  const elapsedMs = Math.round(performance.now() - start)
  const text = (body.content ?? []).filter((block) => block.type === 'text').map((block) => block.text).join('')
  const reasoningText = (body.content ?? []).filter((block) => block.type === 'thinking').map((block) => block.thinking).join('')
  const parsed = extract(text)
  const structurallyValid = body.stop_reason === 'end_turn' && Boolean(parsed.question && parsed.standardAnswer) && parsed.openuiErrors.length === 0
  return { elapsedMs, structurallyValid, stopReason: body.stop_reason ?? null, outputTokens: body.usage?.output_tokens ?? null, reasoningTokens: body.usage?.reasoning_tokens ?? body.usage?.output_tokens_details?.reasoning_tokens ?? null, usage: body.usage ?? {}, reasoningCharacters: reasoningText.length, text, ...parsed }
}

if (options.selfCheck) {
  const sample = '【题目】排列流程\n【标准答案】先入后出\n【判分要点】按 FIFO\n【互动】\n```openui-lang\nroot = Quiz("流程", "scenario", [OrderSteps("排列", ["第二步", "第一步"])], 2)\n```'
  const result = await request(async (_url, init) => {
    assert.equal(JSON.parse(init.body).thinking.type, options.thinking)
    return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '核对过程' }, { type: 'text', text: sample }], usage: { output_tokens: 23, reasoning_tokens: 7 } }))
  }, { endpoint: 'https://example.invalid/v1/messages', key: 'mock-not-a-credential', model: 'mock', system: 'mock' })
  assert.equal(result.question, '排列流程')
  assert.equal(result.standardAnswer, '先入后出')
  assert.deepEqual(result.openuiErrors, [])
  assert.equal(result.reasoningTokens, 7)
  assert.equal(result.structurallyValid, true)
  const truncated = await request(async () => new Response(JSON.stringify({ stop_reason: 'max_tokens', content: [{ type: 'text', text: sample }] })), {})
  assert.equal(truncated.structurallyValid, false)
  assert.equal(result.semanticStatus, 'needs-human-review')
  const markdown = extract('## 【题目】\n判断一个新场景\n## 【标准答案】\n略\n## 【判分要点】\n按【判定】记录，引用【依据】。\n## 【互动】\n```openui-lang\nroot = Quiz("场景", "scenario", [Reason("为什么？")])\n```')
  assert.equal(markdown.grading, '按【判定】记录，引用【依据】。')
  assert.deepEqual(markdown.openuiErrors, [])
  assert.ok(extract('没有互动块').openuiErrors.length)
  await assert.rejects(request(async () => new Response('', { status: 429 }), {}), /HTTP 429/)
  console.log('Offline self-check passed; no API calls made.')
  process.exit(0)
}

const key = process.env.DEEPSEEK_API_KEY
if (!key) throw new Error('Set DEEPSEEK_API_KEY explicitly; no local credentials are read')
const base = options.base ?? process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/anthropic'
const endpoint = new URL(base.replace(/\/$/u, '') + '/v1/messages')
if (endpoint.username || endpoint.password) throw new Error('Use a base URL without embedded credentials')
const model = options.model ?? process.env.DEEPSEEK_MODEL ?? 'deepseek-flash'
const system = options.systemFile || options.prompt === 'baseline'
  ? await readFile(resolve(options.systemFile ?? join(root, 'eval/results/question-latency-baseline.txt')), 'utf8')
  : await readFile(join(root, 'prompts/examiner.md'), 'utf8') + '\n\n' + quizLanguageSection()
const resultFile = join(root, 'eval/results', `question-latency-${new Date().toISOString().replace(/[:.]/gu, '-')}-${process.pid}.json`)
const report = { at: new Date().toISOString(), model, endpoint: endpoint.origin + endpoint.pathname, case: options.case, prompt: options.prompt, thinking: options.thinking, reasoning: options.reasoning, maxTokens: options.maxTokens, runs: options.runs, system, task: tasks[options.case], semanticStatus: 'needs-human-review', results: [] }
await mkdir(join(root, 'eval/results'), { recursive: true })
for (let run = 1; run <= options.runs; run++) {
  try {
    const result = await request(fetch, { endpoint, key, model, system })
    report.results.push({ run, ...result })
    if (!result.structurallyValid) process.exitCode = 1
    console.log(JSON.stringify({ run, structurallyValid: result.structurallyValid, elapsedMs: result.elapsedMs, outputTokens: result.outputTokens, reasoningTokens: result.reasoningTokens, openuiErrors: result.openuiErrors, stopReason: result.stopReason, semanticStatus: result.semanticStatus }))
  } catch (error) {
    report.results.push({ run, error: String(error.message).split(key).join('[redacted]') })
    process.exitCode = 1
    console.error(`Run ${run} failed; see result file.`)
  }
  await writeFile(resultFile, JSON.stringify(report, null, 2) + '\n')
}
console.log(`Results: ${resultFile}\nreasoningTokens=null means the API did not report a separate count. Check question, standardAnswer and ui manually; syntax validity is not semantic correctness.`)
