// Explicit fake host/examiner seam for storage and mastery unit tests only.
// Trust-boundary tests use real session events and assessAnswer instead.
let seq = 0
export const evidence = () => ({ version: 1, sessionId: 'test-examiner', messageSeq: ++seq, questionSeq: 0, examinerDigest: 'a'.repeat(64) })
export const assessVerification = async (args) => ({ ...args, novel: args.novel ?? true, evidence: evidence() })
