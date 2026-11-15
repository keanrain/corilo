export const FLASHCARD_PREFIX = '【闪卡自评】'
export const FLASHCARD_CONFIDENCE = { sure: '能独立回忆', unsure: '只记得一部分', blank: '暂时想不起来' }
export const FLASHCARD_RESULT = { remembered: '记住了', again: '再练一次' }

export function formatFlashcardReview(view, confidence, result) {
  return `${FLASHCARD_PREFIX}${view.kp.title}\n知识点：${view.kp.id}；记忆卡：${view.fact.id}\n翻面前：${FLASHCARD_CONFIDENCE[confidence]}\n核对后：${FLASHCARD_RESULT[result]}\n这是自测感受，不是独立回忆的验证证据。\n（闪卡 ${view.id}）`
}

export function flashcardHistory(chat, id) {
  let ownSeq = -1, latestSeq = -1, result = null
  for (const turn of chat?.timeline?.turns.values() ?? []) {
    for (const entry of turn.data.get('learn-anything')?.views ?? []) {
      if (!['flashcard', 'quiz'].includes(entry.view.view)) continue
      latestSeq = Math.max(latestSeq, entry.seq)
      if (entry.view.id === id) ownSeq = entry.seq
    }
  }
  let resultSeq = -1
  for (const node of chat?.legacy?.nodes ?? []) {
    if (!['user', 'steering'].includes(node.kind)) continue
    const text = (node.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
    if (!text.startsWith(FLASHCARD_PREFIX) || /（闪卡 ([^）\s]+)）\s*$/.exec(text)?.[1] !== id) continue
    const label = /^核对后：(记住了|再练一次)$/m.exec(text)?.[1]
    if (label && node.seq > resultSeq) { resultSeq = node.seq; result = label }
  }
  return { result, closed: result ? 'reviewed' : ownSeq >= 0 && latestSeq > ownSeq ? 'superseded' : null }
}
