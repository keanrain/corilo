// Eval driver: run one tutoring scenario under the learn-tutor preset against
// a simulated learner, then dump the session for eval/run.mjs to score.
//
// Env:
//   LA_EVAL_SCENARIO   JSON file: { opening, persona, background, maxTurns, until }
//                      until: 'diagnosed' (default) stops at the first diagnosis, 'verified' at the
//                      first recorded verification (exercises examiner, statements, the later phases);
//                      with `verifications: N` it runs on until N are recorded (the practice run)
//   LA_EVAL_OUT        directory for events.jsonl, subagent-events.jsonl and transcript.json
//   LEARNER_BASE_URL   Anthropic Messages endpoint for the learner (default $DEEPSEEK_BASE_URL or DeepSeek's)
//   LEARNER_MODEL      learner model (default deepseek-flash)
//   LA_EVAL_ANTHROPIC  set: tutor and learner run on $ANTHROPIC_BASE_URL / $ANTHROPIC_MODEL with
//                      `Authorization: Bearer $ANTHROPIC_AUTH_TOKEN` (an Anthropic-compatible gateway)
//   LA_EVAL_PROMPT_CACHE=1  with LA_EVAL_ANTHROPIC: ask the gateway for prompt caching (off by default:
//                           the internal gateway's cache hits are random and cost more than they save)
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { catalogModelInfo, registerDeepSeekProvider, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { quizText } from '../../src/host/quiz.js'
import { HELP_PREFIX, formatQuizAnswer } from '../../src/quiz/answer.js'
import { parseView } from '../../src/host/render.js'
import { REPAIR_FIXTURE, REPAIR_CHALLENGE, repairState } from '../repair.js'
import { learningState } from '../learning-loop.js'

export const name = 'la-eval-driver'
export const inject = ['agentDefaultModel', 'agents', 'sessions', 'agentPresets', 'llm']

const END = '[结束]'
const ANTHROPIC = 'eval-anthropic'
const anthropic = Boolean(process.env.LA_EVAL_ANTHROPIC)

/**
 * The gateway speaks the same Messages protocol as DeepSeek, so it is one more route of dsh's own
 * Messages adapter: only the endpoint, the bearer auth, the output cap and the model catalog differ.
 */
function registerAnthropic(ctx) {
  const options = () => resolveAdapterOptions({
    baseURL: process.env.ANTHROPIC_BASE_URL,
    maxTokens: Number(process.env.ANTHROPIC_MAX_TOKENS ?? 32000),
    models: [{ id: process.env.ANTHROPIC_MODEL, contextWindow: 200000 }],
  })
  registerDeepSeekProvider(ctx, ANTHROPIC, {
    options,
    providerName: 'Anthropic gateway',
    resolveAuth: async () => ({ headers: { authorization: `Bearer ${process.env.ANTHROPIC_AUTH_TOKEN}` } }),
    discoverModels: (provider) => Promise.resolve(options().models.map((m) => catalogModelInfo(provider, m))),
  })
  // Prompt caching: DeepSeek caches prefixes on its own, Anthropic only when asked. The top-level
  // `cache_control` field (automatic caching) marks the request's last cacheable block, so each
  // tutor/subagent step can read the previous step's prefix. Contributed through dsh's request-extension
  // registry; requests for any other model (another route) are left alone.
  if (process.env.LA_EVAL_PROMPT_CACHE !== '1') return
  ctx.inject(['deepseekLlmApiExtensions'], (child) => {
    child.deepseekLlmApiExtensions.register('cache_control', {
      prepare: ({ body }) => (body.model === process.env.ANTHROPIC_MODEL ? { value: { type: 'ephemeral' } } : undefined),
    })
  })
}

/** Messages endpoint, auth headers and model for the simulated learner. */
function learnerEndpoint() {
  if (anthropic) {
    return {
      base: process.env.ANTHROPIC_BASE_URL,
      headers: { authorization: `Bearer ${process.env.ANTHROPIC_AUTH_TOKEN}` },
      model: process.env.LEARNER_MODEL ?? process.env.ANTHROPIC_MODEL,
    }
  }
  return {
    base: process.env.LEARNER_BASE_URL ?? process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/anthropic',
    headers: { 'x-api-key': process.env.DEEPSEEK_API_KEY ?? '' },
    model: process.env.LEARNER_MODEL ?? 'deepseek-flash',
  }
}

function learnerSystem(s) {
  return [
    '你在扮演一名学习者，和一位 AI 学习导师对话。你不是助手，不要帮导师总结或出题。',
    `学习目标：${s.goal}`,
    `背景：${s.background}`,
    `你的认知特点（必须始终按此表现，不要主动说出这些特点，也不要突然“开窍”，除非导师用了针对性的方法并且你确实被说服）：\n${s.persona}`,
    '回答要像真实的学习者：口语化，一般 1～3 句话；不懂就说不懂；被要求用自己的话说时，用你自己的（可能有缺陷的）理解来说。',
    `如果导师明确表示本次学习告一段落，只回复 ${END}。`,
  ].join('\n\n')
}

async function learnerReply(s, history) {
  const { base, headers, model } = learnerEndpoint()
  // Learner sees the tutor as `user` and speaks as `assistant`; merge same-role runs.
  // Callers only ask for a reply right after a tutor message, so the request never ends on `assistant` (prefill).
  const messages = []
  for (const m of history) {
    const role = m.who === 'tutor' ? 'user' : 'assistant'
    if (messages.at(-1)?.role === role) messages.at(-1).content += '\n\n' + m.text
    else messages.push({ role, content: m.text })
  }
  if (messages[0]?.role !== 'user') messages.unshift({ role: 'user', content: '（导师已上线）' })
  const res = await fetch(`${base.replace(/\/$/, '')}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', ...headers },
    body: JSON.stringify({ model, max_tokens: 1024, system: learnerSystem(s), messages }),
    signal: AbortSignal.timeout(120000),
  })
  if (!res.ok) throw new Error(`learner LLM ${res.status}: ${await res.text()}`)
  const body = await res.json()
  return {
    text: (body.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim(),
    usage: body.usage,
  }
}

function textOf(content) {
  if (typeof content === 'string') return content
  return (content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('')
}

export function apply(ctx) {
  if (anthropic) registerAnthropic(ctx)
  const exit = ctx.get('appExit')
  const s = JSON.parse(readFileSync(process.env.LA_EVAL_SCENARIO, 'utf8'))
  const out = process.env.LA_EVAL_OUT
  const history = []
  const learnerUsage = []

  // Subagent (examiner/checker) sessions, so their cost is counted too; snapshot on dispose.
  const snapshot = (agent) => Array.from({ length: agent.session.seq }, (_, i) => ({ ...agent.session.eventAt(i), sessionId: agent.session.id }))
  const spawned = new Map()
  ctx.on('agent/created', ({ agent }) => { spawned.set(agent.id, { agent, events: null }) })
  ctx.on('agent/disposed', ({ agent }) => {
    const entry = spawned.get(agent.id)
    if (entry) entry.events = snapshot(agent)
  })

  async function speak() {
    if (s.recovery) return s.followup
    if (s.trust) return s.answer
    const r = await learnerReply(s, history)
    learnerUsage.push(r.usage)
    return r.text || '嗯。'
  }

  // The tutor session and how far its events have been read; the question handler flushes what
  // the tutor said before asking, so history keeps the order the learner saw.
  // A quiz card the tutor showed (quiz_show) is laid out as text for the learner, and the
  // learner's next message is sent the way the card sends it: 「【作答】…」.
  let tutor
  let cursor = 0
  let error
  let pendingQuiz = null
  let injected = false, challenged = false, helped = false
  const checkpoints = []
  // Controlled generation fault, not a simulated grading result.
  ctx.on('tools/execute', async (exec, next) => {
    if (s.repair && exec.agent === tutor && exec.name === 'examiner' && !injected) {
      injected = true
      return { isError: false, value: REPAIR_FIXTURE, content: [{ type: 'text', text: REPAIR_FIXTURE }] }
    }
    return next()
  })
  const quizCalls = new Set()
  function drainTutor() {
    const said = []
    const flush = () => {
      const text = said.splice(0).filter(Boolean).join('\n\n').trim()
      if (text) history.push({ who: 'tutor', text })
    }
    for (; tutor && cursor < tutor.session.seq; cursor++) {
      const ev = tutor.session.eventAt(cursor)
      if (ev?.type === 'assistant/message') said.push(textOf(ev.data?.content ?? ev.data?.message?.content))
      if (ev?.type === 'tool/call' && ev.data?.name === 'quiz_show') quizCalls.add(ev.data.callId)
      if (ev?.type === 'tool/result' && quizCalls.has(ev.data?.message?.toolCallId) && !ev.data.message.isError) {
        const view = parseView(textOf(ev.data.message.content))
        if (view?.view === 'quiz') {
          flush()
          const card = quizText(view.ui) ?? view.question
          history.push({ who: 'tutor', text: `（导师给你展示了一张互动题卡片，请按卡片逐项作答，每项一行；最后一行按你的真实把握写「把握：稳」「把握：有点把握」或「把握：蒙的」）\n${card}`, via: 'quiz' })
          pendingQuiz = { hints: 0, id: view.id, title: /^【(.*)】/.exec(card)?.[1] ?? '', sources: view.sources ?? [], retryOf: view.retry?.id, purpose: view.purpose }
        }
      }
      if (ev?.type === 'turn/end' && (ev.data?.reason?.kind ?? ev.data?.reason) === 'error') error ??= `tutor turn failed: ${JSON.stringify(ev.data).slice(0, 2000)}`
    }
    flush()
  }

  // ask_user_question: the simulated learner answers in free text.
  ctx.on('user-questions/request', async (request) => {
    drainTutor()
    pendingQuiz = null // answered along with the question
    const asked = request.questions.map((q) =>
      [q.header, q.question, q.detail, ...(q.options ?? []).map((o, i) => `${i + 1}. ${o.label}${o.description ? `（${o.description}）` : ''}`)].filter(Boolean).join('\n'))
    history.push({ who: 'tutor', text: asked.join('\n\n'), via: 'ask_user_question' })
    const text = await speak()
    history.push({ who: 'learner', text, via: 'ask_user_question' })
    return { answers: request.questions.map((q) => ({ id: q.id, selected: [], custom: text })) }
  })

  ;(async () => {
    await ctx.get('loader')?.await()
    const presets = ctx.get('agentPresets')
    const { id } = await presets.resolve(undefined)
    // Subagents (examiner, checker) inherit the tutor's route.
    const sel = anthropic ? { provider: ANTHROPIC, model: process.env.ANTHROPIC_MODEL } : ctx.get('agentDefaultModel').currentSelection()
    const { agent } = await ctx.get('agents').create({
      sessionId: `session-${randomUUID()}`,
      meta: { cwd: process.cwd(), agentPreset: id },
      agentOptions: { provider: sel.provider, model: sel.model },
      setup: async (agentCtx) => { await presets.mount(agentCtx, id) },
    })
    tutor = agent
    await agent.whenIdle()
    const until = s.until ?? 'diagnosed'
    const marker = join(process.cwd(), '.learn', until === 'verified' ? 'verifications.jsonl' : 'diagnoses.jsonl')
    const need = until === 'verified' ? (s.verifications ?? 1) : 1
    cursor = agent.session.seq
    const checkpoint = () => { if (s.repair || s.learningLoop) checkpoints.push({ eventSeq: agent.session.seq, state: s.learningLoop ? learningState(process.cwd()) : repairState(process.cwd()) }) }
    checkpoint()
    let message = s.opening
    let stop = 'max-turns'
    try {
      for (let turn = 0; turn < (s.maxTurns ?? 8); turn++) {
        history.push({ who: 'learner', text: message })
        agent.followup({ role: 'user', content: [{ type: 'text', text: message }], source: { kind: 'user' } })
        await agent.whenIdle()
        drainTutor()
        checkpoint()
        if (error) { stop = 'tutor-error'; break }
        // The learner replies to the tutor's last words; a turn that ends without any is marked.
        if (history.at(-1)?.who !== 'tutor') history.push({ who: 'tutor', text: '（导师这一轮没有说话。）', silent: true })
        if (!s.recovery && existsSync(marker) && readFileSync(marker, 'utf8').trim().split('\n').length >= need) { stop = until; break }
        if (s.recovery) { message = s.followup; continue }
        if (s.learningLoop && pendingQuiz && !helped) {
          message = `${HELP_PREFIX}「等待区」和「正在执行的位置」我有点分不清，先补讲这个区别，我会回原题继续答。\n（互动题 ${pendingQuiz.id}）`
          pendingQuiz.hints++
          helped = true
          continue
        }
        if (s.repair && pendingQuiz && !challenged) {
          message = REPAIR_CHALLENGE
          challenged = true
          pendingQuiz = null // A question about missing conditions is not a submitted answer.
        } else message = await speak()
        if (message.includes(END)) { stop = 'learner-ended'; break }
        if (pendingQuiz) {
          const confidence = /把握[：:]\s*蒙的/.test(message) ? 'guess' : /把握[：:]\s*有点把握/.test(message) ? 'unsure' : /把握[：:]\s*稳/.test(message) ? 'sure' : undefined
          const answer = message.replace(/\n?把握[：:]\s*(?:有点把握|蒙的|稳)\s*$/, '').trim()
          message = formatQuizAnswer({ ...pendingQuiz, answers: [{ prompt: '作答', value: answer }], confidence, hints: pendingQuiz.hints })
          pendingQuiz = null
        }
      }
    } catch (e) {
      stop = 'driver-error'
      error = String(e?.stack ?? e)
    }
    // Written even after a failure, so a broken run can still be inspected.
    const jsonl = (events) => events.map((e) => JSON.stringify(e)).join('\n') + '\n'
    writeFileSync(join(out, 'events.jsonl'), jsonl(snapshot(agent)))
    const sub = [...spawned.values()].filter((e) => e.agent !== agent).flatMap((e) => e.events ?? snapshot(e.agent))
    writeFileSync(join(out, 'subagent-events.jsonl'), sub.length ? jsonl(sub) : '')
    writeFileSync(join(out, 'transcript.json'), JSON.stringify({ stop, error, history, learnerUsage, ...((s.repair || s.learningLoop) ? { injected, helped, checkpoints } : {}) }, null, 2))
    if (error) console.error(`[eval-driver] ${stop}: ${error}`)
    exit(0)
  })().catch((e) => { console.error('[eval-driver] FAIL', e); exit(1) })
}
