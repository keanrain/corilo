/**
 * Tutor tools as plain definitions: `{ name, description, parameters, execute(args, env) }`.
 * `index.js` wraps them with dsh's `defineTool`; tests call `execute` directly.
 * `env` = `{ cwd, now(), userTexts(), gate }`, where `userTexts()` returns what the learner
 * actually typed in this session, or null when that is unavailable.
 * @module learn-anything/tools
 */
import * as store from './store.js'
import { transitionError, kpPhase, PHASE_GUIDE } from './phases.js'
import { kpMastery, modelMastery, informationMastery, factsWithIds, factMasteries, meetsGate, verified, LEVEL_LABEL, QUESTION_TYPES, DEFAULT_GATE } from './mastery.js'
import { flowState, calibration, DIFFICULTY, MIN_DIFFICULTY, MAX_DIFFICULTY } from './flow.js'
import { grade, ratingFor, due, emptyReviews, activeReviews, RATING_LABEL } from './review.js'
import { targetMapView, outlineView, progressView, feedbackView, marker } from './render.js'
import { validateSources } from './ingest.js'
import { loadRetry, listMistakes, sameQuestion } from './retry.js'
import { FLASHCARD_PREFIX } from '../quiz/flashcard.js'
import { HELP_PREFIX, PRACTICE_MARKER } from '../quiz/answer.js'
import { isRuleStatement } from './assessment.js'

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

const ATTRIBUTION_LABEL = {
  'memorized-wording': '记言代学', 'lower-layer-loss': '下层丢失', 'upper-layer-loss': '上层丢失', mismatch: '下上错配',
  'concept-confusion': '概念混淆', 'missing-prereq': '缺前置知识', careless: '粗心',
}
const ATTRIBUTIONS = Object.keys(ATTRIBUTION_LABEL)

const str = (description, extra = {}) => ({ type: 'string', description, ...extra })
const strArray = (description) => ({ type: 'array', items: { type: 'string' }, description })

const exampleSpec = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tag: str('d 规述 / e 例述 / t 迁移(类比或对比) / v 验证题转来的例子', { enum: ['d', 'e', 't', 'v'], required: true }),
    polarity: str('正例 pos / 反例 neg；规述可省略', { enum: ['pos', 'neg'] }),
    input: str('具体输入或情境', { required: true }),
    output: str('对应输出或判别结论', { required: true }),
    reasoning: str('从输入推到输出的理由（规律如何落在这个例子上）'),
    origin: str('material 来自材料 / ai 由你生成 / user 用户自己举的', { enum: ['material', 'ai', 'user'], required: true }),
    checked: { type: 'boolean', description: '是否已经过 checker 校验；AI 生成的例子校验通过后才能为 true' },
    source: str('材料块 id 或 URL'),
  },
}

/* ---------- helpers ---------- */

const gateOf = (env) => env.gate ?? DEFAULT_GATE

async function loadVerifications(cwd) {
  return store.readJsonl(store.paths(cwd).verifications)
}

async function saveKp(env, kp) {
  kp.phase = kpPhase(kp)
  kp.updatedAt = env.now().toISOString()
  await store.writeJson(store.paths(env.cwd).kp(kp.id), kp)
}

/** Next free example id on a model; counting would reuse the id of a removed example. */
function nextExampleId(model) {
  const used = model.targetMap.examples.map((e) => Number(/-e(\d+)$/.exec(e.id)?.[1] ?? 0))
  return `${model.id}-e${Math.max(0, ...used) + 1}`
}

/** Recompute stored mastery for every model of one knowledge point. */
function refreshMastery(kp, verifications, gate) {
  const own = verifications.filter((v) => v.kpId === kp.id)
  for (const model of kp.models) {
    model.mastery = modelMastery(model, own.filter((v) => v.modelId === model.id), gate)
    if (model.phase === 'mastered' && !meetsGate(model.mastery)) model.phase = 'assess'
  }
  kp.mastery = kpMastery(kp, verifications, gate)
  if (kp.kind === 'information' && kp.phase === 'mastered' && !meetsGate(kp.mastery)) kp.phase = 'memorize'
  if (kp.kind !== 'information') kp.phase = kpPhase(kp)
}

