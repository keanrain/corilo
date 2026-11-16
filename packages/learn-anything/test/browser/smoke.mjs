// Isolated browser smoke pages. No model calls or learner data; Ctrl-C cleans the build.
// / is the original plugin-card smoke test; /playground is a standalone page that imports
// Exercise and PLAY_EXAMPLES directly, with no plugin bundle and no DSH conversation mock.
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const out = await mkdtemp(join(tmpdir(), 'la-browser-'))

// src/client/exercise.js parses the OpenUI program against a schema generated from
// src/quiz/library.js at build time (mirrors the virtual:quiz-schema handling in
// scripts/build.mjs). The plugin keeps the schema virtual, so the standalone page
// builds it from the same quizLibrary as the product instead of a checked-in copy.
const quizSchema = {
  name: 'quiz-schema',
  setup(build) {
    build.onResolve({ filter: /^virtual:quiz-schema$/ }, () => ({ path: 'quiz-schema', namespace: 'virtual' }))
    build.onLoad({ filter: /^quiz-schema$/, namespace: 'virtual' }, async () => {
      const { ROOT, quizLibrary } = await import(new URL('../../src/quiz/library.js', import.meta.url).href)
      return { contents: JSON.stringify({ root: ROOT, jsonSchema: quizLibrary().toJSONSchema() }), loader: 'json' }
    })
  },
}

await Promise.all([
  build({ entryPoints: [new URL('./target-editor.js', import.meta.url).pathname], bundle: true, outfile: join(out, 'target-editor.js'), format: 'esm', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } }),
  build({ entryPoints: [new URL('./task-demo.js', import.meta.url).pathname], bundle: true, outfile: join(out, 'task-demo.js'), format: 'esm', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } }),
  build({ entryPoints: [new URL('./smoke.js', import.meta.url).pathname], bundle: true, outfile: join(out, 'app.js'), format: 'esm', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } }),
  build({
    entryPoints: [new URL('./playground.js', import.meta.url).pathname],
    bundle: true,
    outfile: join(out, 'playground.js'),
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"' },
    legalComments: 'none',
    plugins: [quizSchema],
  }),
])

const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>学习卡片回归验证</title><style>body{margin:0;background:#f3f4f0;color:#24322b;font:14px system-ui,sans-serif}main{max-width:1200px;margin:28px auto;padding:0 18px}header{margin-bottom:20px}h1{font-size:21px}header p,.demo-note{font-size:12px;color:#65736b;line-height:1.7}nav{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}nav button{font:inherit;padding:7px 10px;border:1px solid #cbd4ce;border-radius:7px;background:white;cursor:pointer}nav button[aria-pressed=true]{background:#284f3b;color:white;border-color:#284f3b}button:focus-visible,summary:focus-visible{outline:2px solid #286444;outline-offset:3px}.smoke-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(360px,480px);gap:28px}.smoke-layout aside{min-width:0;position:sticky;top:12px;align-self:start;max-height:90vh;overflow:auto}.smoke-layout .la-learning{height:auto;padding:12px 0}@media(max-width:760px){.smoke-layout{grid-template-columns:1fr}.smoke-layout aside{position:static;max-height:none}}pre{white-space:pre-wrap;font-size:12px;overflow-wrap:anywhere}details{margin-top:18px}#transport{color:#8b4c19}</style><main><header><h1>学习卡片回归验证</h1><p>独立测试数据 · 不调用模型或修改学习记录 · <a href="/playground">打开四玩法独立演示 →</a></p></header><div id="root"></div></main><script type="module" src="/app.js"></script></html>`

const playgroundHtml = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>四玩法独立题卡演示</title><style>html{background:#f3f4f0}body{margin:0;color:#24322b;font:14px/1.6 system-ui,sans-serif}main{max-width:1120px;margin:0 auto;padding:26px 18px 48px}h1{font-size:22px;margin:0 0 4px}header p{margin:0;color:#65736b;font-size:12px;line-height:1.7}header p a{color:#286444}noscript{display:block;padding:16px;border:1px solid #cbd4ce;border-radius:10px;background:#fff}</style><main><header><h1>四玩法独立题卡演示</h1><p>直接渲染 Exercise + PLAY_EXAMPLES · 不加载 DSH 插件或会话模拟 · 不判对错、不显示标准答案 · <a href="/">回到卡片回归页</a></p></header><div id="playground"></div><noscript>这个演示需要 JavaScript。</noscript></main><script type="module" src="/playground.js"></script></html>`

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
  if (path === '/editor') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><html lang=zh-CN><meta charset=utf-8><div id=root></div><script type=module src=/target-editor.js></script></html>') }
  else if (path === '/target-editor.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(join(out, 'target-editor.js'))) }
  else if (path === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html) }
  else if (path === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(join(out, 'app.js'))) }
  else if (path === '/playground' || path === '/playground/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(playgroundHtml) }
  else if (path === '/playground.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(join(out, 'playground.js'))) }
  else if (path === '/demo') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>执行与等待 · 动手补给</title><div id="demo"></div><script type="module" src="/task-demo.js"></script></html>') }
  else if (path === '/task-demo.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(join(out, 'task-demo.js'))) }
  else { res.writeHead(404); res.end() }
})
const port = Number(process.env.PORT ?? 3092)
server.listen(port, '127.0.0.1', () => console.log(`Browser smoke: http://127.0.0.1:${port}/ · playground: http://127.0.0.1:${port}/playground`))
const stop = () => server.close(async () => { await rm(out, { recursive: true, force: true }); process.exit(0) })
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
