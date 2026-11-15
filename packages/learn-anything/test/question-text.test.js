import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { InlineText, QuestionText } from '../src/client/question-text.js'

test('question copy preserves paragraphs, condition order and explicit emphasis', () => {
  const html = renderToStaticMarkup(createElement(QuestionText, {
    text: '现场观察\r\n\r\n**已知条件**\n- 帧率 **60 fps**\n- 对照 `timestamp`\n3. 保留第三项\n5. 保留第五项',
  }))
  assert.match(html, /<p>.*现场观察.*<\/p>/)
  assert.match(html, /<strong>已知条件<\/strong>/)
  assert.match(html, /<ul><li>.*<strong>60 fps<\/strong>.*<\/li><li>.*<code>timestamp<\/code>.*<\/li><\/ul>/)
  assert.match(html, /<ol><li value="3">.*第三项.*<\/li><li value="5">.*第五项.*<\/li><\/ol>/)
})

test('plain, partial and HTML-like question copy remains safe text', () => {
  const html = renderToStaticMarkup(createElement(QuestionText, {
    text: '<img src=x onerror=alert(1)>\n**还在生成\n`未闭合\n[链接](javascript:alert(1))',
  }))
  assert.match(html, /&lt;img/)
  assert.match(html, /\*\*还在生成/)
  assert.match(html, /`未闭合/)
  assert.doesNotMatch(html, /<img|<a|<script/)
  assert.doesNotThrow(() => renderToStaticMarkup(createElement(QuestionText)))
  assert.equal(renderToStaticMarkup(createElement(InlineText, { text: 0 })), '<span class="la-inline">0</span>')
})
