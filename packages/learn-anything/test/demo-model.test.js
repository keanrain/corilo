import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateDemo, demoDefaults, demoStep } from '../src/quiz/demo.js'
import { quizShowTool } from '../src/host/quiz.js'
import { parseView } from '../src/host/render.js'

export const thermostat = {
  kind: 'state-machine', title: '温控器', scope: '固定阈值模型，未模拟热惯性', initial: 'off',
  inputs: [{ id: 'temperature', label: '温度', type: 'number', min: 0, max: 40, step: 1, initial: 22 }],
  states: [{ id: 'off', label: '关闭', output: '不加热' }, { id: 'on', label: '开启', output: '加热中' }],
  transitions: [{ from: 'off', to: 'on', label: '低于20度', when: [{ input: 'temperature', op: 'lt', value: 20 }] }, { from: 'on', to: 'off', label: '达到20度', when: [{ input: 'temperature', op: 'gte', value: 20 }] }],
}
const gate = {
  kind: 'state-machine', title: '逻辑与门', scope: '两个开关都闭合才导通', initial: 'closed',
  inputs: [{ id: 'first', label: '开关一', type: 'toggle', initial: false }, { id: 'second', label: '开关二', type: 'toggle', initial: false }],
  states: [{ id: 'closed', label: '截止', output: '无信号' }, { id: 'open', label: '导通', output: '有信号' }],
  transitions: [{ from: 'closed', to: 'open', label: '全部闭合', when: [{ input: 'first', op: 'eq', value: true }, { input: 'second', op: 'eq', value: true }] }],
}

test('numeric causal model moves in both directions at the exact boundary', () => {
  const model = validateDemo(thermostat)
  assert.equal(demoStep(model, 'off', demoDefaults(model)).status, 'unchanged')
  assert.equal(demoStep(model, 'off', { temperature: 19 }).state, 'on')
  assert.equal(demoStep(model, 'on', { temperature: 20 }).state, 'off')
})
test('a different domain combines multiple boolean inputs without code', () => {
  const model = validateDemo(gate)
  assert.equal(demoStep(model, 'closed', { first: true, second: false }).state, 'closed')
  assert.equal(demoStep(model, 'closed', { first: true, second: true }).state, 'open')
  const ambiguous = validateDemo({ ...gate, transitions: [...gate.transitions, ...gate.transitions] })
  assert.deepEqual(demoStep(ambiguous, 'closed', { first: true, second: true }), { state: 'closed', status: 'ambiguous' })
})
test('host passes a validated demo, legacy remains valid, malformed models are rejected', async () => {
  const quiz = { ui: 'root = Quiz("观察", "predict", [Choice("会怎样？", ["甲", "乙"])])', question: '会怎样？' }
  const result = parseView(await quizShowTool.execute({ ...quiz, helpDemo: thermostat }))
  assert.deepEqual(result.helpDemo, thermostat)
  for (const invalid of [
    { ...thermostat, initial: 'missing' },
    { ...thermostat, inputs: [{ ...thermostat.inputs[0], id: '__proto__' }] },
    { ...thermostat, inputs: [{ ...thermostat.inputs[0], max: Infinity }] },
    { ...thermostat, transitions: [{ ...thermostat.transitions[0], when: [{ input: 'temperature', op: 'eval', value: 'process.exit()' }] }] },
    { ...thermostat, transitions: [{ ...thermostat.transitions[0], to: 'missing' }] },
    { ...thermostat, states: Array(17).fill(thermostat.states[0]) },
  ]) await assert.rejects(quizShowTool.execute({ ...quiz, helpDemo: invalid }), /Invalid helpDemo/)
  assert.throws(() => demoStep(validateDemo(thermostat), 'off', { temperature: 41 }), /input value/)
  assert.equal(validateDemo('execution-waiting'), 'execution-waiting')
  const clean = validateDemo({ ...thermostat, script: 'process.exit()' })
  assert.equal(clean.script, undefined)
})
