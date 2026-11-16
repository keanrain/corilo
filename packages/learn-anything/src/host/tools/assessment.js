// Evidence-backed verification and diagnosis; mastery changes stay in this path.
import * as store from '../store.js'
import { PHASE_GUIDE } from '../phases.js'
import { informationMastery, factsWithIds, factMasteries, meetsGate, LEVEL_LABEL, QUESTION_TYPES } from '../mastery.js'
import { flowState, calibration, DIFFICULTY, MIN_DIFFICULTY, MAX_DIFFICULTY } from '../flow.js'
import { grade, ratingFor, emptyReviews, RATING_LABEL } from '../review.js'
import { feedbackView, marker } from '../render.js'
import { validateSources } from '../ingest.js'
import { loadRetry, sameQuestion } from '../retry.js'
import { FLASHCARD_PREFIX } from '../../quiz/flashcard.js'
import { HELP_PREFIX, PRACTICE_MARKER } from '../../quiz/answer.js'
import { str, strArray, ATTRIBUTIONS, gateOf, loadVerifications, saveKp, nextExampleId, refreshMastery, progressText } from './shared.js'
import { localMinute } from './review.js'
import { validateComparison, conceptCompareView, CONCEPT_RELATIONS } from '../concept-compare.js'
import { forgottenExamples, examplePracticeText } from '../review.js'

export const FINDING_TYPES = [
  'memorized-wording', // 记言代学
  'lower-layer-loss', // 下层丢失
  'upper-layer-loss', // 上层丢失
  'mismatch', // 下上错配
  'concept-confusion', // 概念混淆
  'missing-prereq', // 缺前置知识
  'positive-transfer', // 正迁移
  'negative-transfer', // 负迁移
  'prefers-examples', // 偏好先例子
  'prefers-rules', // 偏好先规律
  'on-track', // 无明显问题
]

