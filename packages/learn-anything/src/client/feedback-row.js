import * as react from 'react'

const h = react.createElement

/**
 * Show the grading result as soon as `verification_record` returns. The tool row of a settled
 * call also renders its 练习反馈 card, so the learner sees right/wrong while the tutor is still
 * writing the next question. The final-answer reference (answer.js) stays, and it is what keeps
 * the card once the finished Turn's process folds.
 * @param Row - the plain tool row this wraps
 * @param options - `parseView(text)`, `resultText(block)` and `card(view, props)` from the client
 */
export function withFeedbackCard(Row, { parseView, resultText, card }) {
  return function FeedbackRow(props) {
    const row = h(Row, props)
    const { block } = props
    if (!block || !('kind' in block) || block.isError) return row
    const parsed = parseView(resultText(block) ?? '')
    if (parsed?.view?.view !== 'feedback') return row
    return h(react.Fragment, null, row, card(parsed.view, props))
  }
}
