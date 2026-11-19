// market/index.json: valid plugin market index format 1, and its entry describes this package.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { marketInstallTarget, parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'

const read = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'))
const pkg = read('../package.json')
const INDEX_URL = 'https://example.com/learn-anything/market/index.json'

test('market index parses and lists this package at its current version', () => {
  const index = parseMarketIndex(read('../market/index.json'), INDEX_URL)
  assert.equal(index.plugins.length, 1)
  const [entry] = index.plugins
  assert.equal(entry.name, pkg.name)
  assert.equal(entry.versions[0].version, pkg.version)
  // The bundle is pinned to one dsh release through its dsh-tools peer.
  assert.equal(entry.versions[0].engines.dsh, pkg.peerDependencies['@deepseek-ai/dsh-tools'])
  // The icon is the package's own, resolved next to the index.
  assert.equal(entry.icon, 'https://example.com/learn-anything/icon.svg')
  const version = entry.versions[0]
  assert.equal(version.source.type, 'git')
  assert.deepEqual(marketInstallTarget(entry.name, version), {
    spec: `git+https://github.com/keanrain/corilo.git#${version.source.commit}&path:/packages/learn-anything`,
  })
})

test('the package name matches what the bundle and the web client refer to', () => {
  // dsh loads the client module by package name; a stale id breaks the whole page.
  const client = readFileSync(new URL('../src/client/index.js', import.meta.url), 'utf8')
  assert.ok(client.includes(`id: ${JSON.stringify(pkg.name)},`), 'client module id')
  const source = readFileSync(new URL('../src/client/main.js', import.meta.url), 'utf8')
  assert.ok(source.includes(`export const name = '${pkg.name}'`), 'client module name')
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  for (const [, ref] of patch.matchAll(/(?:name: '|resolve\(')([^'@][^']*|@[^']*)'/g)) {
    if (/learn-anything/.test(ref)) assert.ok(ref.startsWith(pkg.name), `cordis.patch.yml refers to ${ref}`)
  }
})
