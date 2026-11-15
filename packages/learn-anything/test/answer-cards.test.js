import { test } from 'node:test'
import assert from 'node:assert/strict'
import { answerParts, registerAnswerCards } from '../src/client/answer.js'
import { marker, parseView, withCardReference } from '../src/host/render.js'

const view = { view: 'outline', goal: '路线', chapters: [] }
const entries = [{ callId: 'call/1', view }, { callId: 'quiz', view: { view: 'quiz' } }]
const ref = '[路线](learn-card:call%2F1)'

test('answer cards retain native reasoning and image child slots around inline cards', () => {
  const children = {
    'conversation.chat.reasoning.body': { kind: 'single', scope: 'session' },
    'conversation.chat.message.images': { kind: 'single', scope: 'session' },
  }
  const original = { options: { key: 'assistant-step', children }, component: () => null }
  let options, Component
  registerAnswerCards({ slots: {
    inject: (_name, callback) => callback(), entries: () => [original],
    register: (registered, component) => { options = registered; Component = component },
  } }, (view) => view)
  assert.deepEqual(options.children, children)
  const renderSlot = () => null
  const props = { renderSlot, useTurnData: () => ({ views: entries }), turnProcess: { spec: { answerStep: 1 } },
    node: { data: { step: 1, status: 'settled', blocks: [
      { kind: 'reasoning', text: '推理' }, { kind: 'text', text: `正文\n\n${ref}\n\n后文` },
      { kind: 'image', attachment: { id: 'image' } },
    ] } },
  }
  const rendered = Component(props)
  const native = rendered.props.children.filter((element) => element.type === original.component)
  assert.equal(native.length, 2)
  assert.ok(native.every((element) => element.props.renderSlot === renderSlot))
  assert.equal(native[0].props.node.data.blocks[0].kind, 'reasoning')
  assert.equal(native[1].props.node.data.blocks.at(-1).kind, 'image')
})

test('only valid read-only references in standalone paragraphs become cards', () => {
  assert.deepEqual(answerParts(`前文\n\n${ref}\n\n后文`, entries).map((part) => part.view ?? part.text), ['前文\n\n', view, '\n后文'])
  for (const text of [
    `[不存在](learn-card:unknown)`, '[题卡](learn-card:quiz)',
    `行内 ${ref}`, `> ${ref}`, `- ${ref}`, `    ${ref}`,
    `前文\n${ref}`, `${ref}\n后文`,
    `\`\`\`md\n\n${ref}\n\n\`\`\``, `~~~~\n\n${ref}\n\n~~~\n\n${ref}\n\n~~~~`,
  ]) assert.deepEqual(answerParts(text, entries), [{ text }], text)
  assert.equal(answerParts(`\`\`\`\n${ref}\n\`\`\`\n\n${ref}`, entries).at(-1).view, view)
  assert.equal(answerParts(ref.slice(0, -1), entries).some((part) => part.view), false)
})

test('tool references retain the validated payload and exclude interactive cards', () => {
  const source = marker(view) + '\n导师私有参考'
  const output = withCardReference(source, 'call/1')
  assert.deepEqual(parseView(output), view)
  assert.ok(output.endsWith('[学习路线](learn-card:call%2F1)'))
  assert.match(output, /最终回答/)
  assert.equal(withCardReference(marker({ view: 'quiz' }), 'quiz'), marker({ view: 'quiz' }))
  assert.equal(withCardReference('已更新', 'call'), '已更新')
  assert.equal(withCardReference(source), source)
})
