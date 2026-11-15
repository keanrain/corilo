import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as tools from '../src/host/tools.js'
import { RECOVERY_SCENARIO as s, scoreRecovery } from '../eval/prerequisite-recovery.js'

test('recovery acceptance rejects an unchanged route, further testing and overwritten learner evidence', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'la-recovery-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const env = { cwd, now: () => new Date(), userTexts: () => [s.statement, '另一句新的表述'] }
  const save = (kps) => tools.courseSave.execute({ goal: s.course.goal, status: 'active',
    chapters: [{ title: '课程', kps }] }, env)
  await save([s.course.kp, ...s.course.basics])
  await tools.kpDefineModels.execute({ kpId: s.course.kp.id, models: s.course.models }, env)
  await tools.targetMapUpdate.execute({ kpId: s.course.kp.id, modelId: 'route', statement: s.statement }, env)
  assert.equal(scoreRecovery(cwd, [], []).passed, false)
  await save([...s.course.basics, s.course.kp])
  assert.equal(scoreRecovery(cwd, [], []).passed, true)
  for (const name of ['examiner', 'quiz_show', 'verification_record']) {
    assert.equal(scoreRecovery(cwd, [{ type: 'tool/call', data: { name, arguments: '{}' } }], []).passed, false)
  }
  await tools.targetMapUpdate.execute({ kpId: s.course.kp.id, modelId: 'route', statement: '另一句新的表述' }, env)
  assert.equal(scoreRecovery(cwd, [], []).passed, false)
})
