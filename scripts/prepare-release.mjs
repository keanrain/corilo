#!/usr/bin/env node
// Prepare one independently versioned package. This command never publishes.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PRODUCTS = Object.freeze({
  notes: 'plugins/notes',
  todos: 'plugins/todos',
  'learn-anything': 'packages/learn-anything',
})
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

export function releaseMetadata(pkg, lock, changelog) {
  if (!exactVersion.test(pkg.version)) throw new Error('Package version must be an exact release version')
  for (const entry of [lock, lock.packages?.['']]) {
    if (entry?.name !== pkg.name || entry?.version !== pkg.version) throw new Error('Package and lock name/version differ')
  }
  const dsh = pkg.engines?.dsh ?? pkg.dependencies?.['@deepseek-ai/dsh']
  if (!exactVersion.test(dsh ?? '')) throw new Error('Package must declare an exact compatible DSH version')
  const heading = `## ${pkg.version}`
  const sections = changelog.split(/(?=^## )/m)
  const notes = sections.find((section) => section.split('\n')[0].trim() === heading)
  if (!notes || !notes.slice(heading.length).trim()) throw new Error(`CHANGELOG.md needs a non-empty ${heading} section`)
  return { name: pkg.name, version: pkg.version, dsh, node: pkg.engines?.node, private: pkg.private === true, notes: notes.trim() + '\n' }
}

export function validatePack(pack, pkg) {
  if (pack.name !== pkg.name || pack.version !== pkg.version) throw new Error('Packed name/version do not match the selected package')
  if (typeof pack.filename !== 'string' || basename(pack.filename) !== pack.filename || !pack.filename.endsWith('.tgz')) throw new Error('Unexpected tarball filename')
  const paths = new Set()
  for (const file of pack.files ?? []) {
    const path = file.path
    if (typeof path !== 'string' || path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => part === '..')) throw new Error('Unsafe packed path')
    if (/(^|\/)(node_modules|tests?|__tests__|fixtures|\.git|\.learn|\.local|tokens|secrets)(\/|$)/i.test(path) || /(^|\/)(\.env(?:\..*)?|\.npmrc|[^/]*credentials[^/]*|[^/]*\.(?:pem|key|p12|pfx|jks|keystore))$/i.test(path)) {
      throw new Error(`Disallowed release file: ${path}`)
    }
    paths.add(path)
  }
  if (!paths.has('package.json') || !paths.has('README.md')) throw new Error('Package manifest or README is missing from tarball')
  for (const entry of Object.values(pkg.exports ?? {})) {
    if (typeof entry === 'string' && entry.startsWith('./') && !entry.includes('*') && !paths.has(entry.slice(2))) throw new Error(`Export missing from tarball: ${entry}`)
  }
  const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin ?? {})
  for (const entry of [...bins, pkg.dsh?.bundle?.patch].filter(Boolean)) {
    if (typeof entry !== 'string' || !paths.has(entry.replace(/^\.\//, ''))) throw new Error(`Executable or bundle patch missing from tarball: ${entry}`)
  }
  return paths.size
}

export function prepareRelease(product, output, { repo = REPO } = {}) {
  const relative = Object.hasOwn(PRODUCTS, product) ? PRODUCTS[product] : undefined
  if (!relative) throw new Error(`Choose one product: ${Object.keys(PRODUCTS).join(', ')}`)
  const directory = join(repo, relative)
  const pkg = readJson(join(directory, 'package.json'))
  const metadata = releaseMetadata(pkg, readJson(join(directory, 'package-lock.json')), readFileSync(join(directory, 'CHANGELOG.md'), 'utf8'))
  const destination = resolve(output ?? join(repo, 'dist/releases', product, pkg.version))
  if (existsSync(destination)) throw new Error(`Output already exists; choose a new directory: ${destination}`)
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const run = (args, options = {}) => execFileSync(npm, args, { cwd: directory, stdio: 'inherit', ...options })
  // Dependencies are installed from this package's own lock by the caller.
  run(['run', 'build'])
  run(['test'])
  mkdirSync(dirname(destination), { recursive: true })
  const stage = mkdtempSync(join(dirname(destination), '.prepare-release-'))
  try {
    // Explicit build/test above; prepack must not silently rebuild after validation.
    const result = JSON.parse(run(['pack', '--ignore-scripts', '--json', '--pack-destination', stage], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }))
    if (!Array.isArray(result) || result.length !== 1) throw new Error('Expected exactly one packed product')
    const pack = result[0]
    const fileCount = validatePack(pack, pkg)
    const sha256 = createHash('sha256').update(readFileSync(join(stage, pack.filename))).digest('hex')
    const { notes, ...identity } = metadata
    const report = { ...identity, product, filename: pack.filename, sha256, fileCount, checks: ['build', 'package-tests', 'package-content'], published: false }
    writeFileSync(join(stage, 'release.json'), JSON.stringify(report, null, 2) + '\n')
    writeFileSync(join(stage, 'SHA256SUMS'), `${sha256}  ${pack.filename}\n`)
    writeFileSync(join(stage, 'RELEASE_NOTES.md'), `# ${pkg.name}\n\n${notes}`)
    if (existsSync(destination)) throw new Error(`Output appeared during preparation: ${destination}`)
    renameSync(stage, destination)
    return { directory: destination, ...report }
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [product, ...args] = process.argv.slice(2)
    if (args.length && (args.length !== 2 || args[0] !== '--output' || !args[1])) throw new Error('Usage: prepare-release.mjs <notes|todos|learn-anything> [--output <new-directory>]')
    console.log(JSON.stringify(prepareRelease(product, args[1]), null, 2))
  } catch (error) {
    console.error(`Release preparation failed: ${error.message}`)
    process.exitCode = 1
  }
}
