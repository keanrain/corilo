// The renderer must work without the plugin, browser storage, or a DSH session.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ROOT, quizLibrary } from '../src/quiz/library.js'
import { PLAY_EXAMPLES } from '../src/quiz/examples.js'

test('all four plays render through the standalone interface without the DSH adapter', async () => {
  const result = await build({
    entryPoints: [new URL('../src/client/exercise.js', import.meta.url).pathname],
    bundle: true, write: false, metafile: true, platform: 'node', format: 'cjs',
    define: { 'process.env.NODE_ENV': '"production"' },
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    plugins: [{
      name: 'quiz-schema',
      setup(builder) {
        builder.onResolve({ filter: /^virtual:quiz-schema$/ }, () => ({ path: 'schema', namespace: 'virtual' }))
        builder.onLoad({ filter: /^schema$/, namespace: 'virtual' }, () => ({
          contents: JSON.stringify({ root: ROOT, jsonSchema: quizLibrary().toJSONSchema() }), loader: 'json',
        }))
      },
    }],
  })
  for (const file of Object.keys(result.metafile.inputs)) {
    assert.doesNotMatch(file, /src\/host\/|src\/client\/(main|quiz)\.js|src\/quiz\/answer\.js/, file)
  }
  const module = { exports: {} }
  runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: createRequire(import.meta.url) })
  for (const example of PLAY_EXAMPLES) {
    const html = renderToStaticMarkup(createElement(module.exports.Exercise, {
      view: example.view, onChange() {}, onAction() {},
    }))
    assert.ok(html.includes(`data-play="${example.id}"`), example.id)
    assert.match(html, /<textarea/, example.id)
    assert.match(html, /disabled=""[^>]*>提交作答/, 'an untouched exercise cannot submit')
  }
  const practice = renderToStaticMarkup(createElement(module.exports.Exercise, {
    view: { ...PLAY_EXAMPLES[0].view, purpose: 'practice' }, onChange() {}, onAction() {},
  }))
  assert.match(practice, /class="la-eyebrow">理解练习</)
})