export const verificationRecord = {
  name: 'verification_record',
  description:
    'Step ⑤ 验证模型. The host finds the real learner answer to the displayed question and invokes an independent examiner before recording. Tutor-supplied answers, verdicts, difficulty and confidence are not trusted. This recomputes mastery, schedules spaced review once the model passes the gate, ' +
    'adds the question to the model\'s examples (例习循环), and moves the model to `mastered` when the gate is met, back to `assess` after a wrong answer, ' +
    'and keeps a model already in `verify` there after a correct or partial answer so practice flows straight on (from any other phase it goes to `assess`). Returns the next question\'s difficulty and type (adaptive, keeps the learner in the flow channel). ' +
    'For an information point omit modelId, use questionType "recall", and provide factId when it has more than one fact.',
  parameters: {
    kpId: str('知识点 id', { required: true }),
    modelId: str('模型 id；信息类省略'),
    factId: str('信息类记忆卡 id，见 kp_get；多张卡时必填，单张可省略'),
    retryOf: str('错题重赛的原验证 id，来自 mistakes_get；必须是同一知识点、模型或记忆卡的新场景题'),
    question: str('题目原文', { required: true }),
    questionType: str('题型', { enum: QUESTION_TYPES, required: true }),
    answer: str('兼容旧调用；宿主从真实会话取作答，不采用本字段'),
    verdict: str('兼容旧调用；宿主独立调用考官，不采用本字段', { enum: ['correct', 'partial', 'wrong'] }),
    hintsUsed: { type: 'integer', description: '这道题一共给过几次提示或补讲：作答消息里的「提示：N 次」已含卡片补讲，用户打字要的提示和概念补讲也要加上，不重复累计' },
    difficulty: { type: 'integer', description: '考官【难度】：这道题的难度 1～5' },
    confidence: str('用户作答时说的把握（作答消息里的「把握」）：稳 sure / 有点把握 unsure / 蒙的 guess', { enum: ['sure', 'unsure', 'guess'] }),
    explainedRule: { type: 'boolean', description: '用户是否能说清背后的规律' },
    attribution: str('答错或部分对时的归因', { enum: ATTRIBUTIONS }),
    feedback: str('给用户的反馈要点'),
    novelty: str('examiner 对新颖性的说明：与哪些已有例子不同'),
    sources: strArray('本题实际采用的教材依据：已读取的材料块 id 或已核对的 URL，与出题、判题时一致；无依据时省略'),
    expected: { type: 'object', additionalProperties: false, description: '作为例子写回靶图', properties: { output: str('正确输出 / 判别结论', { required: true }), polarity: str('正例或反例', { enum: ['pos', 'neg'] }) } },
  },
  async execute(args, env) {
    if (String(args.answer ?? '').split(/\r?\n/).some((line) => line.trim() === PRACTICE_MARKER)) {
      throw new Error('理解练习不记验证结果或掌握度；请继续反馈和追问，正式验证另出新情况题')
    }
    if (String(args.answer ?? '').trimStart().startsWith(HELP_PREFIX)) {
      throw new Error('学习补给是求助，不是作答；请先补讲，再收集原题回答')
    }
    if (String(args.answer ?? '').trimStart().startsWith(FLASHCARD_PREFIX)) {
      throw new Error('闪卡自评不是独立回忆的验证证据；请另出未揭晓答案的回忆题，收集回答后再记录')
    }
    const p = store.paths(env.cwd)
    const kp = await store.requireKp(env.cwd, args.kpId)
    const isInfo = kp.kind === 'information'
    if (!isInfo && !args.modelId) throw new Error(`modelId is required; models: ${kp.models.map((m) => m.id).join(', ')}`)
    if (isInfo && args.questionType !== 'recall') throw new Error('information points need recall questions')
    const facts = factsWithIds(kp)
    const factId = isInfo ? args.factId ?? (facts.length === 1 ? facts[0].id : null) : undefined
    if (isInfo && !facts.some((fact) => fact.id === factId)) throw new Error(`choose a valid factId from kp_get: ${facts.map((f) => f.id).join(', ') || '(define facts first)'}`)
    if (!isInfo && args.questionType === 'recall') throw new Error('recall questions do not verify knowledge: ask a new-situation question instead')
    const sources = await validateSources(env.cwd, args.sources)
    const model = isInfo ? null : store.findModel(kp, args.modelId)
    const retry = args.retryOf ? await loadRetry(env.cwd, args.retryOf, { kpId: kp.id, modelId: model?.id, factId }) : null
    if (retry && sameQuestion(args.question, retry.question)) throw new Error('retry question must use a new situation, not repeat the original question')
    if (!env.assessVerification) throw new Error('真实会话与考官证据不可用；不能写入验证记录')
    const assessment = await env.assessVerification(args, { target: { kpId: kp.id, kind: kp.kind, modelId: model?.id, factId, title: kp.title },
      reference: model?.reference ?? facts.find((f) => f.id === factId), examples: model?.targetMap.examples ?? [],
      records: await loadVerifications(env.cwd), attributions: ATTRIBUTIONS })
    if (!QUESTION_TYPES.includes(assessment.questionType) || (isInfo ? assessment.questionType !== 'recall' : assessment.questionType === 'recall')) throw new Error('考官返回的题型不适用于当前目标')
    args = { ...args, ...assessment }
    const now = env.now()
    const before = { level: (model ? model.mastery : kp.mastery) ?? 'none', kp: kp.mastery ?? 'none' }
    const record = {
      id: store.newId('v'), kpId: kp.id, modelId: model?.id, factId, question: args.question, questionType: args.questionType,
      answer: args.answer, verdict: args.verdict, sources, hintsUsed: args.hintsUsed ?? 0, explainedRule: args.explainedRule ?? false,
      evidence: args.evidence, novel: args.novel,
      ...(retry ? { retryOf: retry.id } : {}),
      difficulty: Number.isInteger(args.difficulty) ? Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, args.difficulty)) : undefined, confidence: args.confidence, attribution: args.attribution, feedback: args.feedback, novelty: args.novelty, at: now.toISOString(),
    }
    await store.appendJsonl(p.verifications, record)
    if (model && args.expected) {
      // A discriminate question's answer is its polarity; trust the type over a mislabelled field.
      const polarity = { 'discriminate-pos': 'pos', 'discriminate-neg': 'neg' }[args.questionType] ?? args.expected.polarity
      model.targetMap.examples.push({
        id: nextExampleId(model), tag: 'v', polarity, input: args.question, output: args.expected.output,
        origin: 'verification', checked: true, sources, verificationId: record.id, at: record.at,
      })
    }
    const verifications = await loadVerifications(env.cwd)
    refreshMastery(kp, verifications, gateOf(env))
    const level = model ? model.mastery : informationMastery(verifications.filter((v) => v.kpId === kp.id), gateOf(env), facts)
    const passed = meetsGate(level)
    // In a practice run only a wrong answer sends the model back to diagnosis; a correct or partial one keeps it going.
    // Answers from elsewhere (a review of a mastered model, a quick check while building) keep the old route to assess.
    const practising = model?.phase === 'verify' && record.verdict !== 'wrong'
    if (model) model.phase = passed ? 'mastered' : practising ? 'verify' : 'assess'
    else kp.phase = passed ? 'mastered' : 'memorize'
    await saveKp(env, kp)

    const target = model ? `${kp.id}/${model.id}` : kp.id
    const reviews = await store.readJson(p.reviews, emptyReviews())
    const rating = ratingFor(record)
    // A knowledge model enters spaced review once it first passes the gate; answers while still learning only feed the diagnosis.
    // Information points are memorized by spaced repetition, so they are scheduled from the first recall.
    const scheduled = !model || passed || Boolean(reviews.cards[target])
    const card = scheduled ? grade(reviews, { id: target, kpId: kp.id, modelId: model?.id }, rating, now) : null
    if (scheduled) await store.writeJson(p.reviews, reviews)

    const lines = [
      `已记录（${record.verdict}）。${target} 掌握度：${LEVEL_LABEL[level]}；知识点：${LEVEL_LABEL[kp.mastery]}。`,
      card ? `复习评分 ${RATING_LABEL[rating]}，下次复习 ${localMinute(new Date(card.due))}。` : '还在学习中，暂不排复习，达标后开始间隔复习。',
    ]
    if (sources.length) lines.push(`判题依据：${sources.join('、')}`)
    if (model && scheduled && record.verdict === 'wrong') {
      const examples = forgottenExamples(model, verifications.filter((v) => v.kpId === kp.id), record.id)
      if (examples.length) lines.push(examplePracticeText(examples))
    }
    if (isInfo && !passed) {
      const levels = factMasteries(verifications.filter((v) => v.kpId === kp.id), gateOf(env), facts)
      lines.push(`未达标记忆卡：${facts.filter((_, i) => !meetsGate(levels[i])).map((fact) => fact.id).join('、')}；按 kp_get 的卡片继续记忆。`)
    }
    const flow = model ? flowState(model, verifications.filter((v) => v.kpId === kp.id && v.modelId === model.id), level, gateOf(env)) : null
    if (passed) lines.push(kp.phase === 'mastered' ? '该知识点已达标，可以进入下一个知识点。' : '该模型已达标，继续本知识点的下一个模型。')
    if (flow && !passed) {
      lines.push(`下一题：难度 ${flow.next} 级（${DIFFICULTY[flow.next]}；${flow.reason}），题型建议 ${flow.nextType}。${progressText(flow.progress)}`)
      if (!practising) lines.push(`回到评估学况：${PHASE_GUIDE.assess} 诊断后用一道 ${flow.next} 级的题重新验证（这已经是调整后的难度，不要再降）。`)
      else lines.push('留在验证阶段；若有缺前置或同一缺口反复出现的证据，先按 diagnose 重新检查任务。适合继续时，一两句话点评后，同一轮请考官按建议出下一题并 quiz_show。')
    }
    // The learner's feedback card (verdict, calibration, flow channel, what is left); the examiner's feedback stays with the tutor.
    const view = feedbackView({
      kp, model, record, level: { from: before.level, to: level }, kpLevel: { from: before.kp, to: kp.mastery }, passed,
      flow, calibration: calibration(record.confidence, record.verdict), retry,
    })
    return lines.join('\n') + marker(view)
  },
}

