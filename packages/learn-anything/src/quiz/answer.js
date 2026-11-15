// Shared by the interactive card and the evaluation learner; no browser dependencies.
const CONFIDENCE = { sure: '稳', unsure: '有点把握', guess: '蒙的' }
export const HELP_PREFIX = '【学习补给】'
export const PRACTICE_MARKER = '用途：理解练习（不计掌握度）'

export function formatQuizAnswer({ id, title, answers, sources = [], confidence, hints = 0, retryOf, purpose }) {
  const lines = [`【作答】${title}`]
  if (purpose === 'practice') lines.push(PRACTICE_MARKER)
  for (const { prompt, value } of answers) lines.push(`· ${prompt} → ${value}`)
  if (CONFIDENCE[confidence]) lines.push(`把握：${CONFIDENCE[confidence]}`)
  if (sources.length) lines.push(`教材依据：${sources.join('、')}`)
  if (retryOf) lines.push(`重赛记录：${retryOf}`)
  lines.push(`提示：${hints} 次`, `（互动题 ${id}）`)
  return lines.join('\n')
}

export function parseQuizAction(text) {
  const id = /（互动题 ([^，）\s]+)(?:，[^）]*)?）\s*$/.exec(text)?.[1]
  if (!id) return null
  if (text.startsWith('【作答】')) return { id, action: 'answered', text }
  if (text.startsWith('【求提示】')) return { id, action: 'hint' }
  if (text.startsWith(HELP_PREFIX)) return { id, action: 'help' }
  if (text.startsWith('【歇一会儿】')) return { id, action: 'break' }
  if (text.startsWith('【换题】太简单了')) return { id, action: 'harder' }
  if (text.startsWith('【换题】太难了')) return { id, action: 'easier' }
  return null
}

/** Keep the learner's answer readable without exposing the transport envelope. */
export function quizAnswerDisplay(text) {
  return text.split('\n').filter((line, index, lines) =>
    !(index === 0 && line.startsWith('【作答】')) &&
    !(index === lines.length - 1 && /^（互动题 [^）]+）\s*$/.test(line)) &&
    line !== PRACTICE_MARKER && !line.startsWith('教材依据：') && !line.startsWith('重赛记录：')
  ).join('\n').trim()
}

/** Derive lifecycle from real user messages and successful quiz views, including replay. */
export function quizHistory(chat, id) {
  let ownSeq = -1, latestSeq = -1, closed = null, answerText = null, hints = 0, helpRequests = 0, lastSeq = 0
  for (const turn of chat?.timeline?.turns.values() ?? []) {
    for (const entry of turn.data.get('learn-anything')?.views ?? []) {
      if (!['quiz', 'flashcard'].includes(entry.view.view)) continue
      latestSeq = Math.max(latestSeq, entry.seq)
      if (entry.view.id === id) ownSeq = entry.seq
    }
  }
  for (const node of chat?.legacy?.nodes ?? []) {
    if (node.kind !== 'user' && node.kind !== 'steering') continue
    const text = (node.content ?? []).filter((block) => block.type === 'text').map((block) => block.text).join('\n')
    const action = parseQuizAction(text)
    if (action?.id !== id) continue
    lastSeq = Math.max(lastSeq, node.seq)
    if (action.action === 'hint') hints++
    else if (action.action === 'help') helpRequests++
    else { closed = action.action; answerText = action.text ?? null }
  }
  if (!closed && ownSeq >= 0 && latestSeq > ownSeq) closed = 'superseded'
  return { closed, answerText, hints, helpRequests, lastSeq }
}
