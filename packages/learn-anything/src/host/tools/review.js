// Due reviews, progress cards, and the Web composer's learning statistics.
import * as store from '../store.js'
import { meetsGate } from '../mastery.js'
import { gateProgress } from '../flow.js'
import { due, emptyReviews, activeReviews, forgottenExamples, examplePracticeText } from '../review.js'
import { progressView } from '../render.js'
import { listMistakes } from '../retry.js'
import { str, ATTRIBUTION_LABEL, loadVerifications, learningKps, currentKp, describeModel } from './shared.js'

/** `YYYY-MM-DD HH:mm` in the host's local time zone (the learner's machine). */
export function localMinute(date) {
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
    const records = await loadVerifications(env.cwd)
    for (const item of items) {
      const kp = await store.readJson(store.paths(env.cwd).kp(item.kpId), null)
      if (!kp) continue
      const model = item.modelId ? kp.models.find((m) => m.id === item.modelId) : null
      const last = item.card.last_review ? new Date(item.card.last_review) : null
      const when = last ? `（上次答题 ${timeAgo(last, now)}，${localMinute(last)}）` : ''
      lines.push(model
        ? `- ${kp.title} / ${model.id} ${describeModel(model)}${when}：请 examiner 出一道新情况题`
        : `- ${kp.title}（信息）${when}：用记忆卡提问`)
      if (model) {
        const history = records.filter((record) => record.kpId === kp.id && record.modelId === model.id)
        const latest = history.at(-1)
        if (latest?.verdict === 'wrong') {
          const examples = forgottenExamples(model, history, latest.id)
          if (examples.length) lines.push(examplePracticeText(examples))
        }
      }
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
 * The knowledge point the route is on and what is left before its next level, for the
 * learning overview. Null when every point is mastered or skipped. `gate` is absent
 * for information points and points without a model yet.
 */
function currentOf(course, kps, verifications, gate) {
  let kp
  try { kp = currentKp(course, kps) } catch { return null }
  if (!kp) return null
  const out = { id: kp.id, title: kp.title, phase: kp.phase, kind: kp.kind === 'information' ? 'information' : 'knowledge' }
  const model = kp.kind === 'information' ? null : kp.models.find((m) => m.phase !== 'mastered') ?? null
  if (model) {
    const progress = gateProgress(model, verifications.filter((v) => v.kpId === kp.id && v.modelId === model.id), model.mastery ?? 'none', gate)
    if (progress) out.gate = progress
  }
  return out
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
    current: currentOf(course, kps, verifications, gate),
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
