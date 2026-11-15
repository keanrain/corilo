// Shared schemas and persisted learning state; no tool-module dependencies.
import * as store from '../store.js'
import { kpPhase } from '../phases.js'
import { kpMastery, modelMastery, meetsGate, LEVEL_LABEL, DEFAULT_GATE } from '../mastery.js'

export const ATTRIBUTION_LABEL = {
  'memorized-wording': '记言代学', 'lower-layer-loss': '下层丢失', 'upper-layer-loss': '上层丢失', mismatch: '下上错配',
  'concept-confusion': '概念混淆', 'missing-prereq': '缺前置知识', careless: '粗心',
}
export const ATTRIBUTIONS = Object.keys(ATTRIBUTION_LABEL)

export const str = (description, extra = {}) => ({ type: 'string', description, ...extra })
export const strArray = (description) => ({ type: 'array', items: { type: 'string' }, description })

export const gateOf = (env) => env.gate ?? DEFAULT_GATE

export async function loadVerifications(cwd) {
  return store.readJsonl(store.paths(cwd).verifications)
}

export async function saveKp(env, kp) {
  kp.phase = kpPhase(kp)
  kp.updatedAt = env.now().toISOString()
  await store.writeJson(store.paths(env.cwd).kp(kp.id), kp)
}

/** Next free example id on a model; counting would reuse the id of a removed example. */
export function nextExampleId(model) {
  const used = model.targetMap.examples.map((e) => Number(/-e(\d+)$/.exec(e.id)?.[1] ?? 0))
  return `${model.id}-e${Math.max(0, ...used) + 1}`
}

/** Recompute stored mastery for every model of one knowledge point. */
export function refreshMastery(kp, verifications, gate) {
  const own = verifications.filter((v) => v.kpId === kp.id)
  for (const model of kp.models) {
    model.mastery = modelMastery(model, own.filter((v) => v.modelId === model.id), gate)
    if (model.phase === 'mastered' && !meetsGate(model.mastery)) model.phase = 'assess'
  }
  kp.mastery = kpMastery(kp, verifications, gate)
  if (kp.kind === 'information' && kp.phase === 'mastered' && !meetsGate(kp.mastery)) kp.phase = 'memorize'
  if (kp.kind !== 'information') kp.phase = kpPhase(kp)
}

/** Recompute information coverage on read too: old multi-fact records may overstate mastery. */
export async function learningKps(env) {
  const kps = await store.listKps(env.cwd)
  const verifications = await loadVerifications(env.cwd)
  for (const kp of kps) refreshMastery(kp, verifications, gateOf(env))
  return kps
}

export function currentKp(course, kps) {
  const byId = new Map(kps.map((kp) => [kp.id, kp]))
  const visit = (id, seen = new Set()) => {
    const kp = byId.get(id)
    if (!kp || kp.phase === 'mastered' || kp.skipped) return null
    if (seen.has(id)) throw new Error(`cyclic prerequisites: ${id}`)
    const path = new Set([...seen, id])
    for (const dep of kp.prerequisites ?? []) {
      const next = visit(dep, path)
      if (next) return next
    }
    return kp
  }
  for (const ch of course.chapters) {
    for (const id of ch.kpIds) {
      const kp = visit(id)
      if (kp) return kp
    }
  }
  return null
}

export function describeModel(m) {
  return m.type === 'discriminative' ? `判别「${m.concept}」` : `联结「${m.input}」→「${m.output}」`
}

/** What is left before the next level, for the tutor. */
export function progressText(progress) {
  if (!progress) return ''
  const parts = []
  if (progress.streak && progress.streak.have < progress.streak.need) parts.push(`再连续答对 ${progress.streak.need - progress.streak.have} 题（无提示、不是蒙的）`)
  for (const t of progress.missing) parts.push(t === 'own-pos' ? '用户自己举一个正例' : t === 'own-neg' ? '用户自己举一个反例' : `答对一道 ${t}`)
  const name = LEVEL_LABEL[progress.target]
  return parts.length ? `离「${name}」还差：${parts.join('、')}。` : ''
}
