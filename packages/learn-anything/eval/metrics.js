import { parseView } from '../src/host/render.js'
import { parseQuizAction } from '../src/quiz/answer.js'
import { assistantStreamFirstTokenTime } from '@deepseek-ai/dsh-llm/assistant-stream'
import { examinerSections } from './sections.js'
import { quizParser } from '../src/quiz/library.js'

export const textOf = (content) => typeof content === 'string' ? content : (content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('')

/** Same durable clocks as DSH Statistics; step latency includes preparation, not just API time. */
export function performanceTiming(events, subEvents = []) {
  const models = [], tools = []
  const elapsed = (start, end) => Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null
  for (const [source, stream] of [['tutor', events], ['subagent', subEvents]]) {
    const steps = new Map(), calls = new Map()
    for (const event of stream) {
      const data = event.data ?? {}
      const sessionId = typeof event.sessionId === 'string' && event.sessionId ? event.sessionId : null
      const turn = Number.isInteger(data.turn) ? data.turn : null
      const step = Number.isInteger(data.step) ? data.step : null
      const identity = { source, sessionId, turn, step }
      const key = sessionId && turn !== null && step !== null ? JSON.stringify([sessionId, turn, step]) : null
      const state = key && steps.get(key)
      if (event.type === 'step/start' && key) steps.set(key, { time: event.time, settled: false, tools: false })
      if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
        const first = Array.isArray(data.stream) ? assistantStreamFirstTokenTime(data.stream) : undefined
        const start = state && !state.settled && !state.tools ? state.time : undefined
        models.push({ ...identity, seq: event.seq ?? null, settlement: event.type,
          stepToMessageMs: elapsed(start, event.time), firstTokenMs: elapsed(start, first), decodeMs: elapsed(first, event.time) })
        if (state) state.settled = true
      }
      if (event.type === 'tool/call') {
        if (state) state.tools = true
        const callId = typeof data.callId === 'string' ? data.callId : null
        const row = { ...identity, callId, name: data.name ?? null, startedAt: event.time ?? null,
          durationMs: null, error: null }
        tools.push(row)
        if (key && callId) calls.set(JSON.stringify([key, callId]), row)
      }
      if (event.type === 'tool/result' && key) {
        const callKey = JSON.stringify([key, data.message?.toolCallId])
        const row = calls.get(callKey)
        if (row) {
          row.durationMs = elapsed(row.startedAt, event.time)
          row.error = Boolean(data.message.isError)
          calls.delete(callKey)
        }
      }
    }
  }
  return { models, tools }
}

/** Safety regressions fail a run; diagnosis rates remain descriptive. */
export function failuresOf(results) {
  return results.flatMap((r) => [
    r.error && `${r.id}: scenario error`,
    r.ghostwritten?.length && `${r.id}: ghostwritten learner statement`,
    r.quiz?.leaks?.length && `${r.id}: answer leaked in quiz`,
    r.material?.invalidStored && `${r.id}: invalid material source persisted`,
    r.material?.sourceChainIntact === false && `${r.id}: material sources lost in quiz/answer/grading`,
    ...(r.repair?.failures ?? []).map((failure) => `${r.id}: ${failure}`),
    ...(r.learningLoop?.failures ?? []).map((failure) => `${r.id}: ${failure}`),
    ...(r.recovery?.failures ?? []).map((failure) => `${r.id}: ${failure}`),
    ...(r.trust?.failures ?? []).map((failure) => `${r.id}: ${failure}`),
  ].filter(Boolean))
}

/** Host timestamps and tutor LLM steps; browser paint and subagent steps are separate. */
export function practiceTiming(events) {
  const calls = new Map()
  let started, turnStartSteps, boundarySteps = 0, pending, nextQuiz, steps = 0, firstQuizMs = null
  const questions = []
  for (const event of events) {
    if (event.type === 'turn/start') turnStartSteps = steps
    if (event.type === 'turn/end') nextQuiz = null
    if (event.type === 'step/start') steps++
    if (event.type === 'user/message' && event.data?.source?.kind === 'user') {
      nextQuiz = null
      started ??= event.time
      const message = textOf(event.data.content)
      const action = parseQuizAction(message)
      // dsh persists the accepted user message after its first step/start.
      if (action?.action === 'answered') pending = { id: action.id, submittedAt: event.time, steps: turnStartSteps ?? steps }
    }
    if (event.type === 'tool/call') calls.set(event.data.callId, event.data.name)
    if (event.type !== 'tool/result' || event.data?.message?.isError) continue
    const tool = calls.get(event.data.message.toolCallId)
    if (tool !== 'quiz_show' && tool !== 'verification_record') continue
    const view = parseView(textOf(event.data.message.content))
    if (view?.view === 'quiz') {
      if (started !== undefined && firstQuizMs === null) firstQuizMs = event.time - started
      if (nextQuiz) nextQuiz.question.nextQuizMs = event.time - nextQuiz.feedbackAt
      nextQuiz = null
      questions.push({ id: view.id, questionLlmSteps: steps - boundarySteps, feedbackMs: null, gradingLlmSteps: null, nextQuizMs: null })
      boundarySteps = steps
    }
    if (view?.view === 'feedback' && pending) {
      const question = questions.find((q) => q.id === pending.id)
      if (question) {
        question.feedbackMs = event.time - pending.submittedAt
        question.gradingLlmSteps = steps - pending.steps
        nextQuiz = { question, feedbackAt: event.time }
      }
      boundarySteps = steps
      pending = null
    }
  }
  return { firstQuizMs, questions }
}

