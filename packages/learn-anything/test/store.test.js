import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withWorkspaceWrite, requireKp } from '../src/host/store.js'
import { courseSave, kpDefineModels, targetMapUpdate } from '../src/host/tools.js'

test('workspace writes preserve concurrent session updates and recover after a failed operation', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'learn-store-'))
  const env = { cwd, now: () => new Date('2026-10-26T00:00:00Z') }
  try {
    await courseSave.execute({ goal: 'test', status: 'active', chapters: [{ title: 'ch', kps: [{ id: 'kp', title: 'KP', kind: 'knowledge' }] }] }, env)
    await kpDefineModels.execute({ kpId: 'kp', models: [{ id: 'map', type: 'associative', input: 'x', output: 'y', reference: 'rule' }] }, env)
    const add = (input, workspace = cwd) => withWorkspaceWrite(workspace, () => targetMapUpdate.execute({
      kpId: 'kp', modelId: 'map', addExamples: [{ tag: 'e', input, output: 'y', origin: 'ai' }],
    }, env))
    await Promise.all(Array.from({ length: 5 }, (_, i) => add(`session-${i}`, i % 2 ? join(cwd, '.') : cwd)))
    const examples = (await requireKp(cwd, 'kp')).models[0].targetMap.examples
    assert.deepEqual(examples.map((e) => e.input), Array.from({ length: 5 }, (_, i) => `session-${i}`))
    assert.equal(new Set(examples.map((e) => e.id)).size, 5)

    const failure = withWorkspaceWrite(cwd, () => { throw new Error('failed write') })
    const after = add('after-failure')
    await assert.rejects(failure, /failed write/)
    await after
    assert.equal((await requireKp(cwd, 'kp')).models[0].targetMap.examples.length, 6)
    assert.equal(await withWorkspaceWrite(cwd, () => 'result'), 'result')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