/** Recompute information coverage on read too: old multi-fact records may overstate mastery. */
async function learningKps(env) {
  const kps = await store.listKps(env.cwd)
  const verifications = await loadVerifications(env.cwd)
  for (const kp of kps) refreshMastery(kp, verifications, gateOf(env))
  return kps
}

function normalize(text) {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

/** The 不代写 rule: a statement must be the learner's own words from this session. */
function assertUserWords(text, env) {
  const texts = env.userTexts?.()
  if (texts == null) throw new Error('learner message evidence unavailable; statement rejected')
  const needle = normalize(text)
  if (needle.length < 4) throw new Error('statement is too short to be a real statement of the rule')
  if (texts.filter(isRuleStatement).some((t) => t.split(/[。！!；;\n：:]+/u).some((part) => normalize(part) === needle))) return 'verified'
  throw new Error(
    'statement rejected: this text does not appear in anything the learner typed in this session. ' +
    'Statements on the target map must be the learner\'s own words — copy their wording exactly, ' +
    'or ask them to write or revise it themselves. Do not summarize the rule for them.',
  )
}

function currentKp(course, kps) {
  const byId = new Map(kps.map((kp) => [kp.id, kp]))
  const visit = (id, seen = new Set()) => {
    const kp = byId.get(id)
    if (!kp || kp.phase === 'mastered' || kp.skipped) return null
    if (seen.has(id)) throw new Error(`cyclic prerequisites: ${id}`)
    const path = new Set([...seen, id])
    for (const dep of kp.prerequisites ?? []) {
      const next = visit(dep, path)
      if (next) return next
    }
    return kp
  }
  for (const ch of course.chapters) {
    for (const id of ch.kpIds) {
      const kp = visit(id)
      if (kp) return kp
    }
  }
  return null
}

function describeModel(m) {
  return m.type === 'discriminative' ? `判别「${m.concept}」` : `联结「${m.input}」→「${m.output}」`
}

/* ---------- tools ---------- */

export const learnStatus = {
  name: 'learn_status',
  description:
    'Snapshot of the learner\'s course in this workspace: goal, current knowledge point and model, teaching phase with what to do in it, ' +
    'latest diagnosis, and due reviews. Call it at the start of every session and whenever you are unsure what comes next.',
  parameters: {},
  readOnly: true,
  async execute(_args, env) {
    const p = store.paths(env.cwd)
    const course = await store.readJson(p.course, null)
    if (!course) {
      return '尚无课程。进入目标接入：询问学习目标、现有基础、可用时间、学习目的、偏好（先例子还是先规律）、是否有材料（PDF/EPUB/TXT/代码仓库路径），然后按 plan-course 技能规划。'
    }
    const kps = await learningKps(env)
    const reviews = await store.readJson(p.reviews, emptyReviews())
    const dueCards = due(activeReviews(reviews, course, kps), env.now())
    const diagnoses = await store.readJsonl(p.diagnoses)
    const lines = [`目标：${course.goal}`, `课程状态：${course.status}`]
    if ((await loadVerifications(env.cwd)).some((v) => !verified(v))) lines.push('历史中有未核验来源的旧成绩：保留供回看，不计掌握度；需要重新验证。')
    if (course.learner && Object.keys(course.learner).length) lines.push(`学习者：${JSON.stringify(course.learner)}`)
    if (course.status === 'planning') {
      lines.push('大纲尚未确认：展示 course_get 的结果，请用户增删改；确认后用 course_save(status="active") 锁定。')
    }
    const kp = currentKp(course, kps)
    if (kp) {
      lines.push('', `当前知识点：${kp.title}（${kp.id}，${kp.kind === 'information' ? '信息' : '知识'}），阶段 ${kp.phase}，掌握度 ${LEVEL_LABEL[kp.mastery ?? 'none']}`)
      const verifications = kp.models.length ? (await loadVerifications(env.cwd)).filter((v) => v.kpId === kp.id) : []
      for (const m of kp.models) {
        lines.push(`- 模型 ${m.id} ${describeModel(m)}：阶段 ${m.phase}，掌握度 ${LEVEL_LABEL[m.mastery ?? 'none']}，用户表述${m.targetMap.statement ? '已写' : '未写'}，例子 ${m.targetMap.examples.length} 个`)
        if (m.phase === 'verify' || m.phase === 'mastered') {
          const flow = flowState(m, verifications.filter((v) => v.modelId === m.id), m.mastery ?? 'none', gateOf(env))
          lines.push(`  下一道验证题：难度 ${flow.next} 级（${DIFFICULTY[flow.next]}），题型建议 ${flow.nextType}。${progressText(flow.progress)}`)
        }
      }
      lines.push(`本阶段要做：${PHASE_GUIDE[kp.phase]}`)
      const last = diagnoses.filter((d) => d.kpId === kp.id).at(-1)
      if (last) lines.push(`最近诊断：${last.findings.map((f) => f.type).join('、')} → 处方：${last.prescription.join('；')}`)
    } else if (course.status !== 'planning') {
      lines.push('', '大纲中的知识点都已达标或跳过。可以复习、拓展或设定新目标。')
    }
    if (dueCards.length) lines.push('', `待复习 ${dueCards.length} 项：先调用 review_due 处理复习，再继续新内容。`)
    return lines.join('\n')
  },
}

export const courseSave = {
  name: 'course_save',
  description:
    'Create or revise the course: goal, learner profile, chapters with knowledge points, and resources. Send the COMPLETE outline each time. ' +
    'Existing knowledge points keep their progress when their id is reused. Save with status "planning" until the learner confirms the outline, then "active".',
  parameters: {
    goal: str('学习目标（用户的话）', { required: true }),
    status: str('planning 待确认 / active 已确认 / done 完成', { enum: ['planning', 'active', 'done'], required: true }),
    learner: {
      type: 'object',
      additionalProperties: true,
      description: 'background 现有基础, timeBudget 可用时间, purpose 学习目的, preferOrder example-first|rule-first|unknown, knownConcepts 已掌握且可用于类比的概念',
      properties: {
        background: str('现有基础'),
        timeBudget: str('可用时间'),
        purpose: str('学习目的'),
        preferOrder: str('偏好', { enum: ['example-first', 'rule-first', 'unknown'] }),
        knownConcepts: strArray('已掌握、可用来类比解释的概念'),
      },
    },
    chapters: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: str('章节标题', { required: true }),
          kps: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: str('稳定 id，如 ch1-function（字母数字 . _ -）', { required: true }),
                title: str('知识点标题', { required: true }),
                kind: str('knowledge 知识（可预测新情况的规律） / information 信息（单个事实，只需记忆）', { enum: ['knowledge', 'information'], required: true }),
                prerequisites: strArray('前置知识点 id'),
                estMinutes: { type: 'integer', description: '预计学习分钟数' },
                sources: strArray('材料块 id 或 URL'),
              },
            },
          },
        },
      },
    },
    resources: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { title: str('标题', { required: true }), url: str('URL 或材料 id', { required: true }), note: str('说明') },
      },
    },
  },
  async execute(args, env) {
    const p = store.paths(env.cwd)
    const prev = await store.readJson(p.course, null)
    const ids = new Set()
    const sources = new Map()
    const pending = []
    for (const ch of args.chapters) {
      for (const kp of ch.kps) {
        store.safeId(kp.id)
        if (ids.has(kp.id)) throw new Error(`duplicate knowledge point id ${kp.id}`)
        ids.add(kp.id)
      }
    }
    for (const ch of args.chapters) {
      for (const kp of ch.kps) {
        const missing = (kp.prerequisites ?? []).filter((id) => !ids.has(id))
        if (missing.length) throw new Error(`${kp.id}: unknown prerequisites ${missing.join(', ')}`)
        sources.set(kp.id, await validateSources(env.cwd, kp.sources))
      }
    }
    const specs = new Map(args.chapters.flatMap((ch) => ch.kps).map((kp) => [kp.id, kp]))
    const done = new Set()
    const check = (id, path = new Set()) => {
      if (path.has(id)) throw new Error(`cyclic prerequisites: ${id}`)
      if (done.has(id)) return
      for (const dep of specs.get(id).prerequisites ?? []) check(dep, new Set([...path, id]))
      done.add(id)
    }
    for (const id of ids) check(id)
    const now = env.now().toISOString()
    let created = 0
    for (const ch of args.chapters) {
      for (const spec of ch.kps) {
        const existing = await store.readJson(p.kp(spec.id), null)
        if (existing && existing.kind !== spec.kind && (existing.models.length || existing.facts?.length)) {
          throw new Error(`${spec.id} already has learning content as ${existing.kind}; give the new item a different id instead of changing its kind`)
        }
        const kp = existing ?? { id: spec.id, models: [], facts: [], phase: 'describe', mastery: 'none', createdAt: now }
        if (!existing) created++
        Object.assign(kp, {
          title: spec.title, kind: spec.kind, prerequisites: spec.prerequisites ?? [],
          estMinutes: spec.estMinutes, sources: sources.get(spec.id),
        })
        pending.push(kp)
      }
    }
    for (const kp of pending) await saveKp(env, kp)
    const course = {
      version: 1,
      goal: args.goal,
      status: args.status,
      learner: { ...(prev?.learner ?? {}), ...(args.learner ?? {}) },
      chapters: args.chapters.map((ch, i) => ({ id: `ch${i + 1}`, title: ch.title, kpIds: ch.kps.map((k) => k.id) })),
      resources: args.resources ?? prev?.resources ?? [],
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    }
    await store.writeJson(p.course, course)
    const dropped = (prev?.chapters ?? []).flatMap((c) => c.kpIds).filter((id) => !ids.has(id))
    const note = `已保存：${ids.size} 个知识点（新建 ${created}）。` + (dropped.length ? `已从大纲移除（数据保留）：${dropped.join(', ')}。` : '')
    return note + '\n\n' + outlineView(course, await learningKps(env))
  },
}

