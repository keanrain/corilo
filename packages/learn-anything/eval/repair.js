// One controlled bad question; everything after its generation uses the real tutor/examiner.
import { learnerDocument, learnerEvents } from './learner-store.js'
import { verified } from '../src/host/mastery.js'
import { QUALITY_CASES } from './quality-cases.js'
import { textOf } from './metrics.js'
import { parseView } from '../src/host/render.js'
import { parseQuizAction, quizAnswerDisplay } from '../src/quiz/answer.js'

const question = QUALITY_CASES.find((c) => c.id === 'missing-card-rule')
const statement = '常开处理位都忙时先排队，等候区满了且还没到处理位上限，才开备用位直接处理新任务；两者都满就拒绝。'
export const REPAIR_SCENARIO = {
  id: 'repair/deferred', repair: true, defect: 'question-quality',
  expect: { expect: [], prescriptionKeywords: [] },
  course: {
    goal: '理解任务的排队、扩容与拒绝规则', background: '理解基本规则，正在练习具体情境',
    kp: { id: 'task-routing', title: '任务去向', kind: 'knowledge' },
    models: [{ id: 'route', type: 'associative', input: '处理位、等待区与人数上限', output: '新任务去向', reference: statement }],
  },
  statement,
  opening: `我的理解是：${statement} 请给我一道只改一条条件的情境题，在卡片里作答。`,
  persona: '理解排队、扩容与拒绝规则。按当前实际可见条件推理，只改一条条件并解释理由；条件不足时明确指出缺口。',
}

export const REPAIR_FIXTURE = [
  `【题目】${question.question}`, '【题型】scenario', '【玩法】MinimalChange', '【难度】2',
  `【标准答案】${question.standardAnswer}`, `【判分要点】${question.grading}`,
  `【互动】\n\`\`\`openui\n${question.ui}\n\`\`\``,
].join('\n')
export const REPAIR_CHALLENGE = `我初步想把第4条改成「备用洗衣机0台，最多同时3台在转」。但${question.answer} 请让考官先核对这些条件是否足够，再判我的这个改法。`

export function repairState(cwd) {
  const kp = learnerDocument(cwd, 'kp/task-routing', {})
  return {
    records: learnerEvents(cwd, 'verifications'),
    mastery: { kp: kp.mastery, models: kp.models?.map((m) => [m.id, m.mastery]) },
    reviews: learnerDocument(cwd, 'reviews'),
  }
}

/** Check actual tutor events against the store; never infer a write from the tutor's prose. */
export function scoreRepair(events, checkpoints) {
  const calls = new Map(), shows = [], deferred = [], grades = [], writes = [], answers = []
  let challenge = -1
  for (const [seq, e] of events.entries()) {
    if (e.type === 'user/message' && e.data?.source?.kind === 'user') {
      const text = textOf(e.data.content)
      if (text === REPAIR_CHALLENGE) challenge = seq
      const action = parseQuizAction(text)
      if (action?.action === 'answered') answers.push({ seq, ...action })
    }
    if (e.type === 'tool/call') {
      const args = typeof e.data.arguments === 'string' ? JSON.parse(e.data.arguments) : e.data.arguments
      calls.set(e.data.callId, { seq, name: e.data.name, args })
      if (e.data.name === 'verification_record') writes.push({ seq, args })
    }
    if (e.type !== 'tool/result' || e.data?.message?.isError) continue
    const call = calls.get(e.data.message.toolCallId)
    const text = textOf(e.data.message.content)
    if (call?.name === 'examiner') {
      const headings = text.replace(/^[\t ]*(?:#{1,6}[\t ]+)?/gm, '').replace(/\*\*/g, '')
      const verdict = /^【?判定】?\s*[：:]?\s*(correct|partial|wrong)\b/m.exec(headings)?.[1]
      if ((/^【?暂缓判定】?/m.test(headings) || /(?:旧题|本题)(?:应|需|需要|必须|先)暂缓判定/.test(headings)) && !verdict) deferred.push(seq)
      if (verdict) grades.push({ seq, call, text, verdict })
    }
    if (call?.name === 'quiz_show') {
      const view = parseView(text)
      if (view?.view === 'quiz') shows.push({ seq, id: view.id, ui: view.ui })
    }
  }
  const initial = shows.find((q) => q.seq < challenge)
  const held = deferred.find((seq) => seq > challenge)
  const repaired = shows.find((q) => q.seq > held && q.id !== initial?.id && q.ui !== initial?.ui)
  const fresh = answers.find((a) => a.seq > repaired?.seq && a.id === repaired?.id)
  const normalize = (text) => (text ?? '').replace(/\s+/gu, '')
  let grade = grades.find((g) => g.call.seq > fresh?.seq && normalize(g.call.args?.prompt).includes(normalize(quizAnswerDisplay(fresh.text))))
  const baseline = checkpoints[0]?.state
  const beforeAnswer = checkpoints.filter((c) => c.eventSeq <= (fresh?.seq ?? Infinity))
  const final = checkpoints.at(-1)?.state
  const stored = final?.records[0]
  if (verified(stored ?? {}) && stored.evidence.messageSeq === events[fresh?.seq]?.seq && stored.answer === fresh?.text) {
    grade = { host: true, verdict: stored.verdict }
  }
  const failures = []
  if (!initial || challenge < 0) failures.push('faulty card or learner challenge missing')
  if (held === undefined) failures.push('examiner deferral branch not exercised')
  if (!repaired) failures.push('no revised card after deferral')
  if (!fresh) failures.push('no fresh answer to revised card')
  if (!grade) failures.push('fresh answer content/calibration not regraded by examiner')
  if (!baseline || beforeAnswer.length < 2 || beforeAnswer.some(({ state }) => state.records.length ||
    JSON.stringify(state.mastery) !== JSON.stringify(baseline.mastery) || JSON.stringify(state.reviews) !== JSON.stringify(baseline.reviews))) {
    failures.push('records/mastery/reviews changed before fresh answer, or checkpoints missing')
  }
  if (writes.length !== 1 || !grade || (grade.host ? writes[0]?.seq <= fresh.seq : writes[0]?.seq <= grade.seq)) failures.push('expected exactly one record call after fresh grading')
  if (final?.records.length !== 1 || !fresh || !normalize(final.records[0]?.answer) || !normalize(fresh.text).includes(normalize(final.records[0]?.answer))) failures.push('store must contain exactly the fresh answer')
  if (grade && (final?.records[0]?.verdict !== grade.verdict || (!grade.host && writes[0]?.args?.verdict !== grade.verdict))) failures.push('stored verdict differs from examiner grading')
  return { passed: !failures.length, failures, initial, challenge, deferred: held, repaired, fresh, grade, writes, checkpoints }
}
