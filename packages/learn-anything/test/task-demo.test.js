import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { buildSync } from 'esbuild'
import * as React from 'react'

const result = buildSync({ entryPoints: ['src/client/task-demo.js'], bundle: true, write: false, metafile: true, platform: 'node', format: 'cjs', external: ['react'] })
const require = createRequire(import.meta.url)
function demo(config, generic = false) {
  let cursor = 0, disabled = false
  const states = [], events = []
  const runtime = { ...React, useState(initial) {
    const index = cursor++
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
    return [states[index], (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next }]
  } }
  const module = { exports: {} }
  runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: (name) => name === 'react' ? runtime : require(name) })
  return { events, set disabled(value) { disabled = value }, render() {
    cursor = 0
    let tree = module.exports[generic ? 'StateMachineDemo' : 'TaskDemo']({ config: config ?? { title: '只看任务的位置' }, disabled, onAction: (event) => events.push(JSON.parse(JSON.stringify(event))) })
    while (typeof tree?.type === 'function') tree = tree.type(tree.props)
    return tree
  } }
}
function elements(tree) {
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(elements)]
}
const button = (tree, name) => elements(tree).find((node) => node.type === 'button' && (node.props['aria-label'] === name || [node.props.children].flat(Infinity).includes(name)))
const received = (tree, name) => button(tree, name).props['data-received']

test('the demo stays independent and contrasts executing with waiting without duplicate tasks', () => {
  assert.deepEqual(Object.keys(result.metafile.inputs).sort(), ['src/client/task-demo.js', 'src/quiz/demo.js', 'src/client/locale.js', 'src/client/ui-en.json'].sort())
  const app = demo()
  button(app.render(), '放入一个任务').props.onClick()
  assert.equal(received(app.render(), '执行区'), true)
  assert.equal(received(app.render(), '等待区'), false)
  assert.deepEqual(app.events.at(-1), { type: 'place', mode: 'available', destination: 'execution' })
  button(app.render(), '任务已放入').props.onClick()
  assert.equal(app.events.filter((e) => e.type === 'place').length, 1)
  button(app.render(), '执行位全部在忙').props.onClick()
  assert.equal(button(app.render(), '放入一个任务').props.disabled, false)
  button(app.render(), '放入一个任务').props.onClick()
  assert.equal(received(app.render(), '等待区'), true)
  assert.deepEqual(app.events.at(-1), { type: 'place', mode: 'busy', destination: 'waiting' })
  assert.equal(elements(app.render()).filter((node) => node.props.className === 'la-demo-token' && node.props['data-new']).length, 1)
  assert.ok(JSON.stringify(app.render()).includes('还没有开始处理'))
  button(app.render(), '等待区').props.onClick()
  assert.deepEqual(app.events.at(-1), { type: 'inspect', area: 'waiting' })
  button(app.render(), '重新试一次').props.onClick()
  assert.equal(button(app.render(), '放入一个任务').props.disabled, false)
  button(app.render(), '回到题目').props.onClick()
  assert.deepEqual(app.events.at(-1), { type: 'return' })
})

test('disabled demos prevent actual edits, while return remains available', () => {
  const app = demo()
  app.disabled = true
  for (const name of ['有空闲执行位', '执行位全部在忙', '执行区', '等待区', '放入一个任务', '重新试一次']) {
    const control = button(app.render(), name)
    assert.equal(control.props.disabled, true, name)
    control.props.onClick()
  }
  assert.deepEqual(app.events, [])
  assert.equal(received(app.render(), '执行区'), false)
  button(app.render(), '回到题目').props.onClick()
  assert.deepEqual(app.events, [{ type: 'return' }])
})

const machine = {
  kind: 'state-machine', title: '温控观察', scope: '只观察阈值', initial: 'off',
  inputs: [{ id: 'temperature', label: '温度', type: 'number', min: 0, max: 40, initial: 22 }],
  states: [{ id: 'off', label: '关闭', output: '不加热' }, { id: 'on', label: '开启', output: '加热中' }],
  transitions: [{ from: 'off', to: 'on', label: '低于20度', when: [{ input: 'temperature', op: 'lt', value: 20 }] }],
}
test('generic controls drive the graph and output, reset, and respect disabled state', () => {
  const app = demo(machine, true)
  const slider = () => elements(app.render()).find((node) => node.type === 'input')
  slider().props.onChange({ target: { value: '19' } })
  button(app.render(), '推进一步').props.onClick()
  assert.equal(elements(app.render()).find((node) => node.props.role === 'status').props.children[0], '开启：加热中')
  assert.equal(elements(app.render()).find((node) => node.props['aria-current'] === 'step').props.children[0].props.children, '开启')
  button(app.render(), '重新试一次').props.onClick()
  assert.equal(slider().props.value, 22)
  const count = app.events.length
  app.disabled = true
  slider().props.onChange({ target: { value: '19' } })
  button(app.render(), '推进一步').props.onClick()
  button(app.render(), '重新试一次').props.onClick()
  assert.equal(app.events.length, count)
  assert.equal(slider().props.disabled, true)
  button(app.render(), '回到题目').props.onClick()
  assert.deepEqual(app.events.at(-1), { type: 'return' })
})
