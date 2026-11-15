import { readFile } from 'node:fs/promises'
import { checkQuiz, quizLanguageSection } from '../src/host/quiz.js'
import { formatQuizAnswer } from '../src/quiz/answer.js'
import { textOf } from './metrics.js'
import { QUALITY_CASES } from './quality-cases.js'
import { examinerSections } from './sections.js'

export function qualityPrompt(c) {
  return [
    `请判题。参考规律：${c.rule}`,
    `学习者实际可见：${c.visible ?? '题目与互动卡片'}`,
    `【题目】\n${c.question}`, `【互动】\n${c.ui}`,
    `【标准答案】\n${c.standardAnswer}`, `【判分要点】\n${c.grading}`,
    formatQuizAnswer({ id: 'q-quality', title: '本题作答', answers: [{ prompt: '回答', value: c.answer }], confidence: 'unsure' }),
  ].join('\n\n')
}

// These fixed oracles check known regressions, not arbitrary semantic correctness.
export function scoreQuality(c, text) {
  const sections = Object.fromEntries(examinerSections(text))
  const verdict = sections['判定'] ?? null
  const failures = []
  if (c.expect.verdict === 'deferred') {
    if (verdict !== null) failures.push('条件不足时仍给出判定')
    if (sections['归因']) failures.push('将出题缺陷归因为学习者的问题')
    if (!/无法|不能|不足|缺少|缺失|暂缓|未给|未说明|未提供|不明确/.test(text)) failures.push('未说明需要补齐题面或依据')
    for (const pattern of c.expect.mentions) if (!new RegExp(pattern, 'u').test(text)) failures.push(`未指出已知缺口：${pattern}`)
  } else {
    if (verdict !== c.expect.verdict) failures.push(`预期${c.expect.verdict}，实际${verdict ?? '无判定'}`)
    if (sections['能否说清规律'] !== c.expect.explained) failures.push('规律理解判定不符')
  }
  if (c.expect.evidence) {
    const quotes = [...(sections['归因'] ?? '').matchAll(/[「“"]([^」”"\r\n]+)[」”"]/gu)].map((m) => m[1].trim())
    const source = c.answer.replace(/\s+/gu, '')
    const fromSource = (quote) => {
      const parts = quote.replace(/\s+/gu, '').split(/…+|\.{3,}/u).filter(Boolean)
      let position = 0
      return parts.length > 0 && parts.every((part) => {
        const index = source.indexOf(part, position)
        if (index < 0) return false
        position = index + part.length
        return true
      })
    }
    if (!quotes.some(fromSource)) failures.push('归因缺少可在学习者原话中找到的引用')
  }
  for (const pattern of c.expect.forbidden ?? []) if (new RegExp(pattern, 'u').test(text)) failures.push('反馈添加了学习者没有表达的大小比较误解')
  return { verdict, failures }
}

export async function runQuality({ mock = false, only, route, fetcher = fetch } = {}) {
  const cases = QUALITY_CASES.filter((c) => !only || c.id.includes(only))
  if (!cases.length) throw new Error(`no quality cases match --only ${only}`)
  const system = await readFile(new URL('../prompts/examiner.md', import.meta.url), 'utf8') + '\n\n' + quizLanguageSection()
  const results = []
  for (const c of cases) {
    const start = performance.now()
    try {
      const errors = checkQuiz(c.ui)
      if (errors.length) throw new Error(`invalid fixture UI: ${errors.join('; ')}`)
      let body
      if (mock) body = { stop_reason: 'end_turn', content: [{ type: 'text', text: c.sample }] }
      else {
        const res = await fetcher(`${route.base.replace(/\/$/u, '')}/v1/messages`, {
          method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', ...route.headers },
          body: JSON.stringify({ model: route.model, max_tokens: 2048, thinking: { type: 'disabled' }, system, messages: [{ role: 'user', content: qualityPrompt(c) }] }),
          signal: AbortSignal.timeout(120000),
        })
        if (!res.ok) throw new Error(`Messages API HTTP ${res.status}`)
        body = await res.json()
      }
      const text = textOf(body.content)
      if (body.stop_reason !== 'end_turn' || !text.trim()) throw new Error(`incomplete response: ${body.stop_reason ?? 'missing stop_reason'}`)
      results.push({ id: c.id, expected: c.expect.verdict, ...scoreQuality(c, text), elapsedMs: Math.round(performance.now() - start), prompt: qualityPrompt(c), text, usage: body.usage ?? null })
    } catch (error) {
      // Avoid persisting transport errors that might contain request credentials.
      const message = /^Messages API HTTP \d+$|^incomplete response: |^invalid fixture UI: /.test(error.message) ? error.message : 'request failed'
      results.push({ id: c.id, error: message, failures: [message], elapsedMs: Math.round(performance.now() - start) })
    }
    const result = results.at(-1)
    console.error(`quality: ${c.id} ${result.error ? 'ERROR' : result.failures.length ? 'FAIL' : 'PASS'}`)
  }
  const failures = results.flatMap((r) => r.failures.map((failure) => `${r.id}: ${failure}`))
  return { at: new Date().toISOString(), mode: 'quality', mock, model: mock ? 'offline-fixtures' : route.model, system, summary: {
    cases: results.length, passed: results.filter((r) => !r.failures.length).length,
    failed: results.filter((r) => !r.error && r.failures.length).length, errors: results.filter((r) => r.error).length,
  }, failures, results }
}
