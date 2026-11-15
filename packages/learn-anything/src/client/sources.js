import { t, useUiLocale } from './locale.js'
import { createElement as h } from 'react'

export function Sources({ sources = [], label = t('来源') }) {
  useUiLocale()
  if (!sources.length) return null
  return h('div', { className: 'la-sources', 'aria-label': label },
    h('span', null, label),
    [...new Set(sources)].map((source) => /^https?:\/\//i.test(source)
      ? h('a', { key: source, href: source, target: '_blank', rel: 'noreferrer' }, source)
      : h('code', { key: source }, source)))
}
