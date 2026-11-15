/**
 * Spaced review with FSRS. One card per knowledge model, one per information point.
 * A due knowledge card is reviewed with a NEW situation question, never by repeating an old one.
 * @module learn-anything/review
 */
import { fsrs, createEmptyCard, Rating } from 'ts-fsrs'

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