export const courseGet = {
  name: 'course_get',
  description: 'Show the course outline (chapters, knowledge points, mastery, resources) as a card the learner can see.',
  parameters: {},
  readOnly: true,
  async execute(_args, env) {
    const course = await store.requireCourse(env.cwd)
    return outlineView(course, await learningKps(env))
  },
}

export const kpGet = {
  name: 'kp_get',
  description:
    'Show one knowledge point\'s 渐构靶图 (target map): each model\'s user statement (upper layer) and its examples and recent verifications (lower layer). ' +
    'The learner sees it as a card. Also returns the reference rules you defined, which you must not reveal before the learner states the rule themselves.',
  parameters: { kpId: str('知识点 id', { required: true }) },
  readOnly: true,
  async execute(args, env) {
    const kp = await store.requireKp(env.cwd, args.kpId)
    const verifications = await loadVerifications(env.cwd)
    refreshMastery(kp, verifications, gateOf(env))
    const view = targetMapView(kp, verifications)
    const refs = kp.models.map((m) => `- ${m.id} ${describeModel(m)}：${m.reference}`).join('\n')
    const factLevels = factMasteries(verifications.filter((v) => v.kpId === kp.id), gateOf(env), factsWithIds(kp))
    const facts = kp.facts?.length ? '\n\n记忆卡：\n' + factsWithIds(kp).map((f, i) => `- ${f.id}: ${f.prompt} → ${f.answer}（${LEVEL_LABEL[factLevels[i]]}）`).join('\n') : ''
    return `${view}\n\n[仅供导师参考，在用户自己写出前不要直接告诉用户]\n${refs || '（尚未定义模型）'}${facts}`
  },
}

