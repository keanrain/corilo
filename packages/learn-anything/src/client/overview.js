// Always-visible learning overview: the empty state of the 「学习」 tab.
// Reads the `learn-anything/stats` projection; every field beyond the original chip numbers is optional.
import * as react from 'react'
import { t, labels } from './locale.js'
import { Icon } from './icons.js'

const h = react.createElement

export const STATS_KEY = 'learn-anything/stats'
const REVIEW_PROMPT = '开始今日复习'

const STEP_LABEL = labels({
  describe: '认识要点', assess: '找出卡点', prescribe: '准备材料', build: '用自己的话总结',
  verify: '新情境检验', memorize: '记忆', mastered: '已掌握',
})
const STEPS = { knowledge: ['describe', 'assess', 'prescribe', 'build', 'verify'], information: ['describe', 'memorize'] }
const LEVEL_LABEL = labels({ proficient: '熟练', expert: '精通' })
const NEED_LABEL = labels({
  scenario: '一道情境题', predict: '一道预测结果的题', 'discriminate-pos': '一道判断是不是的题', 'discriminate-neg': '一道判断反例的题',
  contrast: '一道比一比的题', rephrase: '一道换个问法的题', 'own-examples': '自己举几个例子', transfer: '一道换个场景用的题',
  'own-pos': '自己举一个正例', 'own-neg': '自己举一个反例',
})

/** What is left before the next level, in the learner's words; '' when nothing is. */
export function gateText(gate) {
  if (!gate) return ''
  const parts = []
  if (gate.streak && gate.streak.have < gate.streak.need) parts.push(t('再连续答对 {count} 题（无提示、不是蒙的）', { count: gate.streak.need - gate.streak.have }))
  for (const type of gate.missing ?? []) parts.push(Object.hasOwn(NEED_LABEL, type) ? NEED_LABEL[type] : type)
  if (!parts.length) return ''
  return t('离「{level}」还差：{items}', { level: LEVEL_LABEL[gate.target] ?? gate.target, items: parts.join(t('、')) })
}

/** 「第 2/5 步」-style position of a phase, or null when it is not a numbered step. */
function stepOf(current) {
  const steps = STEPS[current.kind === 'information' ? 'information' : 'knowledge']
  const index = steps.indexOf(current.phase)
  return index < 0 ? null : { n: index + 1, total: steps.length }
}

/** Reviews due, with the same action as the composer chip. */
function ReviewPanel({ due, canStart, onStart }) {
  return h('div', { className: 'la-review-panel la-ov-review' },
    h('div', { className: 'la-grow' }, h('strong', null, due ? t('今日复习 {due} 项', { due }) : t('今天没有到期的复习'))),
    due ? h('button', { type: 'button', className: 'la-action', disabled: !canStart, onClick: onStart }, t('开始复习'), h(Icon, { name: 'arrow' })) : null)
}

/**
 * @param stats the STATS projection value (null/undefined before any learn-anything tool has run on a course)
 * @param empty rendered when there is no course yet
 */
export function Overview({ stats, empty, canStart, onStart, inStrip = false }) {
  if (!stats || typeof stats !== 'object') return empty
  const { current } = stats
  const total = Number(stats.total) || 0
  const mastered = Number(stats.mastered) || 0
  const percent = Number.isFinite(stats.percent) ? stats.percent : total ? Math.round((mastered / total) * 100) : 0
  const step = current ? stepOf(current) : null
  const need = current ? gateText(current.gate) : ''
  return h('div', { className: inStrip ? 'la-overview' : 'la-learning la-overview', 'aria-label': inStrip ? undefined : t('学习概览') },
    inStrip ? null : h('p', { className: 'la-eyebrow' }, t('学习概览')),
    h('h3', { className: 'la-title' }, stats.goal),
    h('div', { className: 'la-ov-progress' },
      h('div', { className: 'la-bar', role: 'img', 'aria-label': t('已掌握 {mastered}/{total} 个知识点', { mastered, total }) },
        h('span', { style: { width: `${Math.min(100, Math.max(0, percent))}%`, background: 'var(--la-accent)' } })),
      h('p', { className: 'la-sub' }, total ? t('已掌握 {mastered}/{total} 个知识点 · {percent}%', { mastered, total, percent }) : t('路线里还没有知识点'),
        stats.streak ? h('span', { className: 'la-streak', 'data-today': Boolean(stats.today) }, t('🔥 {count} 天', { count: stats.streak })) : null)),
    current
      ? h('div', { className: 'la-ov-current' },
        h('small', null, t('当前知识点')),
        h('strong', null, current.title),
        h('p', { className: 'la-ov-step' }, h('span', { className: 'la-ov-phase', 'data-phase': current.phase }, Object.hasOwn(STEP_LABEL, current.phase) ? STEP_LABEL[current.phase] : current.phase),
          step ? h('span', { className: 'la-muted' }, t('第 {n}/{total} 步', step)) : null),
        need ? h('p', { className: 'la-ov-need' }, need) : null)
      : total ? h('p', { className: 'la-ov-done' }, t('路线里的知识点都已达标或跳过')) : null,
    h(ReviewPanel, { due: Number(stats.due) || 0, canStart, onStart }))
}

/**
 * Compact overview above an exercise in the 「学习」 tab: one line (current point, step, mastered
 * count, due reviews) that expands to the full overview, so progress stays visible while practising.
 */
export function OverviewStrip({ stats, canStart, onStart }) {
  if (!stats || typeof stats !== 'object') return null
  const { current } = stats
  const total = Number(stats.total) || 0
  const mastered = Number(stats.mastered) || 0
  const due = Number(stats.due) || 0
  const where = current ? [current.title, Object.hasOwn(STEP_LABEL, current.phase) ? STEP_LABEL[current.phase] : current.phase].join(' · ') : stats.goal
  const line = [where, t('已掌握 {mastered}/{total} 个知识点', { mastered, total }), due ? t('今日复习 {due} 项', { due }) : null].filter(Boolean).join(' · ')
  return h('details', { className: 'la-ov-strip' },
    h('summary', null, h('span', { className: 'la-ov-strip-label' }, t('学习概览')), h('span', { className: 'la-ov-strip-line' }, line), h(Icon, { name: 'chevron', className: 'la-chevron' })),
    h(Overview, { stats, empty: null, canStart, onStart, inStrip: true }))
}

/** The learner clicks the same prompt the composer chip sends. */
export const startReview = (inputActions) => { inputActions.setDraft(REVIEW_PROMPT); inputActions.submit() }
