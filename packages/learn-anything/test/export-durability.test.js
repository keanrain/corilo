import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const storeUrl = new URL('../src/host/store.js', import.meta.url).href
const migrateUrl = new URL('../src/host/migrate.js', import.meta.url).href
// Trace real FileHandle.sync calls in an isolated process, keeping the product
// filesystem path and actual sync behavior. No claim of physical power-loss testing.
const probe = `
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
const base = process.argv[1], failure = process.argv[2]
const source = join(base, 'source'), destination = join(base, 'export')
await fs.mkdir(source)
const original = fs.open
let events = []
fs.open = async function(path, ...args) {
  const handle = await original.call(this, path, ...args)
  const sync = handle.sync.bind(handle)
  handle.sync = async () => {
    const directory = (await handle.stat()).isDirectory()
    const relative = String(path).slice(base.length) || '.'
    events.push({ path: relative, directory, action: 'sync' })
    if (directory && relative === failure) throw new Error('synthetic directory sync failure')
    return sync()
  }
  return handle
}
syncBuiltinESMExports()
const store = await import(${JSON.stringify(storeUrl)})
const { exportStore } = await import(${JSON.stringify(migrateUrl)})
await store.withWorkspaceWrite(source, async () => {
  await store.writeJson(store.paths(source).course, { goal: 'durability fixture', chapters: [] })
  await store.writeJson(store.paths(source).kp('point'), { id: 'point', models: [] })
})
events = []
let result = null, error = null
try { result = await exportStore(source, destination) } catch (failure) { error = failure.message }
const course = await store.readJson(store.paths(source).course)
console.log(JSON.stringify({ events, result, error, course }))
`
async function runProbe(t, failure = '') {
  const directory = await mkdtemp(join(tmpdir(), 'learn-export-durable-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const { stdout } = await exec(process.execPath, ['--input-type=module', '-e', probe, directory, failure], { timeout: 20000 })
  return { directory, ...JSON.parse(stdout) }
}

test('export persists created directories bottom-up before acknowledging success', async (t) => {
  const output = await runProbe(t)
  assert.equal(output.error, null)
  assert.equal(output.result.output, join(output.directory, 'export'))
  assert.deepEqual(output.events.filter((event) => event.directory).map((event) => event.path), [
    '/export/.learn/kp', '/export/.learn', '/export', '.',
  ])
  const firstDirectory = output.events.findIndex((event) => event.directory)
  const manifest = output.events.findIndex((event) => event.path === '/export/learner-export.json')
  assert.ok(manifest >= 0 && manifest < firstDirectory, 'all files, including the completion manifest, must be synced before the directory tree')
  assert.ok(output.events.slice(firstDirectory).every((event) => event.directory), 'no file sync can remain after directory persistence begins')
  const exported = JSON.parse(await readFile(join(output.directory, 'export/.learn/kp/point.json'), 'utf8'))
  assert.equal(exported.id, 'point')
  assert.equal(output.course.goal, 'durability fixture')
})

test('directory sync failures reject the export and preserve output for inspection', async (t) => {
  for (const failure of ['/export/.learn', '.']) await t.test(failure, async (t) => {
    const output = await runProbe(t, failure)
    assert.equal(output.result, null, 'a failed durability step must never produce a successful export receipt')
    assert.equal(output.error, 'synthetic directory sync failure')
    assert.equal(output.events.at(-1).path, failure)
    const exported = JSON.parse(await readFile(join(output.directory, 'export/.learn/course.json'), 'utf8'))
    const manifest = JSON.parse(await readFile(join(output.directory, 'export/learner-export.json'), 'utf8'))
    assert.equal(exported.goal, output.course.goal, 'source records and partial export remain available')
    assert.equal(manifest.action, 'export')
  })
})
