import { test } from 'node:test'
import assert from 'node:assert/strict'
import { staircase, calibration, gateProgress, nextQuestionType, flowState } from '../src/host/flow.js'
import { clean } from '../src/host/mastery.js'
import { evidence } from './helpers/assessment.js'

const v = (verdict, difficulty, extra = {}) => ({ questionType: 'scenario', verdict, difficulty, hintsUsed: 0, evidence: evidence(), ...extra })

test('the staircase steps up after two clean answers and down after a wrong one', () => {
  assert.deepEqual(staircase([]), { level: 2, last: null })
  assert.equal(staircase([v('correct', 2)]).level, 2)
  assert.deepEqual(staircase([v('correct', 2), v('correct', 2)]), { level: 3, last: { difficulty: 2, zone: 'flow', change: 1, why: 'up' } })
  assert.deepEqual(staircase([v('correct', 3), v('wrong', 3)]).last, { difficulty: 3, zone: 'hard', change: -1, why: 'down' })
  assert.equal(staircase([v('correct', 2), v('correct', 2, { hintsUsed: 1 })]).level, 2, 'a hinted answer holds the level')
  assert.equal(staircase([v('correct', 2), v('partial', 2), v('correct', 2)]).level, 2, 'the clean run restarts after a partial')
  assert.equal(staircase([v('correct', 5), v('correct', 5)]).level, 5, 'capped at 5')
  assert.deepEqual(staircase([v('wrong', 1)]), { level: 1, last: { difficulty: 1, zone: 'hard', change: 0, why: 'floor' } }, 'a wrong answer at the floor is still too hard')
  assert.equal(staircase([v('correct', 5), v('correct', 5)]).last.why, 'ceiling')
  const low = staircase([v('correct', 2), v('correct', 2), v('correct', 2), v('correct', 2)])
  assert.deepEqual([low.level, low.last.zone, low.last.why], [3, 'easy', 'below'], 'answers below the level neither lower it nor build the run')
  assert.equal(staircase([v('correct', 2), v('correct', 2), v('partial', 2)]).level, 3, 'a partial below the level holds it')
  assert.equal(staircase([v('correct', 3), v('wrong', 5)]).level, 3, 'a wrong answer above the level does not raise it')
  assert.equal(staircase([v('correct', 4)]).level, 4, 'a learner-requested difficulty becomes the new base')
  assert.equal(staircase([v('correct', 2), v('correct', 2, { questionType: 'recall' })]).level, 2, 'recall is ignored')
})

test('a guessed correct answer is not clean and does not climb', () => {
  assert.equal(clean(v('correct', 2, { confidence: 'guess' })), false)
  assert.equal(staircase([v('correct', 2), v('correct', 2, { confidence: 'guess' })]).level, 2)
})

test('calibration compares the stated confidence with the verdict', () => {
  assert.equal(calibration(undefined, 'correct'), null)
  assert.equal(calibration('sure', 'wrong').kind, 'over')
  assert.equal(calibration('unsure', 'correct').kind, 'under')
  assert.equal(calibration('guess', 'correct').kind, 'guess')
  assert.equal(calibration('sure', 'correct').kind, 'match')
  assert.match(calibration('sure', 'partial').text, /一部分/)
})

test('gate progress names what is left; the next type fills the gap first', () => {
  const model = { targetMap: { examples: [{ origin: 'user', checked: true, polarity: 'pos' }] } }
  const vs = [v('correct', 2, { questionType: 'rephrase' }), v('correct', 2)]
  const p = gateProgress(model, vs, 'novice')
  assert.deepEqual(p, { target: 'proficient', streak: { have: 2, need: 3 }, missing: ['discriminate-neg'] })
  assert.equal(nextQuestionType(p, vs), 'discriminate-neg')
  assert.deepEqual(gateProgress(model, vs, 'proficient'), { target: 'expert', missing: ['transfer', 'own-neg'] })
  assert.equal(nextQuestionType({ target: 'expert', missing: ['own-neg'] }, vs), 'own-examples')
  assert.equal(gateProgress(model, vs, 'expert'), null)
  const rotated = nextQuestionType({ target: 'proficient', missing: [] }, [v('correct', 2, { questionType: 'predict' }), v('correct', 2)])
  assert.equal(rotated, 'discriminate-pos', 'otherwise the least recently used type')
  assert.match(flowState(model, vs, 'novice').reason, /正合适|加一点/)
})