export const kpDefineModels = {
  name: 'kp_define_models',
  description:
    'Step ① 描述知识. For a knowledge point, define its models: usually an input-concept discriminative model, an output-concept discriminative model, ' +
    'and an input→output associative model. `reference` is YOUR description of the rule, used by the examiner and checker; the learner\'s own statement is recorded separately. ' +
    'For an information point, give `facts` (flashcards) instead. Reusing a model id keeps progress only for an unchanged definition; after any answer, a changed definition needs a new id.',
  parameters: {
    kpId: str('知识点 id', { required: true }),
    models: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: str('模型 id，如 in / out / map', { required: true }),
          type: str('discriminative 判别 / associative 联结', { enum: ['discriminative', 'associative'], required: true }),
          concept: str('判别模型：被判别的概念'),
          input: str('联结模型：输入概念'),
          output: str('联结模型：输出概念'),
          reference: str('参考规律：判别模型写共有属性（满足什么就是该概念），联结模型写输入如何决定输出', { required: true }),
        },
      },
    },
    facts: {
      type: 'array',
      description: '信息类知识点的记忆卡',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { id: str('稳定卡片 id；新增可省略，重存沿用'), prompt: str('提问', { required: true }), answer: str('答案', { required: true }) },
      },
    },
  },
  async execute(args, env) {
    const kp = await store.requireKp(env.cwd, args.kpId)
    if (kp.kind === 'information') {
      if (args.models?.length) throw new Error(`${kp.id} is information: give facts, not models (or re-plan it as knowledge)`)
      if (!args.facts?.length) throw new Error('give at least one fact for an information point')
      const oldFacts = factsWithIds(kp)
      const verifications = await loadVerifications(env.cwd)
      const seen = new Set()
      const facts = args.facts.map((fact) => {
        const old = fact.id ? oldFacts.find((f) => f.id === fact.id) : oldFacts.find((f) => f.prompt === fact.prompt && f.answer === fact.answer && !seen.has(f.id))
        const id = fact.id ?? old?.id ?? store.newId('f')
        store.safeId(id)
        if (seen.has(id)) throw new Error(`duplicate fact id ${id}`)
        seen.add(id)
        if ((!old || old.prompt !== fact.prompt || old.answer !== fact.answer) && verifications.some((v) => v.kpId === kp.id && (v.factId === id || (!v.factId && (old || id === 'fact-1'))))) {
          throw new Error(`${id}: an answered fact cannot change its definition; use a new fact id`)
        }
        return { ...fact, id }
      })
      kp.facts = facts
      refreshMastery(kp, verifications, gateOf(env))
      if (kp.phase === 'describe') kp.phase = 'memorize'
      await saveKp(env, kp)
      return `已保存 ${kp.facts.length} 张记忆卡：${kp.facts.map((f) => f.id).join('、')}。${kp.phase === 'memorize' ? '进入记忆阶段。' : ''}${PHASE_GUIDE[kp.phase]}`
    }
    if (!args.models?.length) throw new Error('give at least one model for a knowledge point')
    const verifications = await loadVerifications(env.cwd)
    const next = []
    for (const spec of args.models) {
      store.safeId(spec.id)
      if (next.some((n) => n.id === spec.id)) throw new Error(`duplicate model id ${spec.id}`)
      if (spec.type === 'discriminative' && !spec.concept) throw new Error(`${spec.id}: a discriminative model needs concept`)
      if (spec.type === 'associative' && (!spec.input || !spec.output)) throw new Error(`${spec.id}: an associative model needs input and output`)
      const old = kp.models.find((m) => m.id === spec.id)
      const changed = old && ['type', 'concept', 'input', 'output', 'reference'].some((key) => old[key] !== spec[key])
      if ((!old || changed) && verifications.some((v) => v.kpId === kp.id && v.modelId === spec.id)) {
        throw new Error(`${spec.id}: an answered model cannot change its definition; use a new model id`)
      }
      next.push({
        ...(old ?? { phase: 'assess', mastery: 'none', targetMap: { statement: null, examples: [] } }),
        ...spec,
      })
    }
    const removed = kp.models.filter((m) => !next.some((n) => n.id === m.id)).map((m) => m.id)
    kp.models = next
    refreshMastery(kp, verifications, gateOf(env))
    await saveKp(env, kp)
    return `已定义 ${next.length} 个模型${removed.length ? `（移除 ${removed.join(', ')}）` : ''}，进入评估学况。${PHASE_GUIDE.assess}`
  },
}

