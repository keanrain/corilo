import { test } from 'node:test'
import assert from 'node:assert/strict'
import { partialJson, outlinePreview } from '../src/client/stream.js'

test('outline previews tolerate every prefix, including escaped text, unicode and nested arrays', () => {
  const input = { goal: 'Java "全栈"\n学习', status: 'planning', chapters: [
    { title: '线程池', kps: [{ id: 'kp1', title: '核心线程\\任务', kind: 'knowledge', estMinutes: 30 }] },
    { title: '队列', kps: [{ id: 'kp2', title: '拒绝策略', kind: 'knowledge' }] },
  ], resources: [{ title: 'Java 官方文档', url: 'https://example.com', note: '线程池' }] }
  const raw = JSON.stringify(input).replace('全', '\\u5168')
  for (let end = 0; end <= raw.length; end++) {
    const value = partialJson(raw.slice(0, end))
    const preview = outlinePreview(value)
    if (end >= raw.indexOf(',"status"')) assert.ok(preview, `preview disappeared at ${end}`)
    if (preview) {
      assert.ok(input.goal.startsWith(preview.goal), `bad text at ${end}`)
      assert.ok(preview.chapters.length <= 2)
      for (const ch of preview.chapters) assert.ok(Array.isArray(ch.kps))
    }
  }
  assert.deepEqual(JSON.parse(JSON.stringify(partialJson(raw))), input)
  assert.equal(outlinePreview(partialJson(raw)).resources[0].title, 'Java 官方文档')
})

test('invalid or differently typed data never becomes a broken outline preview', () => {
  assert.equal(partialJson('{"goal":"bad\\q"}'), undefined)
  assert.equal(partialJson('{"goal":???}'), undefined)
  assert.equal(outlinePreview({ goal: 12 }), null)
  assert.deepEqual(outlinePreview({ goal: '目标', chapters: null }).chapters, [])
  const preview = outlinePreview({ goal: '目标', chapters: [null, { kps: [null, { title: '有效' }] }] })
  assert.equal(preview.chapters[1].kps[0].title, '有效')
})
