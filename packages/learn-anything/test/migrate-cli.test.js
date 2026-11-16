// Exercise the declared executable as a subprocess, including no-write preview.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const exec = promisify(execFile)
const root = fileURLToPath(new URL('../', import.meta.url))
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const cli = join(root, pkg.bin['corilo-learn-store'])
const run = async (...args) => (await exec(process.execPath, [cli, ...args], { timeout: 20000 })).stdout

test('declared store CLI previews without writes, imports explicitly and exports to a separate workspace', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'learn-cli-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const workspace = join(directory, 'source workspace')
  const learn = join(workspace, '.learn')
  await mkdir(learn, { recursive: true })
  const bytes = '{\n  "goal": "CLI regression", "status": "planning", "chapters": []\n}\n'
  await writeFile(join(learn, 'course.json'), bytes)
  assert.match(await run('--help'), /migrate.*export.*recover/)
  await run('migrate', '--workspace', workspace)
  assert.deepEqual(await readdir(learn), ['course.json'], 'preview must not create locks, backups or a database')
  await run('migrate', '--workspace', workspace, '--apply')
  assert.equal(await readFile(join(learn, 'course.json'), 'utf8'), bytes)
  assert.ok((await readdir(learn)).includes('learner.sqlite'))
  const destination = join(directory, 'restored workspace')
  await run('export', '--workspace', workspace, '--output', destination)
  assert.deepEqual(JSON.parse(await readFile(join(destination, '.learn', 'course.json'), 'utf8')), JSON.parse(bytes))
  await assert.rejects(run('export', '--workspace', workspace, '--output', destination))
  await assert.rejects(run('migrate', '--workspace', workspace, '--apply', '--apply'))
})