export const kpSetPhase = {
  name: 'kp_set_phase',
  description:
    'Move one model (or an information point) to another teaching phase. Allowed: describe→assess→prescribe→build→verify; build→prescribe; verify→assess; ' +
    'any→describe to re-split the knowledge; information: describe→memorize. `mastered` is set only by verification_record.',
  parameters: {
    kpId: str('知识点 id', { required: true }),
    modelId: str('模型 id；信息类知识点省略'),
    phase: str('目标阶段', { enum: ['describe', 'assess', 'prescribe', 'build', 'verify', 'memorize'], required: true }),
    reason: str('为什么切换', { required: true }),
  },
  async execute(args, env) {
    const kp = await store.requireKp(env.cwd, args.kpId)
    if (kp.kind === 'information') {
      const error = transitionError('information', kp.phase, args.phase)
      if (error) throw new Error(error)
      kp.phase = args.phase
      await saveKp(env, kp)
      return `${kp.id} → ${args.phase}。${PHASE_GUIDE[args.phase]}`
    }
    if (!args.modelId) throw new Error(`modelId is required for a knowledge point; models: ${kp.models.map((m) => m.id).join(', ')}`)
    const model = store.findModel(kp, args.modelId)
    const error = transitionError('knowledge', model.phase, args.phase)
    if (error) throw new Error(error)
    model.phase = args.phase
    await saveKp(env, kp)
    return `${kp.id}/${model.id} → ${args.phase}。${PHASE_GUIDE[args.phase]}`
  },
}

