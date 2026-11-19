import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as react from 'react'
import { withFeedbackCard } from '../src/client/feedback-row.js'
import { marker, parseView } from '../src/host/render.js'

const h = react.createElement
const resultText = (block) => block.content.map((item) => item.text).join('\n')
const Row = () => null
const Wrapped = withFeedbackCard(Row, { parseView: (text) => { const view = parseView(text); return view && { view } }, resultText, card: (view) => h('card', { view }) })
const feedback = { view: 'feedback', id: 'v1', verdict: 'wrong', kp: { id: 'k', title: '闭包' } }
const settled = (text, extra = {}) => ({ kind: 'result', callId: 'c1', content: [{ type: 'text', text }], ...extra })

test('a settled verification_record row also shows the feedback card at once', () => {
  const out = Wrapped({ block: settled('已记录（wrong）。' + marker(feedback)) })
  const parts = react.Children.toArray(out.props.children)
  assert.equal(parts[0].type, Row)
  assert.deepEqual(parts[1].props.view, feedback)
})

test('running, failed and non-feedback rows stay plain', () => {
  assert.equal(Wrapped({ block: { callId: 'c1', name: 'verification_record', phase: 'start' } }).type, Row)
  assert.equal(Wrapped({ block: settled('拒绝写入', { isError: true }) }).type, Row)
  assert.equal(Wrapped({ block: settled(marker({ view: 'progress' })) }).type, Row)
  assert.equal(Wrapped({ block: settled('没有卡片') }).type, Row)
  assert.equal(Wrapped({}).type, Row)
})
