import { marker } from './render.js'

export const CONCEPT_RELATIONS = ['equal', 'subset', 'superset', 'overlap', 'disjoint']
export const RELATION_LABELS = { equal: '相等', subset: 'A 包含于 B', superset: 'A 包含 B', overlap: '相交', disjoint: '互斥' }

function text(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4000) throw new Error(`comparison ${name} must be nonempty text (max 4000 characters)`)
  return value.trim()
}

/** Validate before recording the diagnosis: an ungrounded blank table is no prescription. */
export function validateComparison(value) {
  if (!value || typeof value !== 'object') throw new Error('concept-confusion requires comparison: concepts, relation, features and contrast examples')
  const left = text(value.left, 'left'), right = text(value.right, 'right')
  if (left === right) throw new Error('comparison concepts must have different names')
  if (!CONCEPT_RELATIONS.includes(value.relation)) throw new Error('invalid comparison relation')
  if (!Array.isArray(value.features) || !value.features.length || value.features.length > 12) throw new Error('comparison needs 1–12 feature rows')
  if (!Array.isArray(value.examples) || value.examples.length < 2 || value.examples.length > 12) throw new Error('comparison needs 2–12 contrast examples')
  const features = value.features.map((row) => ({ feature: text(row.feature, 'feature'), left: text(row.left, 'feature.left'), right: text(row.right, 'feature.right') }))
  const examples = value.examples.map((example) => {
    if (typeof example.left !== 'boolean' || typeof example.right !== 'boolean') throw new Error('comparison example memberships must be booleans')
    if (value.relation === 'equal' && example.left !== example.right || value.relation === 'subset' && example.left && !example.right || value.relation === 'superset' && example.right && !example.left || value.relation === 'disjoint' && example.left && example.right) throw new Error('comparison example contradicts the set relation')
    return { input: text(example.input, 'example'), left: example.left, right: example.right, reason: text(example.reason, 'reason') }
  })
  if (!examples.some((e) => e.left) || !examples.some((e) => e.right)) throw new Error('comparison needs examples belonging to each concept')
  return { left, right, relation: value.relation, features, examples }
}

export function conceptCompareView(kp, model, comparison) {
  const cell = (value) => String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const lines = [`## 概念对比：${comparison.left} / ${comparison.right}`, `A：${comparison.left}；B：${comparison.right}；外延关系：${RELATION_LABELS[comparison.relation]}`, '| 特征 | A | B |', '|---|---|---|',
    ...comparison.features.map((row) => `| ${cell(row.feature)} | ${cell(row.left)} | ${cell(row.right)} |`),
    ...comparison.examples.map((example) => `- ${example.input}：A ${example.left ? '✓' : '✗'} / B ${example.right ? '✓' : '✗'}；${example.reason}`)]
  return lines.join('\n') + marker({ view: 'concept-compare', title: kp.title, kpId: kp.id, modelId: model?.id, ...comparison })
}