export const targetMapUpdate = {
  name: 'target_map_update',
  description:
    'Edit one model\'s target map. `statement` records the learner\'s own statement of the rule (内涵 for a discriminative model, 映射规律 for an associative one) — ' +
    'it must be the learner\'s exact words from this conversation and is rejected otherwise. `addExamples` adds lower-layer examples; AI-made examples should be checked first. ' +
    'Pass `show: true` to show the learner the updated card.',
  parameters: {
    kpId: str('知识点 id', { required: true }),
    modelId: str('模型 id', { required: true }),
    statement: str('用户的原话（逐字）'),
    addExamples: { type: 'array', items: exampleSpec },
    markChecked: strArray('已通过 checker 校验的例子 id'),
    removeExampleIds: strArray('删除的例子 id（例如校验发现错误的例子）'),
    show: { type: 'boolean', description: '更新后向用户展示靶图卡片' },
  },
  async execute(args, env) {
    const kp = await store.requireKp(env.cwd, args.kpId)
    const model = store.findModel(kp, args.modelId)
    for (const example of args.addExamples ?? []) {
      if (example.origin === 'material' && !example.source?.trim()) throw new Error('material examples need a source block ref or URL')
      if (example.source !== undefined) await validateSources(env.cwd, [example.source])
    }
    const notes = []
    if (args.statement !== undefined) {
      const status = assertUserWords(args.statement, env)
      const prev = model.targetMap.statement
      model.targetMap.statement = {
        text: args.statement,
        source: 'user',
        verified: status === 'verified',
        history: prev ? [...prev.history, { text: prev.text, at: prev.at }] : [],
        at: env.now().toISOString(),
      }
      notes.push(prev ? '已更新用户表述' : '已记录用户表述')
    }
    if (args.removeExampleIds?.length) {
      const before = model.targetMap.examples.length
      model.targetMap.examples = model.targetMap.examples.filter((e) => !args.removeExampleIds.includes(e.id))
      notes.push(`删除例子 ${before - model.targetMap.examples.length} 个`)
    }
    for (const id of args.markChecked ?? []) {
      const example = model.targetMap.examples.find((e) => e.id === id)
      if (!example) throw new Error(`no example ${id} on ${kp.id}/${model.id}`)
      example.checked = true
    }
    if (args.markChecked?.length) notes.push(`标记已校验 ${args.markChecked.length} 个`)
    for (const e of args.addExamples ?? []) {
      model.targetMap.examples.push({ id: nextExampleId(model), ...e, checked: e.checked ?? false, at: env.now().toISOString() })
    }
    if (args.addExamples?.length) {
      const unchecked = args.addExamples.filter((e) => e.origin === 'ai' && !e.checked).length
      notes.push(`新增例子 ${args.addExamples.length} 个${unchecked ? `，其中 ${unchecked} 个 AI 例子未校验，请交给 checker` : ''}`)
    }
    refreshMastery(kp, await loadVerifications(env.cwd), gateOf(env))
    await saveKp(env, kp)
    const summary = notes.join('；') || '无改动'
    return args.show ? `${summary}\n\n${targetMapView(kp, await loadVerifications(env.cwd))}` : summary
  },
}

