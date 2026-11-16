// Controlled help request; all question generation, answers and grading use real agents.
import { learnerDocument, learnerEvents } from './learner-store.js'
import { parseView } from '../src/host/render.js'
import { HELP_PREFIX, parseQuizAction, quizAnswerDisplay } from '../src/quiz/answer.js'
import { clean, verified } from '../src/host/mastery.js'
import { gateProgress } from '../src/host/flow.js'
import { textOf } from './metrics.js'

const statement = '常开处理位都忙时先排队，等候区满了且还没到处理位上限，才开备用位直接处理新任务；两者都满就拒绝。'
export const LEARNING_LOOP_SCENARIO = {
  id: 'learning-loop/help', learningLoop: true, defect: 'assisted-practice',
  expect: { expect: [], prescriptionKeywords: [] },
  course: {
    goal: '理解任务的排队、扩容与拒绝规则', background: '理解基本规律，但有时不理解题里的术语',
    kp: { id: 'task-routing', title: '任务去向', kind: 'knowledge' },
    models: [{ id: 'route', type: 'associative', input: '处理位、等待区与人数上限', output: '新任务去向', reference: statement }],
  },
  statement,
  opening: `我的理解是：${statement} 请给我一道具体情境的互动题。`,
  persona: '已理解排队、扩容与拒绝的基本规律，先读取当前题目给出的机制和条件，再自己推理；不要默认题面没有给的规则。补讲后能区分执行位和等待位。按实际题型回答，选项和理由都回答，诚实说明把握。',
}

export function learningState(cwd) {
  const kp = learnerDocument(cwd, 'kp/task-routing', {})
  const records = learnerEvents(cwd, 'verifications')
  const model = kp.models?.find((m) => m.id === 'route')
  return { records, mastery: model?.mastery, progress: model ? gateProgress(model, records, model.mastery) : null,
    reviews: learnerDocument(cwd, 'reviews') }
}

export function scoreLearningLoop(events, checkpoints) {
  const calls = new Map(), shows = [], writes = [], answers = [], examiner = [], grades = []
  let help = -1, helpId
  for (const [seq, e] of events.entries()) {
    if (e.type === 'user/message' && e.data?.source?.kind === 'user') {
      const text = textOf(e.data.content), action = parseQuizAction(text)
      if (text.startsWith(HELP_PREFIX)) { help = seq; helpId = action?.id }
      if (action?.action === 'answered') answers.push({ seq, ...action })
    }
    if (e.type === 'tool/call') {
      const args = typeof e.data.arguments === 'string' ? JSON.parse(e.data.arguments) : e.data.arguments
      const call = { seq, name: e.data.name, args }
      calls.set(e.data.callId, call)
      if (call.name === 'verification_record') writes.push(call)
      if (call.name === 'examiner') examiner.push(call)
    }
    if (e.type !== 'tool/result' || e.data?.message?.isError) continue
    const call = calls.get(e.data.message.toolCallId)
    if (call?.name === 'examiner') {
      const text = textOf(e.data.message.content).replace(/^[\t ]*(?:#{1,6}[\t ]+)?/gm, '').replace(/\*\*/g, '')
      const verdict = /^【?判定】?\s*[：:]?\s*(correct|partial|wrong)\b/m.exec(text)?.[1]
      if (verdict) grades.push({ seq, call, verdict })
    }
    if (call?.name === 'quiz_show') {
      const view = parseView(textOf(e.data.message.content))
      if (view?.view === 'quiz') shows.push({ seq, ...view })
    }
  }
  const first = shows.find((q) => q.seq < help && q.id === helpId)
  const assisted = answers.find((a) => a.seq > help && a.id === first?.id)
  const next = shows.find((q) => q.seq > assisted?.seq && q.id !== first?.id)
  const independent = answers.find((a) => a.seq > next?.seq && a.id === next?.id)
  const afterHelp = checkpoints.find((c) => c.eventSeq > help && c.eventSeq <= (assisted?.seq ?? Infinity))?.state
  const afterAssisted = checkpoints.find((c) => c.state.records.length === 1)?.state
  const final = checkpoints.at(-1)?.state
  const failures = []
  if (!first || help < 0 || !assisted || !next || !independent) failures.push('help, original-card answer or fresh-card answer missing')
  if (!afterHelp || afterHelp.records.length || afterHelp.mastery !== checkpoints[0]?.state.mastery ||
    JSON.stringify(afterHelp.reviews) !== JSON.stringify(checkpoints[0]?.state.reviews) ||
    shows.some((q) => q.seq > help && q.seq < assisted?.seq) || examiner.some((c) => c.seq > help && c.seq < assisted?.seq) ||
    writes.some((c) => c.seq > help && c.seq < assisted?.seq)) failures.push('help must preserve original question without grading, regeneration or store changes')
  if (afterAssisted?.records[0]?.verdict !== 'correct' || !(afterAssisted?.records[0]?.hintsUsed > 0) || clean(afterAssisted?.records[0] ?? {}) ||
    afterAssisted?.progress?.streak?.have !== 0) failures.push('assisted correct answer must not count as clean mastery evidence')
  if (final?.records.length !== 2 || writes.length !== 2 || !clean(final?.records[1] ?? {}) || final?.progress?.streak?.have !== 1) failures.push('fresh unassisted correct answer must contribute exactly one clean streak')
  const compact = (text) => (text ?? '').replace(/[\s"'“”‘’「」『』]+/gu, '')
  for (const [i, answer] of [assisted, independent].entries()) {
    const write = writes[i], record = final?.records[i]
    const hostGraded = verified(record ?? {}) && record.evidence.messageSeq === events[answer?.seq]?.seq && record.answer === answer?.text
    if (hostGraded) {
      if (!write || write.seq <= answer.seq || write.args.question !== record.question ||
        record.kpId !== 'task-routing' || record.modelId !== 'route' || write.args.kpId !== record.kpId || write.args.modelId !== record.modelId ||
        (i === 1 && record.question === final.records[0].question)) failures.push(`answer ${i + 1} lacks matching host grading/store evidence`)
      continue
    }
    const grade = grades.find((g) => g.call.seq > answer?.seq && g.seq < write?.seq)
    const raw = quizAnswerDisplay(answer?.text ?? '').split('\n').filter((line) => !/^(?:把握|提示)[：:]/u.test(line))
      .map((line) => line.replace(/^(?:·\s*[^→\n]*→\s*)+/u, '')).map(compact).filter(Boolean)
    if (!answer || !write || !record || !grade || write.seq <= answer.seq || grade.verdict !== record.verdict ||
      !raw.length || !raw.every((part) => compact(grade.call.args?.prompt).includes(part)) ||
      write.args?.verdict !== record.verdict || !compact(record.answer) || write.args.answer !== record.answer ||
      write.args.question !== record.question || record.kpId !== 'task-routing' || record.modelId !== 'route' ||
      write.args.kpId !== record.kpId || write.args.modelId !== record.modelId ||
      (i === 1 && record.question === final.records[0].question)) failures.push(`answer ${i + 1} lacks matching fresh grading and store evidence`)
  }
  if (first && next && first.ui === next.ui) failures.push('next question repeats original program')
  return { passed: !failures.length, failures, first, help, assisted, next, independent, writes, checkpoints }
}
