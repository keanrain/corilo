import { test } from 'node:test'
import assert from 'node:assert/strict'
import { performanceTiming } from '../eval/metrics.js'

const event = (sessionId, type, time, data = {}) => ({ sessionId, type, time, data: { turn: 1, step: 1, ...data } })
const stream = (time) => [{ type: 'text-chunks', time0: time, index: 0, dt: [], texts: ['answer'] }]

test('performance timing isolates sessions and pairs each tool with its actual result', () => {
  const events = [event('tutor', 'step/start', 100),
    event('tutor', 'assistant/message', 400, { stream: stream(200) }),
    event('tutor', 'tool/call', 450, { callId: 'same', name: 'examiner' }),
    event('tutor', 'tool/result', 1000, { message: { toolCallId: 'same' } })]
  const children = [event('child', 'step/start', 500),
    event('child', 'assistant/message', 800, { stream: stream(550) }),
    event('child', 'tool/call', 810, { callId: 'same', name: 'material_read' }),
    event('child', 'tool/result', 850, { message: { toolCallId: 'same', isError: true } })]
  const timing = performanceTiming(events, children)
  assert.deepEqual(timing.models.map(({ sessionId, stepToMessageMs, firstTokenMs, decodeMs }) =>
    ({ sessionId, stepToMessageMs, firstTokenMs, decodeMs })), [
    { sessionId: 'tutor', stepToMessageMs: 300, firstTokenMs: 100, decodeMs: 200 },
    { sessionId: 'child', stepToMessageMs: 300, firstTokenMs: 50, decodeMs: 250 },
  ])
  assert.deepEqual(timing.tools.map(({ sessionId, callId, durationMs, error }) => ({ sessionId, callId, durationMs, error })), [
    { sessionId: 'tutor', callId: 'same', durationMs: 550, error: false },
    { sessionId: 'child', callId: 'same', durationMs: 40, error: true },
  ])
})

test('performance timing does not invent missing or ambiguous measurements', () => {
  const timing = performanceTiming([
    event('s', 'step/start', 100),
    event('s', 'tool/call', 110, { callId: 'pending', name: 'read' }),
    event('s', 'assistant/message', 500, { stream: stream(450) }),
    event('s', 'assistant/message', 600),
    event('s', 'tool/result', 50, { message: { toolCallId: 'pending' } }),
    event(null, 'step/start', 100), event(null, 'assistant/message', 900),
    event(null, 'tool/call', 100, { callId: 'unknown', name: 'read' }),
    event(null, 'tool/result', 200, { message: { toolCallId: 'unknown' } }),
  ], [event('other', 'assistant/message', 700),
    event('other', 'tool/call', 710, { callId: 'unsettled', name: 'read' })])
  assert.ok(timing.models.every((model) => model.stepToMessageMs === null && model.firstTokenMs === null))
  assert.equal(timing.models[0].decodeMs, 50, 'stream-based decoding remains measured independently of tools')
  assert.ok(timing.models.slice(1).every((model) => model.decodeMs === null))
  assert.ok(timing.tools.every((tool) => tool.durationMs === null))
  assert.equal(timing.tools.at(-1).error, null, 'missing result is not a successful call')
})

test('performance timing separates retry settlements and never attributes retry backoff to decoding', () => {
  const timing = performanceTiming([
    event('s', 'step/start', 100), event('s', 'assistant/attempt', 200, { stream: stream(150) }),
    event('s', 'llm/retry', 210), event('s', 'assistant/message', 1000, { stream: stream(900) }),
  ])
  assert.deepEqual(timing.models.map(({ settlement, stepToMessageMs, firstTokenMs, decodeMs }) =>
    ({ settlement, stepToMessageMs, firstTokenMs, decodeMs })), [
    { settlement: 'assistant/attempt', stepToMessageMs: 100, firstTokenMs: 50, decodeMs: 50 },
    { settlement: 'assistant/message', stepToMessageMs: null, firstTokenMs: null, decodeMs: 100 },
  ])
})
