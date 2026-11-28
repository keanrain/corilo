import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PRODUCTS } from '../prepare-release.mjs'
import { assemblePackageRelease } from '../assemble-package-release.mjs'

const sourceSha = 'a'.repeat(40)
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'corilo-release-assembly-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const input = join(root, 'input'), output = join(root, 'output'), repo = join(root, 'repo')
  for (const [product, relative] of Object.entries(PRODUCTS)) {
    mkdirSync(join(repo, relative), { recursive: true })
    mkdirSync(join(input, product), { recursive: true })
    const pkg = { name: `@corilo/${product}`, version: '1.2.3' }
    const bytes = Buffer.from(`synthetic validated archive for ${product}`)
    const report = { ...pkg, product, filename: `${product}.tgz`, published: false, dsh: '0.2.2-rc.5', node: '>=24.9.0', fileCount: 3, checks: ['build', 'package-tests', 'package-content'], sha256: createHash('sha256').update(bytes).digest('hex') }
    writeFileSync(join(repo, relative, 'package.json'), JSON.stringify(pkg))
    writeFileSync(join(input, product, 'release.json'), JSON.stringify(report))
    writeFileSync(join(input, product, report.filename), bytes)
    writeFileSync(join(input, product, 'RELEASE_NOTES.md'), `# ${product}\n\n## 1.2.3\n- Synthetic change.\n`)
  }
  return { input, output, repo }
}

test('assembly preserves validated bytes and checksums every public asset', (t) => {
  const f = fixture(t)
  const result = assemblePackageRelease(f.input, f.output, sourceSha, f)
  assert.equal(result.packages.length, 3)
  for (const product of Object.keys(PRODUCTS)) assert.deepEqual(readFileSync(join(f.output, `${product}.tgz`)), readFileSync(join(f.input, product, `${product}.tgz`)))
  const sums = readFileSync(join(f.output, 'SHA256SUMS'), 'utf8').trim().split('\n')
  assert.equal(sums.length, readdirSync(f.output).length - 1)
  for (const line of sums) {
    const [hash, file] = line.split('  ')
    assert.equal(hash, createHash('sha256').update(readFileSync(join(f.output, file))).digest('hex'))
  }
  const manifest = JSON.parse(readFileSync(join(f.output, 'release-manifest.json')))
  assert.equal(manifest.sourceSha, sourceSha)
  assert.equal(manifest.npmPublished, false)
  assert.doesNotMatch(JSON.stringify(manifest), new RegExp(f.input))
  assert.throws(() => assemblePackageRelease(f.input, f.output, sourceSha, f), /already exists/)
})

test('tampered or missing packages fail before creating public assets', (t) => {
  const f = fixture(t)
  writeFileSync(join(f.input, 'notes', 'notes.tgz'), 'tampered')
  assert.throws(() => assemblePackageRelease(f.input, f.output, sourceSha, f), /checksum mismatch/)
  assert.equal(existsSync(f.output), false)
  rmSync(join(f.input, 'notes'), { recursive: true })
  assert.throws(() => assemblePackageRelease(f.input, f.output, sourceSha, f), /ENOENT/)
  assert.equal(existsSync(f.output), false)
})

test('stale preparation identities and incomplete checks cannot be released', (t) => {
  const f = fixture(t)
  const path = join(f.input, 'todos', 'release.json')
  const report = JSON.parse(readFileSync(path))
  for (const patch of [{ version: '1.2.2' }, { name: 'wrong' }, { product: 'notes' }, { published: true }, { filename: '../outside.tgz' }, { checks: ['build'] }, { dsh: 'latest' }]) {
    writeFileSync(path, JSON.stringify({ ...report, ...patch }))
    assert.throws(() => assemblePackageRelease(f.input, f.output, sourceSha, f))
    assert.equal(existsSync(f.output), false)
  }
  assert.throws(() => assemblePackageRelease(f.input, f.output, 'main', f), /full source/)
})
