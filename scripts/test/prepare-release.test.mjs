import { test } from 'node:test'
import assert from 'node:assert/strict'
import { releaseMetadata, validatePack, prepareRelease } from '../prepare-release.mjs'

const pkg = { name: '@corilo/example', version: '1.2.3', private: true, engines: { node: '>=24.9.0', dsh: '0.2.2-rc.3' }, exports: { '.': './index.js' } }
const lock = { name: pkg.name, version: pkg.version, packages: { '': { name: pkg.name, version: pkg.version } } }
const notes = '# Changes\n\n## 1.2.3\n\n- Keep existing data.\n\n## 1.2.2\n\n- Previous release.\n'
const pack = { name: pkg.name, version: pkg.version, filename: 'corilo-example-1.2.3.tgz', files: ['package.json', 'README.md', 'index.js'].map((path) => ({ path })) }

test('release notes are limited to the selected independent version', () => {
  const metadata = releaseMetadata(pkg, lock, notes)
  assert.equal(metadata.dsh, '0.2.2-rc.3')
  assert.equal(metadata.private, true)
  assert.match(metadata.notes, /Keep existing data/)
  assert.doesNotMatch(metadata.notes, /Previous release/)
})

test('inconsistent locks and absent release notes stop preparation', () => {
  assert.throws(() => releaseMetadata(pkg, { ...lock, version: '1.2.2' }, notes), /lock/)
  assert.throws(() => releaseMetadata(pkg, { ...lock, packages: { '': { ...pkg, version: '1.2.2' } } }, notes), /lock/)
  assert.throws(() => releaseMetadata(pkg, lock, '## 1.2.30\n- Wrong release'), /non-empty/)
  assert.throws(() => releaseMetadata(pkg, lock, '## 1.2.3\n\n## 1.2.2\n- Old'), /non-empty/)
  assert.throws(() => releaseMetadata({ ...pkg, engines: { dsh: 'latest' } }, lock, notes), /exact compatible/)
})

test('tarball identity and declared entry points are required', () => {
  assert.equal(validatePack(pack, pkg), 3)
  assert.throws(() => validatePack({ ...pack, name: 'corilo' }, pkg), /name\/version/)
  assert.throws(() => validatePack({ ...pack, files: pack.files.slice(0, 2) }, pkg), /Export missing/)
  assert.throws(() => validatePack({ ...pack, filename: '../bad.tgz' }, pkg), /filename/)
})

test('release inventory rejects credentials, dependencies, test data and traversal', () => {
  for (const path of ['.env', '.env.local', '.npmrc', 'user-credentials.json', 'secret.key', 'tokens/access.json', 'secrets/test.json', 'node_modules/lib/index.js', 'test/fixture.json', 'src/__tests__/case.js', '.learn/course.json', '../escape']) {
    assert.throws(() => validatePack({ ...pack, files: [...pack.files, { path }] }, pkg), /Disallowed|Unsafe/, path)
  }
})

test('root package and arbitrary paths cannot be selected for release', () => {
  for (const product of ['corilo', '.', '../', 'toString', '__proto__']) {
    assert.throws(() => prepareRelease(product), /Choose one product/)
  }
})

test('published CLI commands and DSH bundle patches must be present', () => {
  for (const bin of ['./cli.mjs', { example: './cli.mjs' }]) {
    assert.throws(() => validatePack(pack, { ...pkg, bin }), /Executable or bundle patch missing/)
    assert.equal(validatePack({ ...pack, files: [...pack.files, { path: 'cli.mjs' }] }, { ...pkg, bin }), 4)
  }
  const bundled = { ...pkg, dsh: { bundle: { patch: './cordis.patch.yml' } } }
  assert.throws(() => validatePack(pack, bundled), /Executable or bundle patch missing/)
  assert.equal(validatePack({ ...pack, files: [...pack.files, { path: 'cordis.patch.yml' }] }, bundled), 4)
})

test('wildcard locale exports require matching files in the archive', () => {
  const localized = { ...pkg, exports: { ...pkg.exports, './locale/*.json': './locale/*.json' } }
  assert.throws(() => validatePack(pack, localized), /Export missing.*locale/)
  assert.throws(() => validatePack({ ...pack, files: [...pack.files, { path: 'locale/zh-CN-json' }] }, localized), /Export missing.*locale/)
  assert.equal(validatePack({ ...pack, files: [...pack.files, { path: 'locale/zh-CN.json' }] }, localized), 4)
})
