import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink, link } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ingestMaterial, materialSearch, parseRepo } from '../src/host/ingest.js'
import { searchTerms, rankBlocks } from '../src/host/material-search.js'
import { gitSource } from '../src/host/repo-git.js'
import { extractSymbols } from '../src/host/repo-symbols.js'

test('Chinese continuous phrases retrieve economic concepts with no artificial spaces', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'learn-search-'))
  try {
    await writeFile(join(cwd, 'economics.txt'), '# 成本决策\n边际成本用于评估增加一单位产出的额外支出。沉没成本已发生，决策不应考虑。\n# 无关\n植物通过光合作用生长。')
    const env = { cwd, now: () => new Date() }
    const result = await ingestMaterial.execute({ path: 'economics.txt' }, env)
    const id = /id=(m-[a-z0-9]+)/.exec(result)[1]
    assert.match(await materialSearch.execute({ query: '边际成本与沉没成本的区别' }, env), new RegExp(`${id}#1`))
    assert.doesNotMatch(await materialSearch.execute({ query: '边际成本与沉没成本的区别' }, env), new RegExp(`${id}#2`))
    assert.ok(searchTerms('使用 React 的闭包 closure').includes('react'))
    assert.ok(!searchTerms('成本与决策的关系').includes('的'))
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('BM25 favors concise evidence over a long block with the same occurrence count', () => {
  const documents = [
    { ref: 'long', block: { title: 'Text', text: `closure ${'irrelevant '.repeat(300)}` } },
    { ref: 'short', block: { title: 'Text', text: 'closure captures scope' } },
  ]
  assert.equal(rankBlocks(documents, 'closure')[0].ref, 'short')
  assert.deepEqual(rankBlocks(documents, 'ＣＬＯＳＵＲＥ').map((d) => d.ref), ['short', 'long'])
})

test('repository index extracts source declarations with paths and line provenance', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'learn-symbols-'))
  try {
    await mkdir(join(cwd, 'src'))
    await writeFile(join(cwd, 'src/api.ts'), 'export interface Item { id: string }\nexport async function load(\n id: string\n): Promise<Item> { return {id}; }\n')
    await writeFile(join(cwd, 'src/main.py'), 'async def run(value: int):\n    return value\n')
    await writeFile(join(cwd, 'src/lib.rs'), 'pub fn run(value: i32) -> i32 { value }\n')
    await symlink('/etc/hosts', join(cwd, 'src/escaped.ts'))
    const parsed = await parseRepo(cwd)
    const index = parsed.sections.filter((s) => s.title.startsWith('接口索引')).map((s) => s.text).join('\n')
    assert.match(index, /src\/api.ts:1 export interface Item/)
    assert.match(index, /load\( id: string \): Promise<Item>/)
    assert.match(index, /src\/main.py:1 async def run/)
    assert.match(index, /pub fn run/)
    assert.doesNotMatch(index, /escaped/)
    assert.match(extractSymbols('func (s *Server) Serve() {}', 'server.go')[0], /server.go:1 func/)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('material ingestion rejects symbolic ancestors and hard-linked inputs', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'learn-links-'))
  try {
    await mkdir(join(cwd, 'real'))
    await writeFile(join(cwd, 'real/a.txt'), 'private')
    await symlink(join(cwd, 'real'), join(cwd, 'alias'))
    const env = { cwd, now: () => new Date() }
    await assert.rejects(ingestMaterial.execute({ path: 'alias/a.txt' }, env), /links/)
    await link(join(cwd, 'real/a.txt'), join(cwd, 'b.txt'))
    await assert.rejects(ingestMaterial.execute({ path: 'b.txt' }, env), /links/)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('Git sources reject alternate protocols and embedded credentials before spawning', () => {
  for (const value of ['file:///tmp/repo', 'ssh://host/repo', 'git@host:repo', 'https://name:secret@host/repo', 'https://host/repo?token=secret', 'https://host/repo#branch']) {
    assert.throws(() => gitSource(value), /HTTPS/)
  }
  assert.equal(gitSource('https://github.com/example/repo.git'), 'https://github.com/example/repo.git')
})
