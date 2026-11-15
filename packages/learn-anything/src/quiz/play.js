/**
 * Pure helpers for the four play answer forms (Counterexample, MinimalChange,
 * DualPredict, TransferTask). They only decide whether a value is complete and how it
 * reads in the learner's answer message; they never judge whether the answer is
 * semantically right. No browser, host, or DSH dependency.
 */

const nonblank = (value) => typeof value === 'string' && value.trim().length > 0

const usableList = (value, minimum) => Array.isArray(value) && value.length >= minimum && value.every(nonblank)

const indexIn = (value, length) => Number.isInteger(value) && value >= 0 && value < length

/**
 * Whether a play answer can be submitted. Index 0 is valid; null, a non-integer, or an
 * index outside the candidate list is not. Free text must be non-blank.
 * @param {'Counterexample'|'MinimalChange'|'DualPredict'|'TransferTask'} type
 * @param {Record<string, unknown>} props
 * @param {unknown} value
 * @returns {boolean}
 */
export function playAnswerComplete(type, props, value) {
  if (!props || typeof props !== 'object' || !Array.isArray(value)) return false
  switch (type) {
    case 'Counterexample': {
      const [caseIndex, reason] = value
      return usableList(props.cases, 2) && indexIn(caseIndex, props.cases.length) && nonblank(reason)
    }
    case 'MinimalChange': {
      const [conditionIndex, replacement, reason] = value
      return usableList(props.conditions, 2) && indexIn(conditionIndex, props.conditions.length) && nonblank(replacement) && nonblank(reason)
    }
    case 'DualPredict': {
      const [beforeIndex, afterIndex, reason] = value
      return usableList(props.options, 2) && indexIn(beforeIndex, props.options.length) && indexIn(afterIndex, props.options.length) && nonblank(reason)
    }
    case 'TransferTask': {
      const [plan, reason] = value
      return nonblank(plan) && nonblank(reason)
    }
    default:
      return false
  }
}

/**
 * The answer's readable text for the 【作答】 message. Empty when the value is
 * incomplete or out of range, so a malformed answer is never presented as complete.
 * @param {'Counterexample'|'MinimalChange'|'DualPredict'|'TransferTask'} type
 * @param {Record<string, unknown>} props
 * @param {unknown} value
 * @returns {string}
 */
export function playAnswerText(type, props, value) {
  if (!playAnswerComplete(type, props, value)) return ''
  switch (type) {
    case 'Counterexample': {
      const [caseIndex, reason] = value
      return `选中案例：${props.cases[caseIndex].trim()}；理由：${reason.trim()}`
    }
    case 'MinimalChange': {
      const [conditionIndex, replacement, reason] = value
      return `把「${props.conditions[conditionIndex].trim()}」改为「${replacement.trim()}」；理由：${reason.trim()}`
    }
    case 'DualPredict': {
      const [beforeIndex, afterIndex, reason] = value
      return `变化前：${props.options[beforeIndex].trim()}；变化后：${props.options[afterIndex].trim()}；理由：${reason.trim()}`
    }
    case 'TransferTask': {
      const [plan, reason] = value
      return `方案：${plan.trim()}；理由：${reason.trim()}`
    }
    default:
      return ''
  }
}
