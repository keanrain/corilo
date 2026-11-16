/**
 * learn-anything Host plugin: registers the tutor tools, the methodology prompt
 * section, a session projection of what the learner typed (for the 不代写 rule), a client-visible
 * projection of review / mastery numbers for the Web composer chip, a guard that keeps write/edit
 * out of `.learn/` so learning data only changes through the tools, the examiner / checker
 * delegation tools, the interactive quiz card (quiz_show), and, when the Host composes
 * dsh-schedule, the daily review reminder; with dsh-session-title, course_save names the Session
 * after the goal. Mount it inside the learn-tutor agent preset, not globally; the examiner and
 * checker presets mount it with `readOnly: true` (the examiner also with `quizLang: true`).
 * @module learn-anything
 */
import { readFileSync } from 'node:fs'
import { assessAnswer } from './assessment.js'
import { isAbsolute, relative, resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ALL_TOOLS, learnStats } from './tools.js'
import { INGEST_TOOLS } from './ingest.js'
import { DEFAULT_GATE } from './mastery.js'
import { createReminders } from './reminder.js'
import { titleAfterGoal } from './title.js'
import { DELEGATES, delegateTool } from './delegates.js'
import { ANSWER_PREFIX, HINT_PREFIX, HELP_PREFIX, PACE_PREFIX, BREAK_PREFIX, quizLanguageSection, quizShowTool } from './quiz.js'
import { withWorkspaceWrite } from './store.js'
import { flashcardShowTool } from './flashcard.js'
import { withCardReference } from './render.js'

export const name = 'learn-anything'
export const inject = ['tools', 'systemPrompt', 'sessionProjections']

export const Config = z.object({
  streak: z.natural().min(1).default(DEFAULT_GATE.streak).description('熟练门槛：连续答对的无提示新情况题数'),
  requiredTypes: z.array(z.string()).default(DEFAULT_GATE.requiredTypes).description('熟练门槛：必须至少答对一次的题型'),
  recallStreak: z.natural().min(1).default(DEFAULT_GATE.recallStreak).description('信息类：连续答对几次算熟练'),
  methodology: z.boolean().default(true).description('注入渐构方法论系统提示'),
  interactiveQuiz: z.boolean().default(true).description('用互动卡片出验证题（quiz_show）；关闭后只出文字题'),
  quizLang: z.boolean().default(false).description('注入互动题卡片的语法说明（供考官预设使用）'),
  readOnly: z.boolean().default(false).description('只注册只读工具，不挂考官、校验员和提醒（供考官、校验员预设使用）'),
  delegateProvider: z.string().default('spawn').description('考官、校验员使用的子 agent provider，需支持独立预设'),
  reminderTime: z.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).default('20:00').description('每日复习提醒的本地时间 HH:MM（需要 Schedule 服务）'),
  reminderTimeZone: z.string().default(Intl.DateTimeFormat().resolvedOptions().timeZone).description('每日复习提醒的 IANA 时区'),
})

const USER_TEXTS = 'learn-anything/user-texts'
/** Client-visible: the latest learnStats() carried in a learn-anything tool result's meta (the composer chip). */
const STATS = 'learn-anything/stats'
const CARD_TOOLS = new Set(['course_get', 'course_save', 'kp_get', 'target_map_update', 'progress_get', 'verification_record', 'diagnosis_record'])
const MAX_TEXTS = 400
const SECTION_ORDER = 9500

const userTextsSchema = zod.array(zod.string())
const statsSchema = zod.object({
  goal: zod.string(), due: zod.number(), total: zod.number(), mastered: zod.number(), percent: zod.number(),
  streak: zod.number().optional(), today: zod.boolean().optional(),
}).nullable()

function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n')
}

// Card messages mix the learner's answers with AI-written titles and options.
const isLearnerText = (text) => ![ANSWER_PREFIX, HINT_PREFIX, HELP_PREFIX, PACE_PREFIX, BREAK_PREFIX, '【闪卡自评】'].some((prefix) => text.trimStart().startsWith(prefix))

