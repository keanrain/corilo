// Course planning, session orientation, and explicit route skipping.
import * as store from '../store.js'
import { createHash } from 'node:crypto'
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseView } from '../render.js'
import { PHASE_GUIDE } from '../phases.js'
import { verified, LEVEL_LABEL } from '../mastery.js'
import { flowState, DIFFICULTY } from '../flow.js'
import { due, emptyReviews, activeReviews } from '../review.js'
import { outlineView } from '../render.js'
import { validateSources } from '../ingest.js'
import { str, strArray, gateOf, loadVerifications, saveKp, learningKps, currentKp, describeModel, progressText } from './shared.js'

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
      return '尚无课程。进入目标接入：只问一句想学会什么、学会后用来做什么（基础、时间、偏好在学习中通过诊断了解）；用户有材料才导入，联网调研可选，然后按 plan-course 技能出大纲骨架。'
    }
    const kps = await learningKps(env)
    const reviews = await store.readJson(p.reviews, emptyReviews())
    const dueCards = due(activeReviews(reviews, course, kps), env.now())
    const diagnoses = await store.readJsonl(p.diagnoses)
    const lines = [`目标：${course.goal}`, `课程状态：${course.status}`]
    if ((await loadVerifications(env.cwd)).some((v) => !verified(v))) lines.push('历史中有未核验来源的旧成绩：保留供回看，不计掌握度；需要重新验证。')
    if (course.learner && Object.keys(course.learner).length) lines.push(`学习者：${JSON.stringify(course.learner)}`)
    if (course.status === 'planning') {
      lines.push('大纲骨架尚未确认：展示 course_get 的结果，问一句是否这样开始；确认后用 course_save(status="active") 锁定并立即开始第一个知识点。')
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

// Authenticated UI routes call these inside the same workspace write queue as tools.
// The revision covers knowledge records too: a stale card must not overwrite progress.
const outlineError = (message, status = 400) => Object.assign(new Error(message), { status })
async function checkOutlinePaths(cwd, ids = []) {
  await store.validateStorePaths(cwd)
  for (const id of ids) store.safeId(id)
  if (await store.backend(cwd) !== 'legacy') return
  const p = store.paths(cwd)
  for (const path of [p.root, p.kpDir]) {
    const stat = await lstat(path)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw outlineError('Linked learning data cannot be edited')
  }
  const files = [p.course, p.verifications, ...(await readdir(p.kpDir)).filter((name) => name.endsWith('.json')).map((name) => join(p.kpDir, name))]
  for (const id of ids) files.push(p.kp(id))
  for (const path of new Set(files)) {
    try {
      const stat = await lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw outlineError('Linked learning data cannot be edited')
    } catch (e) { if (e.code !== 'ENOENT' || path === p.course) throw e }
  }
}
export function readOutline(cwd) {
  return store.withWorkspaceRead(cwd, () => readOutlineSnapshot(cwd))
}
async function readOutlineSnapshot(cwd) {
  await checkOutlinePaths(cwd)
  const course = await store.requireCourse(cwd)
  const kps = (await store.listKps(cwd)).sort((a, b) => a.id.localeCompare(b.id))
  const revision = createHash('sha256').update(JSON.stringify({ course, kps })).digest('hex')
  const view = parseView(outlineView(course, kps))
  const byId = new Map(kps.map((kp) => [kp.id, kp]))
  for (const ch of view.chapters) for (const kp of ch.kps) {
    const source = byId.get(kp.id)
    kp.sources = source.sources ?? []
    kp.skipped = Boolean(source.skipped)
  }
  return { view, revision }
}

export function saveOutline(cwd, args, now = () => new Date()) {
  return store.withWorkspaceWrite(cwd, () => saveOutlineSnapshot(cwd, args, now))
}
async function saveOutlineSnapshot(cwd, args, now) {
  const current = await readOutline(cwd)
  if (current.view.status !== 'planning') throw outlineError('Only a planning outline can be edited; this route is already locked.')
  if (typeof args.expected !== 'string' || args.expected !== current.revision) throw outlineError('Outline changed. Reload the route before saving; your draft is preserved.', 409)
  if (!['planning', 'active'].includes(args.status)) throw outlineError('Invalid outline status')
  if (!Array.isArray(args.chapters) || !args.chapters.length || args.chapters.length > 100) throw outlineError('Provide 1–100 chapters')
  const text = (value, label, max = 300) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw outlineError(`Invalid ${label}`)
    return value.trim()
  }
  const list = (value, label) => {
    if (!Array.isArray(value) || value.length > 100 || value.some((s) => typeof s !== 'string' || s.length > 2000)) throw outlineError(`Invalid ${label}`)
    return value
  }
  let count = 0
  const chapters = args.chapters.map((ch) => {
    if (!Array.isArray(ch.kps) || !ch.kps.length) throw outlineError('Each chapter needs at least one knowledge point')
    return { title: text(ch.title, 'chapter title'), kps: ch.kps.map((kp) => {
      if (++count > 500) throw outlineError('Too many knowledge points')
      try { store.safeId(kp.id) } catch (error) { error.status = 400; throw error }
      if (!['knowledge', 'information'].includes(kp.kind)) throw outlineError('Invalid knowledge point kind')
      if (kp.skipped !== undefined && typeof kp.skipped !== 'boolean') throw outlineError('Invalid skipped flag')
      if (kp.estMinutes !== undefined && (!Number.isInteger(kp.estMinutes) || kp.estMinutes < 1 || kp.estMinutes > 10000)) throw outlineError('Invalid estimated minutes')
      return { id: kp.id, title: text(kp.title, 'knowledge point title'), kind: kp.kind,
        prerequisites: list(kp.prerequisites ?? [], 'prerequisites'), sources: list(kp.sources ?? [], 'sources'),
        ...(kp.estMinutes === undefined ? {} : { estMinutes: kp.estMinutes }) }
    }) }
  })
  await checkOutlinePaths(cwd, chapters.flatMap((ch) => ch.kps).map((kp) => kp.id))
  const skipped = new Map(args.chapters.flatMap((ch) => ch.kps).map((kp) => [kp.id, Boolean(kp.skipped)]))
  if (args.status === 'active' && [...skipped.values()].every(Boolean)) throw outlineError('Keep at least one knowledge point in the route')
  const course = await store.requireCourse(cwd)
  // courseSave renders progress from this log after writing. Validate it first
  // so malformed evidence cannot turn an accepted edit into a failed receipt.
  await store.readJsonl(store.paths(cwd).verifications)
  try { await courseSave.execute({ goal: course.goal, status: args.status, chapters, learner: course.learner, resources: course.resources }, { cwd, now }) } catch (error) {
    if (/duplicate knowledge|unknown prerequisites|cyclic prerequisites|already has learning content|invalid id|source/i.test(error.message)) error.status = 400
    throw error
  }
  for (const [id, skip] of skipped) {
    const kp = await store.requireKp(cwd, id)
    kp.skipped = skip
    await store.writeJson(store.paths(cwd).kp(id), kp)
  }
  return readOutline(cwd)
}
