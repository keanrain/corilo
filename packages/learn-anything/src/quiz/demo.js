/** Bounded declarative demonstrations. No expressions, scripts, network or grading. */
const key = /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/
const ops = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte']
const fail = (text) => { throw new Error(`Invalid helpDemo: ${text}`) }
const text = (value, name, max = 600) => typeof value === 'string' && value.trim() && value.length <= max ? value : fail(name)
const list = (value, name, max) => Array.isArray(value) && value.length > 0 && value.length <= max ? value : fail(name)
const id = (value) => typeof value === 'string' && key.test(value) && !['constructor', 'prototype', '__proto__'].includes(value) ? value : fail('id')

export function validateDemo(value) {
  if (value === undefined || value === 'execution-waiting') return value
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Unknown helpDemo')
  if (value.kind !== 'state-machine') fail('kind must be state-machine')
  const inputs = list(value.inputs, 'inputs (1–8)', 8).map((input) => {
    const result = { id: id(input.id), label: text(input.label, 'input label', 120), type: input.type }
    if (input.type === 'toggle') {
      if (typeof input.initial !== 'boolean') fail('toggle initial')
      return { ...result, initial: input.initial }
    }
    if (input.type !== 'number') fail('input type')
    const { min, max, step = 1, initial } = input
    if (![min, max, step, initial].every(Number.isFinite) || min >= max || step <= 0 || initial < min || initial > max || (max - min) / step > 10000) fail('number range')
    return { ...result, min, max, step, initial }
  })
  if (new Set(inputs.map((input) => input.id)).size !== inputs.length) fail('duplicate input')
  const states = list(value.states, 'states (1–16)', 16).map((state) => ({ id: id(state.id), label: text(state.label, 'state label', 120), output: text(state.output, 'state output') }))
  const stateIds = new Set(states.map((state) => state.id))
  if (stateIds.size !== states.length || !stateIds.has(value.initial)) fail('initial or duplicate state')
  const transitions = list(value.transitions, 'transitions (1–32)', 32).map((transition) => {
    if (!stateIds.has(transition.from) || !stateIds.has(transition.to)) fail('unknown transition state')
    const when = list(transition.when, 'conditions (1–8)', 8).map((condition) => {
      const input = inputs.find((input) => input.id === condition.input)
      if (!input || !ops.includes(condition.op) || typeof condition.value !== (input.type === 'toggle' ? 'boolean' : 'number') || (typeof condition.value === 'number' && !Number.isFinite(condition.value))) fail('condition')
      if (input.type === 'toggle' && !['eq', 'ne'].includes(condition.op)) fail('toggle comparison')
      return { input: input.id, op: condition.op, value: condition.value }
    })
    return { from: transition.from, to: transition.to, label: text(transition.label, 'transition label', 120), when }
  })
  return { kind: 'state-machine', title: text(value.title, 'title', 120), scope: text(value.scope, 'scope'), initial: value.initial, inputs, states, transitions }
}

export function demoDefaults(config) {
  return Object.fromEntries(config.inputs.map((input) => [input.id, input.initial]))
}

/** A single explicit step; ambiguous matching transitions never silently pick a winner. */
export function demoStep(config, state, values) {
  for (const input of config.inputs) {
    const value = values[input.id]
    if (input.type === 'toggle' ? typeof value !== 'boolean' : !Number.isFinite(value) || value < input.min || value > input.max) fail('input value')
  }
  if (!config.states.some((item) => item.id === state)) fail('current state')
  const compare = { eq: (a, b) => a === b, ne: (a, b) => a !== b, lt: (a, b) => a < b, lte: (a, b) => a <= b, gt: (a, b) => a > b, gte: (a, b) => a >= b }
  const matches = config.transitions.filter((transition) => transition.from === state && transition.when.every((condition) => compare[condition.op](values[condition.input], condition.value)))
  return matches.length === 1 ? { state: matches[0].to, transition: matches[0].label, status: 'advanced' } : { state, status: matches.length ? 'ambiguous' : 'unchanged' }
}