export async function apply(ctx, config) {
  const gate = { streak: config.streak, requiredTypes: config.requiredTypes, recallStreak: config.recallStreak }
  /** Set while dsh-schedule is composed; null otherwise. */
  let reminders = null
  /** Set while dsh-session-title is composed; null otherwise. */
  let titles = null
  let examiner = null

  // Only messages the human typed count as "the learner's own words"; tool results
  // (including ask_user_question, whose options the tutor wrote) do not.
  const userTexts = await ctx.sessionProjections.register({
    key: USER_TEXTS,
    stateSchema: userTextsSchema,
    init: () => [],
    apply: (state, event) => {
      if (event.type !== 'user/message' || event.data?.source?.kind !== 'user') return state
      const text = textOf(event.data.content)
      if (!text || !isLearnerText(text)) return state
      const next = [...state, text]
      return next.length > MAX_TEXTS ? next.slice(-MAX_TEXTS) : next
    },
    stateVersion: 4,
  })

  await ctx.sessionProjections.register({
    key: STATS,
    stateSchema: statsSchema,
    init: () => null,
    apply: (state, event) => {
      const meta = event.type === 'tool/result' ? event.data?.meta : undefined
      return meta && typeof meta === 'object' && 'learnStats' in meta ? meta.learnStats : state
    },
    wire: { viewSchema: statsSchema, view: (state) => state },
    stateVersion: 1,
  })

  if (config.methodology) {
    const text = readFileSync(new URL('../../prompts/methodology.md', import.meta.url), 'utf8')
    ctx.effect(() => ctx.systemPrompt.section({ name: 'learn-anything:methodology', order: SECTION_ORDER, text, interpolate: false }), 'learn-anything.methodology')
  }

  if (config.quizLang) {
    const text = quizLanguageSection()
    ctx.effect(() => ctx.systemPrompt.section({ name: 'learn-anything:quiz-lang', order: SECTION_ORDER + 1, text, interpolate: false }), 'learn-anything.quiz-lang')
  }

  const register = (c, tool) => c.tools.register(defineTool({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: tool.execute,
    ...(tool.readOnly ? { isConcurrencySafe: () => true } : {}),
  }))

  for (const tool of [...ALL_TOOLS, ...INGEST_TOOLS]) {
    if (config.readOnly && !tool.readOnly) continue
    ctx.tools.register(defineTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      // The model sees `text`; `stats` rides the result's meta to the STATS projection only.
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true }, stats: { type: 'json' } } },
        render: (_args, value) => [{ type: 'text', text: value.text }],
        presentationMeta: (_args, value) => (value.stats === undefined ? null : { learnStats: value.stats }),
      },
      ...(tool.readOnly ? { isConcurrencySafe: () => true } : {}),
      async execute(args, exec) {
        const session = exec.agent?.session
        const env = {
          cwd: session?.header.cwd ?? process.cwd(),
          now: () => new Date(),
          gate,
          userTexts: () => (session ? userTexts.stateOf(session)?.filter(isLearnerText) ?? null : null),
          signal: exec.signal,
          assessVerification: async (args, context) => {
            if (!examiner) throw new Error('考官不可用，不能记录掌握度')
            return assessAnswer(session, args, context, (input) => examiner.execute(input, exec))
          },
        }
        const run = async () => {
          exec.signal?.throwIfAborted()
          const result = await tool.execute(args, env)
          const text = !config.readOnly && CARD_TOOLS.has(tool.name) ? withCardReference(result, exec.callId) : result
          // Keep reminder writes in the same workspace queue as the graded answer.
          if (tool.name === 'verification_record' && session && reminders) {
            try { await reminders.ensure(env.cwd, session.id) } catch (e) { ctx.logger.warn(`learn-anything: review reminder: ${e}`) }
          }
          if (tool.name === 'course_save' && session && titles) {
            try { titleAfterGoal(titles, session, args.goal) } catch (e) { ctx.logger.warn(`learn-anything: session title: ${e}`) }
          }
          let stats
          try { stats = await learnStats(env.cwd, env.now(), gate) } catch (e) { ctx.logger.warn(`learn-anything: stats: ${e}`) }
          return stats === undefined ? { text } : { text, stats }
        }
        return tool.readOnly ? run() : withWorkspaceWrite(env.cwd, run)
      },
    }))
  }

  if (config.readOnly) return

  if (config.interactiveQuiz) {
    register(ctx, quizShowTool)
    register(ctx, flashcardShowTool)
  }

  ctx.inject(['subagents'], (sctx) => {
    for (const d of DELEGATES) {
      const tool = delegateTool(sctx.subagents, config.delegateProvider, d)
      if (d.name === 'examiner') examiner = tool
      register(sctx, tool)
    }
  })

  ctx.inject(['sessionTitle'], (tctx) => {
    titles = tctx.sessionTitle
    tctx.effect(() => () => { titles = null }, 'learn-anything.titles')
  })

  ctx.inject(['schedule'], (sctx) => {
    reminders = createReminders(sctx.schedule, { time: config.reminderTime, timeZone: config.reminderTimeZone })
    sctx.effect(() => () => { reminders = null }, 'learn-anything.reminders')
    register(sctx, {
      name: 'review_reminder',
      description: 'Set or change the time of the learner\'s daily review reminder (「今日复习 N 项」, posted into the session that owns it). Use when the learner asks for a reminder or a different time.',
      parameters: { time: { type: 'string', required: true, description: '本地时间 HH:MM，例如 20:00' } },
      async execute(args, exec) {
        const session = exec.agent?.session
        if (!session || !reminders) return '当前无法设置提醒。'
        const cwd = session.header.cwd ?? process.cwd()
        const r = await withWorkspaceWrite(cwd, () => reminders.ensure(cwd, session.id, args.time))
        return `每日复习提醒已设为 ${r.time.slice(0, 5)}（${r.timeZone}），下次 ${new Date(r.scheduledAt).toLocaleString('zh-CN', { timeZone: r.timeZone, hour12: false })}。`
      },
    })
  })

  ctx.tools.guard((exec) => {
    if (exec.name !== 'write' && exec.name !== 'edit') return undefined
    const file = exec.arguments?.file_path
    if (typeof file !== 'string') return undefined
    // `.learn/` sits in the Session's project folder (header.cwd); a relative path resolves
    // against the current directory, which working_directory may have moved.
    const session = exec.agent?.session
    const root = session?.header.cwd ?? process.cwd()
    const current = (session && ctx.get('workingDirectory')?.get(session)) || root
    const rel = relative(resolve(root, '.learn'), resolve(current, file))
    if (rel.startsWith('..') || isAbsolute(rel)) return undefined
    return '.learn/ holds the learning record; change it through the learn-anything tools (course_save, target_map_update, …), not write/edit'
  })
}
