// Dependency-free lexical retrieval. Segment both documents and queries identically.
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })
const STOP_WORDS = new Set('的 了 与 和 或 是 在 将 把 被 对 及 一个 这 那 什么 如何 怎么 区别 the a an and or of to in is are'.split(' '))
export function searchTerms(text) {
  return [...segmenter.segment(text.normalize('NFKC').toLowerCase())]
    .filter((part) => part.isWordLike && !STOP_WORDS.has(part.segment))
    .map((part) => part.segment)
}
export function rankBlocks(documents, query) {
  const terms = [...new Set(searchTerms(query))]
  if (!terms.length) return []
  const docs = documents.map((doc) => {
    const words = searchTerms(`${doc.block.title} ${doc.block.text}`)
    const counts = new Map()
    for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1)
    return { ...doc, counts, length: words.length }
  })
  const average = docs.reduce((sum, doc) => sum + doc.length, 0) / (docs.length || 1) || 1
  const df = new Map(terms.map((term) => [term, docs.filter((doc) => doc.counts.has(term)).length]))
  return docs.map((doc) => {
    let score = 0
    for (const term of terms) {
      const tf = doc.counts.get(term) ?? 0
      if (!tf) continue
      const idf = Math.log(1 + (docs.length - df.get(term) + 0.5) / (df.get(term) + 0.5))
      score += idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * doc.length / average))
    }
    const lower = doc.block.text.normalize('NFKC').toLowerCase()
    const positions = terms.map((term) => lower.indexOf(term)).filter((at) => at >= 0)
    const at = positions.length ? Math.min(...positions) : 0
    return { ...doc, score, snippet: doc.block.text.slice(Math.max(0, at - 60), at + 120).replace(/\s+/g, ' ') }
  }).filter((doc) => doc.score > 0).sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref))
}
