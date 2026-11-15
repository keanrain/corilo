import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { ingestMaterial, materialRead, materialList, materialSearch, listMaterials, validateSources, chunk, htmlToText, decodeEntities, decodeText } from '../src/host/ingest.js'

async function workspace() {
  const cwd = await mkdtemp(join(tmpdir(), 'learn-ingest-'))
  return { env: { cwd, now: () => new Date('2026-10-16T00:00:00Z') }, cleanup: () => rm(cwd, { recursive: true, force: true }) }
}

/** A minimal one-page PDF with real text and a valid xref table. */
function makePdf(text) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((obj, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

function makeEpub() {
  const chapter = (title, body) => `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title><style>p{}</style></head><body><h1>${title}</h1><p>${body}</p><p>第二段 &amp; 实体 &#x4E2D;</p></body></html>`
  return zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0"?><package><metadata><dc:title>学习观（测试）</dc:title></metadata><manifest>
      <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
      <item id="c1" href="text/c1.xhtml" media-type="application/xhtml+xml"/>
      <item id="c2" href="text/c2.xhtml" media-type="application/xhtml+xml"/>
    </manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`),
    'OEBPS/nav.xhtml': strToU8('<html><body><nav><ol><li><a href="text/c1.xhtml">第一章 知识是什么</a></li><li><a href="text/c2.xhtml#s">第二章 如何学</a></li></ol></nav></body></html>'),
    'OEBPS/text/c1.xhtml': strToU8(chapter('知识是什么', '知识是可以预测新情况的模型。')),
    'OEBPS/text/c2.xhtml': strToU8(chapter('如何学', '先描述，再评估。')),
  })
}

test('chunk splits at paragraph boundaries and caps oversized paragraphs', () => {
  const parts = chunk(['a'.repeat(30), 'b'.repeat(30), 'c'.repeat(100)].join('\n\n'), 64)
  assert.deepEqual(parts.map((p) => p.length), [62, 64, 36])
  assert.equal(htmlToText('<p>x&lt;y</p><script>bad()</script><p>z</p>'), 'x<y\n\nz')
})

test('ingest txt/markdown by headings, read and search blocks', async () => {
  const { env, cleanup } = await workspace()
  try {
    await writeFile(join(env.cwd, 'notes.md'), '# 第一节\n闭包记住定义时的环境。\n\n# 第二节\n作用域链从内向外查找。\n')
    const out = await ingestMaterial.execute({ path: 'notes.md' }, env)
    const id = /id=(m-[a-z0-9]+)/.exec(out)[1]
    assert.match(out, new RegExp(`${id}#2 第二节`))
    assert.match(await materialRead.execute({ materialId: id, blocks: ['1'] }, env), /闭包记住定义时的环境/)
    assert.match(await materialSearch.execute({ query: '作用域链' }, env), new RegExp(`${id}#2`))
    const again = await ingestMaterial.execute({ path: 'notes.md' }, env)
    assert.match(again, new RegExp(`已重新导入.*id=${id}`))
    assert.equal((await materialList.execute({}, env)).split('\n').length, 1)
  } finally { await cleanup() }
})