/** Finding types that describe a strength or a preference, not something to fix. */
const NOT_PROBLEMS = new Set(['on-track', 'positive-transfer', 'prefers-examples', 'prefers-rules'])

export const diagnosisRecord = {
  name: 'diagnosis_record',
  description:
    'Step ② 评估学况. Record a diagnosis of how the learner is doing on one model, every finding backed by concrete evidence ' +
    '(a quoted answer or a verification id), plus the prescription you will follow. Moves the model from assess to prescribe.',
  parameters: {
    kpId: str('知识点 id', { required: true }),
    modelId: str('模型 id'),
    findings: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: str('诊断类型', { enum: FINDING_TYPES, required: true }),
          evidence: str('证据：引用用户的回答或验证记录 id', { required: true }),
        },
      },
    },
    prescription: strArray('处方：接下来准备什么材料、怎么教'),
    comparison: { type: 'object', additionalProperties: false, description: 'concept-confusion 必填：外延关系、特征矩阵和对比例组；会直接显示概念对比卡片', properties: {
      left: str('概念 A', { required: true }), right: str('概念 B', { required: true }),
      relation: str('A 与 B 的外延关系', { enum: CONCEPT_RELATIONS, required: true }),
      features: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        feature: str('比较特征', { required: true }), left: str('A 的特征', { required: true }), right: str('B 的特征', { required: true }),
      } } },
      examples: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        input: str('具体情况', { required: true }), left: { type: 'boolean', required: true, description: '属于 A' },
        right: { type: 'boolean', required: true, description: '属于 B' }, reason: str('判别依据', { required: true }),
      } } },
    } },
  },
  async execute(args, env) {
    const kp = await store.requireKp(env.cwd, args.kpId)
    const model = args.modelId ? store.findModel(kp, args.modelId) : null
    if (!args.findings.length) throw new Error('give at least one finding (use on-track when nothing is wrong)')
    for (const f of args.findings) if (!f.evidence.trim()) throw new Error(`finding ${f.type} needs evidence`)
    const comparison = args.comparison || args.findings.some((f) => f.type === 'concept-confusion') ? validateComparison(args.comparison) : null
    const p = store.paths(env.cwd)
    await store.appendJsonl(p.diagnoses, {
      id: store.newId('d'), kpId: kp.id, modelId: model?.id, findings: args.findings,
      prescription: args.prescription ?? [], ...(comparison ? { comparison } : {}), at: env.now().toISOString(),
    })
    const types = args.findings.map((f) => f.type)
    const prefer = types.includes('prefers-examples') ? 'example-first' : types.includes('prefers-rules') ? 'rule-first' : null
    if (prefer) {
      const course = await store.readJson(p.course, null)
      if (course) await store.writeJson(p.course, { ...course, learner: { ...course.learner, preferOrder: prefer } })
    }
    // Nothing to fix and the learner's statement is written: go on verifying with new situations
    // instead of preparing materials again.
    let next = null
    if (model && (model.phase === 'assess' || model.phase === 'verify')) {
      next = types.every((t) => NOT_PROBLEMS.has(t)) && model.targetMap.statement ? 'verify' : 'prescribe'
      model.phase = next
      await saveKp(env, kp)
    }
    return `已记录诊断：${types.join('、')}。${next ? `${kp.id}/${model.id} → ${next}。${PHASE_GUIDE[next]}` : ''}` + (comparison ? '\n' + conceptCompareView(kp, model, comparison) : '')
  },
}
