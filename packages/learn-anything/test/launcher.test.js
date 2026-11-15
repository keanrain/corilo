import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

test('launcher forwards web arguments with and without its own install flags', (t) => {
  const work = mkdtempSync(join(tmpdir(), 'la-launcher-'))
  t.after(() => rmSync(work, { recursive: true, force: true }))
  const profile = join(work, 'profiles/learn-anything')
  const installed = join(profile, 'node_modules/@corilo/learn-anything')
  mkdirSync(installed, { recursive: true })
  writeFileSync(join(profile, 'package.json'), '{}')
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  writeFileSync(join(installed, 'package.json'), JSON.stringify({ version: pkg.version }))
  const mock = join(work, 'dsh.mjs')
  const output = join(work, 'args.json')
  writeFileSync(mock, `import {writeFileSync} from 'node:fs';writeFileSync(process.env.LA_TEST_ARGS,JSON.stringify(process.argv.slice(2)))`)
  for (const args of [['--port', '3080'], ['--no-open'], ['--from', './test.tgz', '--no-open'], ['--reinstall', '--no-open']]) {
    const result = spawnSync(process.execPath, [new URL('../bin/learn-anything.mjs', import.meta.url).pathname, ...args], {
      env: { ...process.env, DSH_HOME: work, LEARN_ANYTHING_DSH: mock, LA_TEST_ARGS: output }, encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), ['--profile', 'learn-anything', ...(args[0] === '--port' ? args : ['--no-open'])])
  }
})
