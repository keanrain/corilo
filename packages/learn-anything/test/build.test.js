// The generated files (src/vendor/openui-lang-core.js, src/client/index.js) match their sources.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('..', import.meta.url)

test('generated files are up to date (run `npm run build`)', () => {
  const out = mkdtempSync(join(tmpdir(), 'la-build-'))
  try {
    execFileSync(process.execPath, [new URL('scripts/build.mjs', root).pathname, out], { stdio: 'pipe' })
    for (const rel of ['src/vendor/openui-lang-core.js', 'src/client/index.js']) {
      assert.ok(readFileSync(join(out, rel), 'utf8') === readFileSync(new URL(rel, root), 'utf8'), `${rel} is stale`)
    }
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test('the client bundle keeps zod and the devtools out', () => {
  const client = readFileSync(new URL('src/client/index.js', root), 'utf8')
  assert.ok(client.length < 220_000, `client bundle is ${client.length} bytes`)
  assert.doesNotMatch(client, /OpenUIDevtools|posthog/i)
})
