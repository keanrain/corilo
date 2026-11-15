import * as store from './store.js'
import { factsWithIds } from './mastery.js'

function activeRecord(record, course, kps) {
  if (!['wrong', 'partial'].includes(record.verdict)) return null
  if (!course?.chapters.some((chapter) => chapter.kpIds.includes(record.kpId))) return null
  const kp = kps.find((entry) => entry.id === record.kpId)
  if (!kp || kp.skipped) return null
  if (kp.kind === 'information') {
    const facts = factsWithIds(kp)
    const factId = record.factId ?? (facts.length === 1 && facts[0].id === 'fact-1' ? 'fact-1' : undefined)
    if (record.modelId || !facts.some((fact) => fact.id === factId)) return null
    return { ...record, factId }
  }
  return !record.factId && kp.models.some((model) => model.id === record.modelId) ? record : null
}

async function context(cwd) {
  const p = store.paths(cwd)
  const [course, kps, records] = await Promise.all([
    store.readJson(p.course, null), store.listKps(cwd), store.readJsonl(p.verifications),
  ])
  return { course, kps, records }
}

/** Read an original mistake without changing its historical record. */
export async function loadRetry(cwd, id, target) {
  const { course, kps, records } = await context(cwd)
  const record = records.find((entry) => entry.id === id)
  const active = record && activeRecord(record, course, kps)
  if (!active) throw new Error('retryOf must identify an active wrong or partial verification')
  if (target && ['kpId', 'modelId', 'factId'].some((key) => active[key] !== target[key])) {
    throw new Error('retryOf must have the same kpId, modelId and factId as this question')
  }
  return active
}

/** Recommend unresolved mistakes, newest first; only an explicit correct retry resolves one. */
export async function listMistakes(cwd, { kpId, limit = 10 } = {}) {
  const { course, kps, records } = await context(cwd)
  const solved = new Set(records.filter((record) => record.verdict === 'correct' && record.retryOf).map((record) => record.retryOf))
  return records.map((record, index) => ({ record: activeRecord(record, course, kps), index }))
    .filter(({ record }) => record && (!kpId || record.kpId === kpId) && !solved.has(record.id))
    .sort((a, b) => (Date.parse(b.record.at) - Date.parse(a.record.at) || b.index - a.index))
    .slice(0, Number.isInteger(limit) ? Math.min(30, Math.max(1, limit)) : 10)
    .map(({ record }) => record)
}

export function sameQuestion(a, b) {
  return a.trim().replace(/\s+/gu, ' ') === b.trim().replace(/\s+/gu, ' ')
}
