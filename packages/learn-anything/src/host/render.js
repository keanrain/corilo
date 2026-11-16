/**
 * Read-only views. Each view is Markdown for the model (and a fallback for the
 * user) followed by one machine-readable marker the Web client renders as a card.
 * @module learn-anything/render
 */
import { LEVEL_LABEL } from './mastery.js'

export const VIEW_MARKER = 'learn-anything:view'

const TAG_LABEL = { d: '#d 规述', e: '#e 例述', t: '#t 迁移', v: '#v 验证' }
const VERDICT_LABEL = { correct: '✓', partial: '△', wrong: '✗' }

export function marker(data) {
  // `--` cannot appear inside an HTML comment; escape it so the marker stays one comment.
  return `\n<!-- ${VIEW_MARKER} ${JSON.stringify(data).replace(/--/g, '-\\u002d')} -->`
}

/** Give the tutor a small reference to the validated view, without copying its payload. */
export function withCardReference(text, callId) {
  const labels = { outline: '学习路线', 'target-map': '知识靶图', progress: '学习进度', feedback: '练习反馈', 'concept-compare': '概念对比' }
  const label = labels[parseView(text)?.view]
  if (!label || !callId) return text
  return `${text}\n\n展示卡片：在最终回答的合适位置，把下面引用原样独立成段，前后留空行；不要放在思考、工具调用前的过渡文字或代码块中。不必复述卡片，也不要复制工具中的导师私有内容。\n[${label}](learn-card:${encodeURIComponent(callId)})`
}

function modelHeading(model) {
  if (model.type === 'discriminative') return `判别模型「${model.concept}」`
  return `联结模型「${model.input}」→「${model.output}」`
}

