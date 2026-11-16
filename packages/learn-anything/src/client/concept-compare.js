import { createElement as h } from 'react'
import { useUiLocale } from './locale.js'

const relationText = {
  equal: ['A = B · 相等', 'A = B · equal'], subset: ['A ⊆ B · A 包含于 B', 'A ⊆ B · A is a subset of B'],
  superset: ['A ⊇ B · A 包含 B', 'A ⊇ B · A contains B'], overlap: ['A ∩ B · 相交', 'A ∩ B · overlap'], disjoint: ['A ∩ B = ∅ · 互斥', 'A ∩ B = ∅ · disjoint'],
}

/** Lesson text stays verbatim; only interface labels follow the host language. */
export function ConceptCompareCard({ view }) {
  const en = useUiLocale() !== 'zh'
  const label = (zh, english) => en ? english : zh
  const circles = view.relation === 'equal' ? [[100, 52, 37], [100, 52, 33]]
    : view.relation === 'subset' ? [[100, 52, 23], [100, 52, 43]]
      : view.relation === 'superset' ? [[100, 52, 43], [100, 52, 23]]
        : view.relation === 'overlap' ? [[78, 52, 36], [122, 52, 36]] : [[52, 52, 34], [148, 52, 34]]
  return h('section', { className: 'la-card la-concept-compare', 'aria-label': label('概念对比', 'Concept comparison') },
    h('h3', null, view.left, ' / ', view.right),
    h('p', null, `A: ${view.left} · B: ${view.right}`),
    h('figure', null, h('svg', { viewBox: '0 0 200 104', width: 240, role: 'img', 'aria-label': relationText[view.relation]?.[en ? 1 : 0] },
      circles.map(([cx, cy, r], i) => h('circle', { key: i, cx, cy, r, fill: i ? '#f59e0b22' : '#3b82f622', stroke: i ? '#b7791f' : '#3b82f6', strokeWidth: 2 }))),
    h('figcaption', null, relationText[view.relation]?.[en ? 1 : 0])),
    h('table', null,
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, label('特征', 'Feature')), h('th', { scope: 'col' }, view.left), h('th', { scope: 'col' }, view.right))),
      h('tbody', null, view.features.map((row, i) => h('tr', { key: i }, h('th', { scope: 'row' }, row.feature), h('td', null, row.left), h('td', null, row.right))))),
    h('h4', null, label('对比例组', 'Contrast examples')),
    h('ul', null, view.examples.map((example, i) => h('li', { key: i }, example.input, ` — A ${example.left ? '✓' : '✗'} / B ${example.right ? '✓' : '✗'}: `, example.reason))))
}
