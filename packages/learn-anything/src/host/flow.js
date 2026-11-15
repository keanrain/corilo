/**
 * Keeps practice in the flow channel (Csikszentmihalyi): the challenge of the next
 * question tracks the learner's skill, every answer gets immediate feedback on where
 * they stand, and the goal ("what is left before 熟练") is always visible.
 *
 * Difficulty is a 1–5 staircase per model: two clean answers in a row step up, a wrong
 * answer steps down, anything else stays. A 2-up/1-down staircase settles where the
 * learner gets about 70% right — hard enough to stretch, easy enough to keep going.
 * @module learn-anything/flow
 */

import { DEFAULT_GATE, clean, verified } from './mastery.js'

export const MIN_DIFFICULTY = 1
export const MAX_DIFFICULTY = 5
export const START_DIFFICULTY = 2

/** What each difficulty asks of the examiner. */
export const DIFFICULTY = {
  1: '实质不同的新情境，提供全部必要背景，只检验一个关键关系，没有干扰项；不能仅改名字或数字',
  2: '新情境，但表面特征和已有例子相近，一步就能用上规律',
  3: '新情境，表面和已有例子不同，需要先认出这是规律适用的场合',
  4: '表面完全陌生，带一个似是而非的干扰项，或要同时考虑两个条件',
  5: '跨领域或反直觉：表面线索指向错误答案，需要组合规律或识别例外',
}

export const ZONE_LABEL = { easy: '太轻松', flow: '心流区', hard: '有点难' }

const clamp = (n) => Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, n))

/**
 * Run the staircase over one model's answered questions (oldest first). A question asked
 * above the current level (the learner's "harder please") raises the base; one asked below
 * it never lowers it, and only answers at or above the level count toward a step up.
 * @returns {{ level: number, last: null | { difficulty: number, zone: 'easy'|'flow'|'hard', change: -1|0|1, why: string } }}
 *   `level` is the difficulty to ask next — the skill estimate; `last` places the latest
 *   answer in the flow channel: too easy (below the level), about right (flow — including
 *   the clean answer that earns a step up: it was asked at the learner's level) or too hard (wrong).
 */
export function staircase(verifications) {
  let level = START_DIFFICULTY
  let run = 0
  let last = null
  for (const v of verifications) {
    if (v.questionType === 'recall') continue
    const asked = clamp(v.difficulty ?? level)
    let zone = 'flow'
    let why = 'hold'
    if (v.verdict === 'wrong') {
      level = clamp(Math.min(level, asked - 1))
      run = 0
      zone = 'hard'
      why = level < asked ? 'down' : 'floor'
    } else if (clean(v)) {
      if (asked < level) {
        zone = 'easy'
        why = 'below'
      } else {
        run = asked > level ? 1 : run + 1
        level = asked
        if (run >= 2) {
          level = clamp(asked + 1)
          run = 0
          why = level > asked ? 'up' : 'ceiling'
        }
      }
    } else {
      if (asked < level) why = 'below'
      level = Math.max(level, asked)
      run = 0
    }
    last = { difficulty: asked, zone, change: Math.sign(level - asked), why }
  }
  return { level, last }
}

const REASON = {
  down: '这题难了点，退一级把规律用顺',
  floor: '已经是最基础的难度，先把规律理顺',
  up: '连续两题稳稳答对，加一点难度',
  ceiling: '已经是最高难度，继续保持',
  below: '这题低于你现在的水平，下一题回到你的难度',
  hold: '难度正合适，保持',
}

/** Why the next difficulty is what it is, in the learner's words. */
export function changeReason(last) {
  return last ? REASON[last.why] : '从 2 级开始，按你的表现调整'
}

/**
 * How sure the learner said they were against how it went. A confident wrong answer is
 * the most useful signal (an illusion of knowing); an unsure correct one shows more skill than felt.
 * @param confidence 'sure' | 'unsure' | 'guess' | undefined
 */
export function calibration(confidence, verdict) {
  if (!confidence) return null
  if (verdict === 'correct') {
    if (confidence === 'sure') return { kind: 'match', text: '有把握，也答对了' }
    if (confidence === 'unsure') return { kind: 'under', text: '你没把握，但答对了：比你以为的更会' }
    return { kind: 'guess', text: '蒙对的不计入熟练进度，下一题再确认一次' }
  }
  if (confidence === 'sure' && verdict === 'partial') return { kind: 'over', text: '很有把握但只对了一部分：缺的那一步正好补上' }
  if (confidence === 'sure') return { kind: 'over', text: '很有把握却没答对：这里藏着一个误解，正好找出来' }
  return { kind: 'match', text: '你也觉得没把握：说明你清楚自己卡在哪' }
}

/**
 * What is left before the model's next level, so the goal stays concrete.
 * @returns {null | { target: 'proficient'|'expert', streak?: { have: number, need: number }, missing: string[] }}
 *   `missing` lists question types (or 'own-pos' / 'own-neg' for the learner's own examples) still needed.
 */
export function gateProgress(model, verifications, mastery, gate = DEFAULT_GATE) {
  const novel = verifications.filter((v) => verified(v) && v.novel !== false && v.questionType !== 'recall')
  const hasClean = (type) => novel.some((v) => v.questionType === type && clean(v))
  if (mastery === 'expert') return null
  if (mastery === 'proficient') {
    const own = (model.targetMap?.examples ?? []).filter((e) => e.origin === 'user' && e.checked)
    const missing = []
    if (!hasClean('transfer')) missing.push('transfer')
    if (!own.some((e) => e.polarity === 'pos')) missing.push('own-pos')
    if (!own.some((e) => e.polarity === 'neg')) missing.push('own-neg')
    return { target: 'expert', missing }
  }
  let have = 0
  for (let i = novel.length - 1; i >= 0 && clean(novel[i]) && have < gate.streak; i--) have++
  return { target: 'proficient', streak: { have, need: gate.streak }, missing: gate.requiredTypes.filter((t) => !hasClean(t)) }
}

const ROTATION = ['scenario', 'predict', 'discriminate-pos', 'contrast']

/** The question type to ask next: what the gate still needs, else the least recently used. */
export function nextQuestionType(progress, verifications) {
  const need = progress?.missing.find((t) => !t.startsWith('own-'))
  if (need) return need
  if (progress?.target === 'expert') return 'own-examples'
  const lastUse = (t) => verifications.findLastIndex((v) => v.questionType === t)
  return [...ROTATION].sort((a, b) => lastUse(a) - lastUse(b))[0]
}

/** Everything the tutor and the feedback card need about one model's practice. */
export function flowState(model, verifications, mastery, gate = DEFAULT_GATE) {
  const { level, last } = staircase(verifications)
  const progress = gateProgress(model, verifications, mastery, gate)
  return { next: level, last, reason: changeReason(last), progress, nextType: nextQuestionType(progress, verifications) }
}