test('search admits partial and title-only matches, ranking coverage before title and frequency', async () => {
  const { env, cleanup } = await workspace()
  try {
    await writeFile(join(env.cwd, 'search.md'), [
      '# 正文双词', `${'填充'.repeat(250)} beta alpha beta alpha`,
      '# alpha 标题', 'beta',
      '# 高频噪声', 'alpha '.repeat(20),
      '# beta 标题', '正文没有关键词。',
      '# 重复出现', 'beta beta',
      '# 一次出现', 'beta',
      '# 无关', '不应返回。',
    ].join('\n'))
    const id = /id=(m-[a-z0-9]+)/.exec(await ingestMaterial.execute({ path: 'search.md' }, env))[1]
    const search = (query, limit) => materialSearch.execute({ query, materialId: id, limit }, env)
    const out = await search('ALPHA beta alpha')
    const refs = [...out.matchAll(/#(\d+) /g)].map((match) => Number(match[1]))
    assert.deepEqual(refs, [2, 1, 4, 3, 5, 6])
    assert.equal(out, await search('alpha beta'), 'repeated query words do not increase coverage')
    assert.equal((await search('alpha beta', 2)).split('\n').length, 2)
    const partial = await search('missing beta')
    assert.match(partial.split('\n').find((line) => line.includes(`${id}#1 `)), /beta alpha/, 'snippet follows an actual hit even when the first term is absent')
    assert.match(partial, new RegExp(`${id}#4`), 'a title alone can match')
    assert.match(await search('missing'), /没有匹配/)
    await assert.rejects(search('  '), /empty/)
    await writeFile(join(env.cwd, 'other.md'), '# alpha beta\n只在另一份材料。')
    await ingestMaterial.execute({ path: 'other.md' }, env)
    assert.equal(await search('alpha beta'), out, 'materialId still restricts the search')
  } finally { await cleanup() }
})

test('changed imports preserve old citations and default listing/search uses the latest content', async () => {
  const { env, cleanup } = await workspace()
  try {
    const file = join(env.cwd, 'book.md')
    const original = '# Original\nAlpha evidence.\n\n# Second\nBeta evidence.'
    const importId = async () => /id=(m-[a-z0-9]+)/.exec(await ingestMaterial.execute({ path: 'book.md' }, env))[1]
    await writeFile(file, original)
    const oldId = await importId()
    // Simulate an import made before content hashes were introduced.
    const metaFile = join(env.cwd, '.learn', 'materials', oldId, 'meta.json')
    const legacy = JSON.parse(await readFile(metaFile, 'utf8'))
    delete legacy.hash
    delete legacy.revision
    await writeFile(metaFile, JSON.stringify(legacy))
    assert.equal(await importId(), oldId, 'an unchanged legacy import keeps its id')
    assert.match(JSON.parse(await readFile(metaFile, 'utf8')).hash, /^[a-f0-9]{64}$/)

    await writeFile(file, '# Inserted\nUnrelated evidence.\n\n' + original)
    const newId = await importId()
    assert.notEqual(newId, oldId)
    assert.match(await materialRead.execute({ blocks: [`${oldId}#1`] }, env), /Alpha evidence/)
    assert.match(await materialRead.execute({ blocks: [`${newId}#1`] }, env), /Unrelated evidence/)
    assert.deepEqual(await validateSources(env.cwd, [`${oldId}#1`]), [`${oldId}#1`])
    assert.deepEqual((await listMaterials(env.cwd)).map((m) => m.id), [newId])
    assert.equal((await materialList.execute({}, env)).split('\n').length, 1)
    assert.doesNotMatch(await materialSearch.execute({ query: 'Alpha' }, env), new RegExp(oldId))
    assert.match(await materialSearch.execute({ query: 'Alpha', materialId: oldId }, env), new RegExp(`${oldId}#1`))
    assert.equal(await importId(), newId, 'repeating the latest content does not create another id')

    await writeFile(file, original)
    assert.equal(await importId(), oldId, 'returning to previous content reuses its immutable blocks')
    assert.deepEqual((await listMaterials(env.cwd)).map((m) => m.id), [oldId])
    assert.equal((await listMaterials(env.cwd, { includeHistory: true })).length, 2)
    assert.match(await materialRead.execute({ blocks: [`${newId}#1`] }, env), /Unrelated evidence/)
  } finally { await cleanup() }
})

test('decodeEntities knows math, Latin-1 accents and typography names', () => {
  assert.equal(decodeEntities('x &isin; A &times; B, caf&eacute; &Eacute;t&eacute;, a&mdash;b&hellip; &ldquo;q&rdquo; &frac12; &sup2; &Omega; &le; &rArr;'),
    'x ∈ A × B, café Été, a—b… “q” ½ ² Ω ≤ ⇒')
  assert.equal(decodeEntities('&AMP; &yuml; &unknown;'), '& ÿ &unknown;')
  assert.equal(htmlToText('<p>a&nbsp;&nbsp;b &thinsp;c</p>'), 'a b c')
})

test('decodeText strips a UTF-8 BOM and falls back to GB18030', () => {
  assert.equal(decodeText(Buffer.from('\uFEFF闭包', 'utf8')), '闭包')
  // "闭包是函数" in GBK
  assert.equal(decodeText(Buffer.from([0xb1, 0xd5, 0xb0, 0xfc, 0xca, 0xc7, 0xba, 0xaf, 0xca, 0xfd])), '闭包是函数')
})

test('ingest a GBK-encoded txt as readable text', async () => {
  const { env, cleanup } = await workspace()
  try {
    // "# 第一节\n闭包记住环境\n" in GBK
    const body = Buffer.from([0xb5, 0xda, 0xd2, 0xbb, 0xbd, 0xda, 0x0a, 0xb1, 0xd5, 0xb0, 0xfc, 0xbc, 0xc7, 0xd7, 0xa1, 0xbb, 0xb7, 0xbe, 0xb3, 0x0a])
    await writeFile(join(env.cwd, 'gbk.txt'), Buffer.concat([Buffer.from('# '), body]))
    const out = await ingestMaterial.execute({ path: 'gbk.txt' }, env)
    assert.match(out, /#1 第一节/)
    const id = /id=(m-[a-z0-9]+)/.exec(out)[1]
    assert.match(await materialRead.execute({ blocks: [`${id}#1`] }, env), /闭包记住环境/)
  } finally { await cleanup() }
})

test('ingest epub uses nav titles in spine order', async () => {
  const { env, cleanup } = await workspace()
  try {
    await writeFile(join(env.cwd, 'book.epub'), makeEpub())
    const out = await ingestMaterial.execute({ path: 'book.epub' }, env)
    assert.match(out, /「学习观（测试）」（epub，2 块/)
    assert.match(out, /#1 第一章 知识是什么/)
    assert.match(out, /#2 第二章 如何学/)
    const id = /id=(m-[a-z0-9]+)/.exec(out)[1]
    const text = await materialRead.execute({ blocks: [`${id}#1`] }, env)
    assert.match(text, /知识是可以预测新情况的模型/)
    assert.match(text, /第二段 & 实体 中/)
    assert.doesNotMatch(text, /p\{\}/)
  } finally { await cleanup() }
})

test('ingest pdf extracts page text', async () => {
  const { env, cleanup } = await workspace()
  try {
    await writeFile(join(env.cwd, 'paper.pdf'), makePdf('Closures capture their lexical environment'))
    const out = await ingestMaterial.execute({ path: 'paper.pdf' }, env)
    const id = /id=(m-[a-z0-9]+)/.exec(out)[1]
    assert.match(await materialRead.execute({ blocks: [`${id}#1`] }, env), /Closures capture their lexical environment/)
  } finally { await cleanup() }
})

test('ingest a repo directory: tree, README, manifest; skips node_modules', async () => {
  const { env, cleanup } = await workspace()
  try {
    const repo = join(env.cwd, 'repo')
    await mkdir(join(repo, 'src'), { recursive: true })
    await mkdir(join(repo, 'node_modules/x'), { recursive: true })
    await writeFile(join(repo, 'README.md'), '# Demo\n一个演示仓库。\n## 架构\n核心在 src/core.js。\n')
    await writeFile(join(repo, 'package.json'), '{"name":"demo"}')
    await writeFile(join(repo, 'src/core.js'), 'export {}')
    await writeFile(join(repo, 'node_modules/x/index.js'), '')
    const out = await ingestMaterial.execute({ path: 'repo' }, env)
    assert.match(out, /（repo，/)
    const id = /id=(m-[a-z0-9]+)/.exec(out)[1]
    const tree = await materialRead.execute({ blocks: [`${id}#1`] }, env)
    assert.match(tree, /core\.js/)
    assert.doesNotMatch(tree, /node_modules/)
    assert.match(out, /README\.md · 架构/)
  } finally { await cleanup() }
})

test('ingest refuses paths outside the workspace and unknown types', async () => {
  const { env, cleanup } = await workspace()
  try {
    await assert.rejects(ingestMaterial.execute({ path: '/etc/hosts' }, env), /outside the workspace/)
    await assert.rejects(ingestMaterial.execute({ path: '../x.txt' }, env), /outside the workspace/)
    await writeFile(join(env.cwd, 'a.docx'), 'x')
    await assert.rejects(ingestMaterial.execute({ path: 'a.docx' }, env), /unsupported file type/)
  } finally { await cleanup() }
})
