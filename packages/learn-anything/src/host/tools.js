/**
 * Tutor tools as plain definitions: `{ name, description, parameters, execute(args, env) }`.
 * `index.js` wraps them with dsh's `defineTool`; tests call `execute` directly.
 * `env` = `{ cwd, now(), userTexts(), gate }`, where `userTexts()` returns what the learner
 * actually typed in this session, or null when that is unavailable.
 * @module learn-anything/tools
 */
import { learnStatus, courseSave, courseGet, kpSkip } from './tools/course.js'
import { kpGet, kpDefineModels, kpSetPhase, targetMapUpdate } from './tools/knowledge.js'
import { verificationRecord, diagnosisRecord } from './tools/assessment.js'
import { reviewDue, progressGet, mistakesGet } from './tools/review.js'

// Preserve the public module surface and registration order for host and tests.
export { learnStatus, courseSave, courseGet, kpSkip, kpGet, kpDefineModels, kpSetPhase,
  targetMapUpdate, verificationRecord, diagnosisRecord, reviewDue, progressGet, mistakesGet }
export { FINDING_TYPES } from './tools/assessment.js'
export { timeAgo, streakOf, learnStats } from './tools/review.js'

export const ALL_TOOLS = [
  learnStatus, courseSave, courseGet, kpGet, kpDefineModels, kpSetPhase, kpSkip,
  targetMapUpdate, verificationRecord, diagnosisRecord, reviewDue, progressGet, mistakesGet,
]
