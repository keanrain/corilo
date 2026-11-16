/**
 * Tutor tools as plain definitions: `{ name, description, parameters, execute(args, env) }`.
 * `index.js` wraps them with dsh's `defineTool`; tests call `execute` directly.
 * `env` = `{ cwd, now(), userTexts(), gate }`, where `userTexts()` returns what the learner
 * actually typed in this session, or null when that is unavailable.
 * @module learn-anything/tools
 */
import * as course from './tools/course.js'
import * as knowledge from './tools/knowledge.js'
import * as assessment from './tools/assessment.js'
import * as review from './tools/review.js'
import { withWorkspaceWrite, withWorkspaceRead } from './store.js'

// The public boundary is transactional even when called without the Harness
// adapter (for example migration verification or an integration test). Nested
// host/UI operations join the same workspace transaction rather than deadlock.
const atomic = (tool) => ({
  ...tool,
  execute(args, env) {
    const transaction = tool.readOnly ? withWorkspaceRead : withWorkspaceWrite
    return transaction(env.cwd, async () => {
      env.signal?.throwIfAborted()
      const value = await tool.execute(args, env)
      env.signal?.throwIfAborted()
      return value
    })
  },
})
export const learnStatus = atomic(course.learnStatus)
export const courseSave = atomic(course.courseSave)
export const courseGet = atomic(course.courseGet)
export const kpSkip = atomic(course.kpSkip)
export const kpGet = atomic(knowledge.kpGet)
export const kpDefineModels = atomic(knowledge.kpDefineModels)
export const kpSetPhase = atomic(knowledge.kpSetPhase)
export const targetMapUpdate = atomic(knowledge.targetMapUpdate)
export const verificationRecord = atomic(assessment.verificationRecord)
export const diagnosisRecord = atomic(assessment.diagnosisRecord)
export const reviewDue = atomic(review.reviewDue)
export const progressGet = atomic(review.progressGet)
export const mistakesGet = atomic(review.mistakesGet)
export { FINDING_TYPES } from './tools/assessment.js'
export { timeAgo, streakOf } from './tools/review.js'
export const learnStats = (cwd, ...args) => withWorkspaceRead(cwd, () => review.learnStats(cwd, ...args))

// Preserve the public module surface and registration order for host and tests.
export const ALL_TOOLS = [
  learnStatus, courseSave, courseGet, kpGet, kpDefineModels, kpSetPhase, kpSkip,
  targetMapUpdate, verificationRecord, diagnosisRecord, reviewDue, progressGet, mistakesGet,
]