/** `YYYY-MM-DD HH:mm` in the host's local time zone (the learner's machine). */
function localMinute(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * How long ago `then` was, as the learner would say it, in the host's local time zone:
 * 刚刚 / N 分钟前 / N 小时前 (same day) / 昨天 HH:mm / N 天前.
 */
export function timeAgo(then, now) {
  const minutes = Math.floor((now - then) / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((day(now) - day(then)) / 86400000)
  if (days <= 0) return `${Math.floor(minutes / 60)} 小时前`
  if (days === 1) return `昨天 ${localMinute(then).slice(11)}`
  return `${days} 天前`
}

/**
 * Days in a row (host local time) with at least one answered question, ending today, or
 * yesterday while today has none yet (the streak is still alive until today ends).
 */
export function streakOf(verifications, now) {
  const days = new Set(verifications.map((v) => localMinute(new Date(v.at)).slice(0, 10)))
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const today = days.has(localMinute(day).slice(0, 10))
  if (!today) day.setDate(day.getDate() - 1)
  let streak = 0
  while (days.has(localMinute(day).slice(0, 10))) {
    streak++
    day.setDate(day.getDate() - 1)
  }
  return { streak, today }
}

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

/** What is left before the next level, for the tutor. */
function progressText(progress) {
  if (!progress) return ''
  const parts = []
  if (progress.streak && progress.streak.have < progress.streak.need) parts.push(`再连续答对 ${progress.streak.need - progress.streak.have} 题（无提示、不是蒙的）`)
  for (const t of progress.missing) parts.push(t === 'own-pos' ? '用户自己举一个正例' : t === 'own-neg' ? '用户自己举一个反例' : `答对一道 ${t}`)
  const name = LEVEL_LABEL[progress.target]
  return parts.length ? `离「${name}」还差：${parts.join('、')}。` : ''
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
  },
  async execute(args, env) {
    const kp = await store.requireKp(env.cwd, args.kpId)
    const model = args.modelId ? store.findModel(kp, args.modelId) : null
    if (!args.findings.length) throw new Error('give at least one finding (use on-track when nothing is wrong)')
    for (const f of args.findings) if (!f.evidence.trim()) throw new Error(`finding ${f.type} needs evidence`)
    const p = store.paths(env.cwd)
    await store.appendJsonl(p.diagnoses, {
      id: store.newId('d'), kpId: kp.id, modelId: model?.id, findings: args.findings,
      prescription: args.prescription ?? [], at: env.now().toISOString(),
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
    return `已记录诊断：${types.join('、')}。${next ? `${kp.id}/${model.id} → ${next}。${PHASE_GUIDE[next]}` : ''}`
  },
}

export const reviewDue = {
  name: 'review_due',
  description:
    'List spaced-review items that are due. For a knowledge model, review means a NEW situation question from the examiner (never repeat an old one); ' +
    'for an information point, use its flashcards. Record each answer with verification_record.',
  parameters: { limit: { type: 'integer', description: '最多返回几项，默认 10' } },
  readOnly: true,
  async execute(args, env) {
    const reviews = await store.readJson(store.paths(env.cwd).reviews, emptyReviews())
    const course = await store.readJson(store.paths(env.cwd).course, null)
    const kps = await learningKps(env)
    const now = env.now()
    const items = due(activeReviews(reviews, course, kps), now).slice(0, args.limit ?? 10)
    if (!items.length) return '今天没有到期的复习。'
    // The tutor has no clock of its own: give it the time of each item's last answer so it
    // does not guess (「昨天那道」 for a question asked minutes ago).
    const lines = [`现在 ${localMinute(now)}。到期复习 ${items.length} 项：`]
    for (const item of items) {
      const kp = await store.readJson(store.paths(env.cwd).kp(item.kpId), null)
      if (!kp) continue
      const model = item.modelId ? kp.models.find((m) => m.id === item.modelId) : null
      const last = item.card.last_review ? new Date(item.card.last_review) : null
      const when = last ? `（上次答题 ${timeAgo(last, now)}，${localMinute(last)}）` : ''
      lines.push(model
        ? `- ${kp.title} / ${model.id} ${describeModel(model)}${when}：请 examiner 出一道新情况题`
        : `- ${kp.title}（信息）${when}：用记忆卡提问`)
    }
    return lines.join('\n')
  },
}

export const progressGet = {
  name: 'progress_get',
  description: 'Show the learner an overview card: mastery counts, due reviews, and weak points with reasons.',
  parameters: {},
  readOnly: true,
  async execute(_args, env) {
    const p = store.paths(env.cwd)
    const course = await store.requireCourse(env.cwd)
    const inOutline = new Set(course.chapters.flatMap((c) => c.kpIds))
    const kps = (await learningKps(env)).filter((kp) => inOutline.has(kp.id))
    const verifications = await loadVerifications(env.cwd)
    const reviews = await store.readJson(p.reviews, emptyReviews())
    const weak = []
    for (const kp of kps) {
      const wrong = verifications.filter((v) => v.kpId === kp.id && v.verdict !== 'correct')
      if (wrong.length >= 2 && !meetsGate(kp.mastery ?? 'none')) {
        const causes = [...new Set(wrong.map((v) => ATTRIBUTION_LABEL[v.attribution] ?? v.attribution).filter(Boolean))]
        weak.push({ id: kp.id, title: kp.title, reason: `${wrong.length} 次未答对${causes.length ? `，归因：${causes.join('、')}` : ''}` })
      }
    }
    return progressView(course, kps, due(activeReviews(reviews, course, kps), env.now()), weak)
  },
}

/**
 * The numbers behind the Web composer chip: reviews due now, the share of outline
 * knowledge points at 熟练 or above, and the daily streak.
 * Null when the workspace has no course.
 */
export async function learnStats(cwd, now, gate) {
  const p = store.paths(cwd)
  const course = await store.readJson(p.course, null)
  if (!course) return null
  const inOutline = new Set(course.chapters.flatMap((c) => c.kpIds))
  const kps = (await learningKps({ cwd, gate })).filter((kp) => inOutline.has(kp.id))
  const mastered = kps.filter((kp) => meetsGate(kp.mastery ?? 'none')).length
  const reviews = await store.readJson(p.reviews, emptyReviews())
  const verifications = await loadVerifications(cwd)
  return {
    goal: course.goal,
    due: due(activeReviews(reviews, course, kps), now).length,
    total: kps.length,
    mastered,
    percent: kps.length ? Math.round((mastered / kps.length) * 100) : 0,
    ...streakOf(verifications, now),
  }
}

export const mistakesGet = {
  name: 'mistakes_get',
  description: 'List active wrong or partial verifications, newest first, excluding mistakes resolved by a correct retry. Ask the examiner for a NEW situation testing the same kpId/modelId/factId; do not copy the original question. Pass the original id as retryOf to quiz_show and verification_record. Use the normal grading rules; a retry awards no bonus mastery.',
  parameters: { kpId: str('仅查看此知识点，可省略'), limit: { type: 'integer', description: '最多返回几项，默认 10，上限 30' } },
  readOnly: true,
  async execute(args, env) {
    const items = await listMistakes(env.cwd, args)
    return items.length ? JSON.stringify(items, null, 2) + '\n请考官围绕同一知识点生成新场景，不照抄旧题。选定一条后，在展示题卡时就调用 quiz_show({ui, question, retryOf: 原记录id})；判题记录再调用 verification_record({..., retryOf: 同一个原记录id})。两个工具都必须传 retryOf，不能只在判题时关联；按正常标准判题。' : '目前没有可重赛的未解决错题。'
  },
}

export const kpSkip = {
  name: 'kp_skip',
  description: '按学习者明确请求跳过或恢复一个知识点；只改变路线参与状态，不改变掌握度或学习记录。',
  parameters: { kpId: str('知识点 id', { required: true }), skipped: { type: 'boolean', required: true } },
  async execute(args, env) {
    const kp = await store.requireKp(env.cwd, args.kpId)
    const request = env.userTexts?.()?.at(-1) ?? ''
    const course = await store.requireCourse(env.cwd)
    const current = currentKp(course, await learningKps(env))
    const namesTarget = request.includes(kp.title) || request.includes(kp.id) || (args.skipped && current?.id === kp.id)
    if (!namesTarget || !(args.skipped ? /跳过/u : /恢复|取消跳过/u).test(request)) throw new Error('需要学习者明确请求跳过或恢复此知识点')
    kp.skipped = args.skipped
    await saveKp(env, kp)
    return `${kp.title}：${args.skipped ? '已跳过（不代表掌握）' : '已恢复学习'}。`
  },
}

export const ALL_TOOLS = [
  learnStatus, courseSave, courseGet, kpGet, kpDefineModels, kpSetPhase, kpSkip,
  targetMapUpdate, verificationRecord, diagnosisRecord, reviewDue, progressGet, mistakesGet,
]
