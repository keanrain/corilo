import { createElement as h } from 'react'

export function Sources({ sources = [], label = '来源' }) {
  if (!sources.length) return null
  return h('div', { className: 'la-sources', 'aria-label': label },
    h('span', null, label),
    [...new Set(sources)].map((source) => /^https?:\/\//i.test(source)
      ? h('a', { key: source, href: source, target: '_blank', rel: 'noreferrer' }, source)
      : h('code', { key: source }, source)))
}
