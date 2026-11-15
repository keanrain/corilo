// Small, shared typography for question copy. React escapes all text; only
// paragraphs, lists, bold and inline code are supported, with no HTML or links.
import { createElement as h } from 'react'

export function InlineText({ text }) {
  return h('span', { className: 'la-inline' }, String(text ?? '').split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? h('strong', { key: i }, part.slice(2, -2))
      : part.startsWith('`') && part.endsWith('`') && part.length > 2
        ? h('code', { key: i }, part.slice(1, -1)) : part))
}

export function QuestionText({ text, className = '' }) {
  const lines = String(text ?? '').split(/\r?\n/)
  const blocks = []
  const item = (line) => /^\s*(?:[-*•]\s+|(\d+)[.)、]\s+)(.+)$/.exec(line)
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const first = item(lines[i])
    if (!first) {
      blocks.push(h('p', { key: i }, h(InlineText, { text: lines[i] })))
      continue
    }
    const ordered = Boolean(first[1])
    const entries = []
    let match = first
    const key = i
    while (match && Boolean(match[1]) === ordered) {
      entries.push(h('li', { key: i, ...(ordered ? { value: Number(match[1]) } : {}) }, h(InlineText, { text: match[2] })))
      match = item(lines[++i] ?? '')
    }
    i--
    blocks.push(h(ordered ? 'ol' : 'ul', { key }, entries))
  }
  return h('div', { className: `la-prose ${className}`.trim() }, blocks)
}

export const QUESTION_TEXT_CSS = `
.la-prose{display:grid;gap:10px;line-height:1.85;overflow-wrap:anywhere}
.la-prose p{margin:0}.la-prose ul,.la-prose ol{display:grid;gap:8px;margin:0;padding-left:20px}
.la-prose ul{list-style:disc}.la-prose ol{list-style:decimal}
.la-prose li{padding-left:3px}.la-prose li::marker{color:var(--la-muted);font-variant-numeric:tabular-nums}
.la-prose strong,.la-inline strong{font-weight:650;color:var(--la-ink)}
.la-prose code,.la-inline code{font: .92em/1.6 ui-monospace,SFMono-Regular,monospace;padding:1px 4px;border-radius:4px;background:var(--la-soft);overflow-wrap:anywhere;box-decoration-break:clone}
.la-inline{min-width:0;overflow-wrap:anywhere}
`