function cell(text) {
  return String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

export function targetMapView(kp, verifications) {
  const models = kp.models.map((model) => {
    const records = verifications.filter((v) => v.kpId === kp.id && v.modelId === model.id).slice(-5)
    return {
      id: model.id,
      type: model.type,
      concept: model.concept,
      input: model.input,
      output: model.output,
      phase: model.phase,
      mastery: model.mastery ?? 'none',
      statement: model.targetMap.statement?.text ?? null,
      annotation: model.targetMap.annotation ?? '',
      examples: model.targetMap.examples.map((e) => ({
        id: e.id, tag: e.tag, polarity: e.polarity, input: e.input, output: e.output, origin: e.origin, checked: e.checked,
        sources: e.sources ?? (e.source ? [e.source] : []),
      })),
      verifications: records.map((v) => ({ question: v.question, verdict: v.verdict, attribution: v.attribution, sources: v.sources ?? [] })),
    }
  })
  const lines = [`## 渐构靶图：${kp.title}`, `阶段 ${kp.phase} · 掌握度 ${LEVEL_LABEL[kp.mastery ?? 'none']}`]
  if (kp.sources?.length) lines.push(`参考资料：${kp.sources.join('、')}`)
  for (const m of models) {
    lines.push('', `### ${modelHeading(m)}（${LEVEL_LABEL[m.mastery]}，${m.phase}）`)
    lines.push(`**上层（用户表述的${m.type === 'discriminative' ? '内涵' : '映射规律'}）**：${m.statement ?? '（待用户写出）'}`)
    lines.push('', '**下层（例子与验证）**')
    if (m.examples.length === 0) lines.push('（暂无例子）')
    else {
      lines.push('| 类型 | 输入 | 输出 | 来源 |', '|---|---|---|---|')
      for (const e of m.examples) {
        const tag = `${TAG_LABEL[e.tag] ?? e.tag}${e.polarity === 'neg' ? ' 反例' : e.polarity === 'pos' ? ' 正例' : ''}`
        lines.push(`| ${tag} | ${cell(e.input)} | ${cell(e.output)} | ${e.origin}${e.checked ? ' ✓校验' : ''}${e.sources.length ? ` · ${cell(e.sources.join('、'))}` : ''} |`)
      }
    }
    for (const v of m.verifications) lines.push(`- ${VERDICT_LABEL[v.verdict]} ${cell(v.question)}${v.attribution ? `（归因：${v.attribution}）` : ''}${v.sources.length ? ` · 依据：${cell(v.sources.join('、'))}` : ''}`)
  }
  if (kp.kind === 'information') lines.push('', '（信息类知识点：走记忆与闪卡复习，不建模型）')
  else if (models.length === 0) lines.push('', '（还没有模型）')
  const data = { view: 'target-map', kp: { id: kp.id, title: kp.title, kind: kp.kind, phase: kp.phase, mastery: kp.mastery ?? 'none' }, sources: kp.sources ?? [], models }
  return lines.join('\n') + marker(data)
}

export function outlineView(course, kps) {
  const byId = new Map(kps.map((kp) => [kp.id, kp]))
  const chapters = course.chapters.map((ch) => ({
    id: ch.id,
    title: ch.title,
    kps: ch.kpIds.map((id) => byId.get(id)).filter(Boolean).map((kp) => ({
      id: kp.id, title: kp.title, kind: kp.kind, phase: kp.phase, mastery: kp.mastery ?? 'none',
      estMinutes: kp.estMinutes, prerequisites: kp.prerequisites,
    })),
  }))
  const lines = [`## 学习路线：${course.goal}`, `状态：${course.status === 'planning' ? '规划中（待确认）' : course.status === 'done' ? '已完成' : '学习中'}`]
  chapters.forEach((ch, i) => {
    lines.push('', `### ${i + 1}. ${ch.title}`)
    for (const kp of ch.kps) {
      const pre = kp.prerequisites?.length ? `，前置：${kp.prerequisites.join('、')}` : ''
      const time = kp.estMinutes ? `，约 ${kp.estMinutes} 分钟` : ''
      lines.push(`- [${kp.kind === 'information' ? '信息' : '知识'}] ${kp.title}（${kp.id}）— ${LEVEL_LABEL[kp.mastery]}${time}${pre}`)
    }
  })
  if (course.resources?.length) {
    lines.push('', '### 资源')
    for (const r of course.resources) {
      const ref = /^https?:\/\//i.test(r.url) ? `[${r.title}](${r.url})` : `${r.title}（材料 ${r.url}）`
      lines.push(`- ${ref}${r.note ? ` — ${r.note}` : ''}`)
    }
  }
  const data = { view: 'outline', goal: course.goal, status: course.status, chapters, resources: course.resources ?? [] }
  return lines.join('\n') + marker(data)
}

export function progressView(course, kps, dueCards, weak) {
  const counts = { none: 0, novice: 0, proficient: 0, expert: 0 }
  for (const kp of kps) counts[kp.mastery ?? 'none']++
  const lines = [
    `## 学习进度：${course.goal}`,
    `知识点 ${kps.length} 个：${Object.entries(counts).map(([k, n]) => `${LEVEL_LABEL[k]} ${n}`).join(' · ')}`,
    `今日待复习：${dueCards.length} 项`,
  ]
  if (weak.length) {
    lines.push('', '### 薄弱点')
    for (const w of weak) lines.push(`- ${w.title}：${w.reason}`)
  }
  const data = { view: 'progress', goal: course.goal, counts, total: kps.length, due: dueCards.length, weak }
  return lines.join('\n') + marker(data)
}

/**
 * Feedback card data for one graded answer: what the learner sees right after grading.
 * Carries the verdict and the attribution type, never the examiner's feedback notes (those
 * guide the tutor's next move and may give away a counterexample).
 */
export function feedbackView({ kp, model, record, level, kpLevel, passed, flow, calibration, retry }) {
  return {
    view: 'feedback',
    id: record.id,
    kp: { id: kp.id, title: kp.title },
    model: model ? modelHeading(model) : null,
    questionType: record.questionType,
    verdict: record.verdict,
    attribution: record.verdict === 'correct' ? undefined : record.attribution,
    explainedRule: record.explainedRule,
    hintsUsed: record.hintsUsed,
    level,
    kpLevel,
    passed,
    difficulty: record.difficulty,
    confidence: record.confidence,
    sources: record.sources ?? [],
    ...(retry ? { retry: { id: retry.id, question: retry.question, answer: retry.answer, currentQuestion: record.question, currentAnswer: record.answer } } : {}),
    calibration: calibration ?? undefined,
    flow: flow ? { next: flow.next, last: flow.last, reason: flow.reason, progress: flow.progress } : undefined,
  }
}

/** Extract the view payload from a tool result text, for the client and tests. */
export function parseView(text) {
  const start = text.lastIndexOf(`<!-- ${VIEW_MARKER} `)
  if (start < 0) return null
  const end = text.indexOf(' -->', start)
  return JSON.parse(text.slice(start + VIEW_MARKER.length + 6, end))
}
