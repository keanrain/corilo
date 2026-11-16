/**
 * Spaced review with FSRS. One card per knowledge model, one per information point.
 * A due knowledge card is reviewed with a NEW situation question, never by repeating an old one.
 * @module learn-anything/review
 */
import { fsrs, createEmptyCard, Rating } from 'ts-fsrs'
import { verified as trustedVerification } from './mastery.js'

// No minute-scale learning steps: relearning within a session is the tutor's diagnose→verify loop,
// so every interval is at least a day.
const scheduler = fsrs({ enable_short_term: false })

/** Map a verification outcome to an FSRS rating. */
export function ratingFor({ verdict, hintsUsed = 0, explainedRule = false, confidence }) {
  if (verdict === 'wrong') return Rating.Again
  if (verdict === 'partial' || hintsUsed > 0 || confidence === 'guess') return Rating.Hard
  return explainedRule ? Rating.Easy : Rating.Good
}

export const RATING_LABEL = { [Rating.Again]: 'again', [Rating.Hard]: 'hard', [Rating.Good]: 'good', [Rating.Easy]: 'easy' }

function revive(card) {
  return {
    ...card,
    due: new Date(card.due),
    last_review: card.last_review ? new Date(card.last_review) : undefined,
  }
}

/**
 * Grade one review target, creating its card on first sight.
 * @param reviews - `{ cards: { [targetId]: { kpId, modelId?, card } } }`, mutated in place
 */
export function grade(reviews, target, rating, now = new Date()) {
  const entry = reviews.cards[target.id] ?? { kpId: target.kpId, modelId: target.modelId, card: createEmptyCard(now) }
  const { card } = scheduler.next(revive(entry.card), now, rating)
  reviews.cards[target.id] = { ...entry, card }
  return card
}

export function emptyReviews() {
  return { version: 1, cards: {} }
}

/** Cards due at `now`, most overdue first. */
export function due(reviews, now = new Date()) {
  return Object.entries(reviews.cards)
    .map(([id, entry]) => ({ id, ...entry, due: new Date(entry.card.due) }))
    .filter((entry) => entry.due <= now)
    .sort((a, b) => a.due - b.due)
}

/** Retain history on disk, but only schedule targets that still belong to the current course. */
export function activeReviews(reviews, course, kps) {
  const ids = new Set((course?.chapters ?? []).flatMap((chapter) => chapter.kpIds))
  const byId = new Map(kps.filter((kp) => ids.has(kp.id)).map((kp) => [kp.id, kp]))
  return { ...reviews, cards: Object.fromEntries(Object.entries(reviews.cards).filter(([, entry]) => {
    const kp = byId.get(entry.kpId)
    if (!kp || kp.skipped) return false
    return kp.kind === 'information' ? !entry.modelId : kp.models.some((model) => model.id === entry.modelId)
  })) }
}

/** Reuse checked examples as relearning references, never rewrite their historical evidence. */
export function forgottenExamples(model, records, excludeId, limit = 3) {
  const verified = new Set(records.filter((record) => record.id !== excludeId && record.verdict === 'correct' && trustedVerification(record) && record.modelId === model.id).map((record) => record.id))
  return (model.targetMap?.examples ?? []).filter((example) => example.tag === 'v' && example.checked && verified.has(example.verificationId))
    .slice(-limit).map((example) => ({ id: example.id, verificationId: example.verificationId, input: example.input, output: example.output, polarity: example.polarity, sources: example.sources ?? [] }))
}

export function examplePracticeText(examples) {
  return '例习循环：以下是以前验证过的旧例子，可用于对比复盘或请考官生成变体；旧例重做仅作理解练习（quiz_show 的 purpose 设为 practice），不得当成新情况提升掌握度。正式验证仍须另出实质新情境。\n' + JSON.stringify({ purpose: 'relearning-reference', examples }, null, 2)
}
