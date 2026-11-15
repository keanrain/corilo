/**
 * Mastery is measured by how reliably the learner handles NEW situations,
 * never by "has read it". Levels: none < novice < proficient < expert.
 * @module learn-anything/mastery
 */

export const LEVELS = ['none', 'novice', 'proficient', 'expert']
export const LEVEL_LABEL = { none: '未入门', novice: '入门', proficient: '熟练', expert: '精通' }

/** Question types the examiner may use. `recall` is only for information. */
export const QUESTION_TYPES = [
  'scenario', // 场景题：新情境下应用
  'predict', // 预测题：给输入推输出
  'discriminate-pos', // 判别题，答案为"是 A"
  'discriminate-neg', // 判别题，答案为"不是 A"（反例判别）
  'contrast', // 对比辨析
  'rephrase', // 换说法提问（防记言代学）
  'own-examples', // 让用户自己举正反例
  'transfer', // 跨情境 / 组合
  'recall', // 记忆：填空、复述、闪卡
]

export const DEFAULT_GATE = {
  /** Consecutive recent correct, unhinted novel answers needed for proficient. */
  streak: 3,
  /** Question types a proficient learner must have answered correctly at least once. */
  requiredTypes: ['discriminate-neg', 'rephrase'],
  /** Correct recalls in a row for information to count as proficient. */
  recallStreak: 2,
}

/** A correct answer that needed no hint and was not a guess: the only kind that proves mastery. */
export const clean = (v) => v.verdict === 'correct' && (v.questionType === 'recall' || v.novel !== false) && (v.hintsUsed ?? 0) === 0 && v.confidence !== 'guess'
export const verified = (v) => v.evidence?.version === 1 && typeof v.evidence.sessionId === 'string' &&
  v.evidence.sessionId.length > 0 && Number.isInteger(v.evidence.messageSeq) && Number.isInteger(v.evidence.questionSeq) &&
  v.evidence.questionSeq >= 0 && v.evidence.messageSeq > v.evidence.questionSeq && /^[a-f0-9]{64}$/u.test(v.evidence.examinerDigest ?? '')

/**
 * Mastery of one knowledge model.
 * @param model - the model (its user-origin examples feed the expert check)
 * @param verifications - this model's verification records, oldest first
 */
export function modelMastery(model, verifications, gate = DEFAULT_GATE) {
  const novel = verifications.filter((v) => verified(v) && v.novel !== false && v.questionType !== 'recall')
  if (!novel.some((v) => v.verdict === 'correct')) return 'none'
  const recent = novel.slice(-gate.streak)
  const streakOk = recent.length >= gate.streak && recent.every(clean)
  const typesOk = gate.requiredTypes.every((t) => novel.some((v) => v.questionType === t && clean(v)))
  if (!streakOk || !typesOk) return 'novice'
  const transferOk = novel.some((v) => v.questionType === 'transfer' && clean(v))
  const own = (model.targetMap?.examples ?? []).filter((e) => e.origin === 'user' && e.checked)
  const ownOk = own.some((e) => e.polarity === 'pos') && own.some((e) => e.polarity === 'neg')
  return transferOk && ownOk ? 'expert' : 'proficient'
}

/** Old cards did not have ids; keep their position-based ids stable when first read. */
export function factsWithIds(kp) {
  return (kp.facts ?? []).map((fact, i) => ({ ...fact, id: fact.id ?? `fact-${i + 1}` }))
}

/** A single old card can still use old unlabelled recalls; multi-card answers need an explicit id. */
export function factMasteries(verifications, gate, facts) {
  return facts.map((fact) => {
    const own = verifications.filter((v) => verified(v) && v.questionType === 'recall' &&
      (v.factId === fact.id || (!v.factId && facts.length === 1 && fact.id === 'fact-1')))
    if (!own.some((v) => v.verdict === 'correct')) return 'none'
    const recent = own.slice(-gate.recallStreak)
    return recent.length >= gate.recallStreak && recent.every(clean) ? 'proficient' : 'novice'
  })
}

/** Every fact must pass independently. */
export function informationMastery(verifications, gate = DEFAULT_GATE, facts = [{ id: 'fact-1' }]) {
  if (!facts.length) return 'none'
  return LEVELS[Math.min(...factMasteries(verifications, gate, facts).map((level) => LEVELS.indexOf(level)))]
}

/** A knowledge point is only as strong as its weakest model. */
export function kpMastery(kp, verifications, gate = DEFAULT_GATE) {
  const own = verifications.filter((v) => v.kpId === kp.id)
  if (kp.kind === 'information') return informationMastery(own, gate, factsWithIds(kp))
  if (kp.models.length === 0) return 'none'
  let min = LEVELS.length - 1
  for (const model of kp.models) {
    const level = modelMastery(model, own.filter((v) => v.modelId === model.id), gate)
    min = Math.min(min, LEVELS.indexOf(level))
  }
  return LEVELS[min]
}

export function meetsGate(level) {
  return LEVELS.indexOf(level) >= LEVELS.indexOf('proficient')
}
