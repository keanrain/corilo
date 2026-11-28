import * as react from 'react'

const h = react.createElement
const ANSWER_CARDS = new Set(['outline', 'target-map', 'progress', 'feedback', 'concept-compare'])
// Calls that only put something in front of the learner and wait for them: the text beside them is the reply.
const PRESENTING_CALLS = new Set(['ask_user_question', 'quiz_show', 'flashcard_show'])
const CARD_LINK = /\[([^\]\n]+)\]\(learn-card:[^\s)]*\)/g

/** A reference that could not become a card keeps its title as text instead of a dead `learn-card:` link. */
export function plainCardLinks(text) {
  let fence = null
  return text.split(/(?<=\n)/).map((line) => {
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.replace(/\r?\n$/, ''))
    if (delimiter) {
      if (!fence) fence = delimiter[1]
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length && !delimiter[2].trim()) fence = null
      return line
    }
    return fence ? line : line.replace(CARD_LINK, '$1')
  }).join('')
}

const plainBlocks = (blocks) => blocks.map((block) => block.kind === 'text' ? { ...block, text: plainCardLinks(block.text) } : block)

// References are standalone Markdown paragraphs, never code, quotes or list items.
export function answerParts(text, entries) {
  const views = new Map(entries.filter(({ view }) => ANSWER_CARDS.has(view.view)).map((entry) => [encodeURIComponent(entry.callId), entry.view]))
  const parts = []
  let buffer = '', fence = null
  const lines = text.split(/(?<=\n)/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r?\n$/, '')
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (delimiter) {
      if (!fence) fence = delimiter[1]
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length && !delimiter[2].trim()) fence = null
      buffer += lines[i]
      continue
    }
    const ref = !fence && /^\[([^\]\n]+)\]\(learn-card:([^\s)]+)\)\s*$/.exec(line)
    const view = ref && (i === 0 || !lines[i - 1].trim()) && (i === lines.length - 1 || !lines[i + 1].trim()) && views.get(ref[2])
    if (!view) { buffer += lines[i]; continue }
    if (buffer) parts.push({ text: buffer })
    parts.push({ view, key: `${ref[2]}:${i}` })
    buffer = ''
  }
  if (buffer) parts.push({ text: buffer })
  return parts
}

/** Compose final-answer cards with the installed Chat renderer, keeping its Markdown. */
export function registerAnswerCards(ctx, renderCard) {
  ctx.slots.inject('conversation.chat.node', () => {
    const original = ctx.slots.entries('conversation.chat.node').find((entry) => entry.options.key === 'assistant-step')
    if (!original) throw new Error('learn-anything: Chat assistant renderer is not installed')
    return ctx.slots.register({
      name: 'conversation.chat.node', key: 'assistant-step', priority: (original.options.priority ?? 0) - 1,
      locale: original.locale, inject: original.inject, children: original.options.children,
    }, function LearningAnswer(props) {
      const { node, groupPart, turnProcess } = props
      const entries = props.useTurnData('learn-anything')?.views ?? []
      const native = (blocks, key, last = true) => h(original.component, { ...props, key,
        node: { ...node, data: { ...node.data, blocks: groupPart === 'reasoning' ? blocks : plainBlocks(blocks), status: last ? node.data.status : 'settled' } } })
      const calls = node.data.blocks.filter((block) => block.kind === 'tool-call')
      // A question or an exercise pauses for the learner, so the text beside it is already the user-facing reply.
      const presenting = calls.length > 0 && calls.every((block) => PRESENTING_CALLS.has(block.name))
      if (groupPart === 'reasoning' || (!presenting && (turnProcess?.spec.answerStep !== node.data.step || calls.length > 0))) return native(node.data.blocks, 'native')
      const segments = []
      let blocks = []
      for (const block of node.data.blocks) {
        if (block.kind !== 'text') { blocks.push(block); continue }
        for (const part of answerParts(block.text, entries)) {
          if (part.text !== undefined) blocks.push({ ...block, text: part.text })
          else {
            if (blocks.length) segments.push({ blocks, key: `text:${segments.length}` })
            segments.push(part)
            blocks = []
          }
        }
      }
      if (!segments.length) return native(node.data.blocks, 'native')
      if (blocks.length || node.data.status === 'interrupted') segments.push({ blocks, key: `text:${segments.length}` })
      return h('div', { className: 'la-answer' }, segments.map((part, index) => part.view
        ? h(react.Fragment, { key: part.key }, renderCard(part.view, props))
        : native(part.blocks, part.key, index === segments.length - 1)))
    })
  })
}