export function materialStats(events, subEvents, verified, history, material) {
  if (!material) return undefined
  const calls = new Map()
  const quizzes = []
  const readBlocks = []
  let invalidRejected = false
  for (const event of [...events, ...subEvents]) {
    if (event.type === 'tool/call') {
      let args = event.data.arguments ?? {}
      if (typeof args === 'string') { try { args = JSON.parse(args) } catch { args = {} } }
      calls.set(event.data.callId, { name: event.data.name, args })
    }
    if (event.type !== 'tool/result') continue
    const call = calls.get(event.data?.message?.toolCallId)
    if (!call) continue
    const failed = event.data.message.isError
    if (failed && JSON.stringify(call.args).includes(material.invalidSource)) invalidRejected = true
    if (!failed && call.name === 'material_read') readBlocks.push(...(call.args.blocks ?? []))
    if (!failed && call.name === 'quiz_show') {
      const view = parseView(textOf(event.data.message.content))
      if (view?.view === 'quiz') quizzes.push(view)
    }
  }
  const answers = history.filter((m) => m.who === 'learner').map((m) => m.text)
  const citations = [...quizzes, ...verified].flatMap((item) => item.sources ?? [])
  const submitted = quizzes.filter((q) => answers.some((answer) => parseQuizAction(answer)?.id === q.id))
  const sourceChainIntact = quizzes.length ? quizzes.every((q) => q.sources?.length && q.sources.every((ref) => material.sources.includes(ref))) &&
    submitted.every((q) => q.sources.every((ref) => answers.some((answer) => parseQuizAction(answer)?.id === q.id && answer.includes(ref)) &&
      verified.some((v) => v.question === q.question && v.sources?.includes(ref)))) : null
  const unsupportedDetected = subEvents.some((event) => event.type === 'assistant/message' &&
    /不通过|存疑|不支持|不能支持|与原文.*矛盾/.test(textOf(event.data?.content ?? event.data?.message?.content)))
  return { case: material.case, readBlocks: [...new Set(readBlocks)], quizShown: quizzes.length, submitted: submitted.length, sourceChainIntact,
    invalidRejected, invalidStored: citations.includes(material.invalidSource), unsupportedDetected }
}

const normalize = (t) => t.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
const parser = quizParser()

function nonChoiceText(ui) {
  const parsed = parser.parse(ui)
  if (parsed.root?.typeName !== 'Quiz' || parsed.meta.incomplete || parsed.meta.errors.some((e) => e.severity !== 'warning')) {
    return [...ui.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1])
  }
  const strings = (value) => {
    if (typeof value === 'string') return [value]
    if (Array.isArray(value)) return value.flatMap(strings)
    if (!value || typeof value !== 'object') return []
    const alternatives = ['Choice', 'DualPredict'].includes(value.typeName) && value.props?.options?.length >= 2
    return Object.entries(value.props ?? value).flatMap(([key, item]) => alternatives && key === 'options' ? [] : strings(item))
  }
  return strings(parsed.root)
}

/** Compare only private answer sections; Markdown headings also terminate a section. */
export function quizStats(events, subEvents) {
  const calls = new Set()
  const views = []
  let failed = 0
  for (const ev of events) {
    if (ev?.type === 'tool/call' && ev.data?.name === 'quiz_show') calls.add(ev.data.callId)
    if (ev?.type !== 'tool/result' || !calls.has(ev.data?.message?.toolCallId)) continue
    if (ev.data.message.isError) { failed++; continue }
    const view = parseView(textOf(ev.data.message.content))
    if (view?.view === 'quiz') views.push(view)
  }
  const said = subEvents.filter((ev) => ev?.type === 'assistant/message').map((ev) => textOf(ev.data?.content ?? ev.data?.message?.content))
  const answers = said.flatMap(examinerSections).filter(([name]) => name === '标准答案').map(([, text]) => text)
  const clauses = answers.flatMap((a) => a.split(/[。；;！？!?\n]/)).map(normalize).filter((c) => c.length >= 8)
  const leaks = views.filter((v) => {
    const shown = nonChoiceText(v.ui).map(normalize).join('\0')
    return /正确答案|标准答案|（对）|\(对\)|✓|✔/.test(v.ui) || clauses.some((c) => shown.includes(c))
  })
  return { calls: calls.size, shown: views.length, failed, examinerBlocks: said.filter((t) => t.includes('【互动】')).length, leaks: leaks.map((v) => v.id) }
}
