import { t, useUiLocale, labels, installLocale } from './locale.js'
// Read-only cards belong to final answers; tasks live in the native right sidebar.
// Turn data retains validated views for answer history and draft recovery.
// Built into src/client/index.js by scripts/build.mjs.
import * as react from 'react'
import { QuizCard, QUIZ_CSS } from './quiz.js'
import { FlashcardCard, FLASHCARD_CSS } from './flashcard.js'
import { partialJson } from './stream.js'
import { registerAnswerCards } from './answer.js'
import { withFeedbackCard } from './feedback-row.js'
import { Icon } from './icons.js'
import { CARD_CSS, PRESENTATION_CSS, NOTE_EDITOR_CSS } from './styles.js'
import { Sources } from './sources.js'
import { TargetEditor } from './target-editor.js'
import { OutlineEditor } from './outline.js'
import { ConceptCompareCard } from './concept-compare.js'
import { Overview, startReview, STATS_KEY as OVERVIEW_STATS_KEY } from './overview.js'
import { quizHistory } from '../quiz/answer.js'
import { flashcardHistory } from '../quiz/flashcard.js'

const h = react.createElement

const VIEW_MARKER = 'learn-anything:view'
const LEVEL_LABEL = labels({ none: '未入门', novice: '入门', proficient: '熟练', expert: '精通' })
const PHASE_LABEL = labels({
  describe: '认识要点', assess: '找出卡点', prescribe: '准备材料', build: '用自己的话总结',
  verify: '新情境检验', memorize: '记忆', mastered: '已掌握',
})
const TAG_LABEL = labels({ d: '规律', e: '例子', t: '迁移', v: '验证' })
const VERDICT_LABEL = { correct: '✓', partial: '△', wrong: '✗' }
// Example origins and wrong-answer causes as named in src/host/tools.js.
const ORIGIN_LABEL = labels({ user: '你', material: '材料', ai: 'AI', verification: '验证题' })
const ATTRIBUTION_LABEL = labels({
  'memorized-wording': '换个说法就不会', 'lower-layer-loss': '会背规律但用不上', 'upper-layer-loss': '只记住了例子', mismatch: '例子归错了规律',
  'concept-confusion': '两个概念混在一起', 'missing-prereq': '缺少基础知识', careless: '粗心',
})
const TOOL_LABEL = labels({
  course_get: '学习路线', course_save: '保存学习路线', kp_get: '我的理解',
  target_map_update: '更新我的理解', progress_get: '学习进度', quiz_show: '互动题', verification_record: '判题', flashcard_show: '翻面闪卡',
})

const css = NOTE_EDITOR_CSS + CARD_CSS + QUIZ_CSS + FLASHCARD_CSS + PRESENTATION_CSS
const tagId = 'learn-anything/client.css'
if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'learn-anything'
  tag.dataset.pluginCss = tagId
  tag.textContent = css
  document.head.appendChild(tag)
}

/** Flatten durable result blocks into text, like ui-tool's `resultText`. */
function resultText(block) {
  if (!('kind' in block)) return null
  const parts = []
  for (const item of block.content ?? []) parts.push(item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
  if (parts.length === 0 && block.error !== undefined) parts.push(`${block.error.name}: ${block.error.code}`)
  return parts.join('\n') || null
}

function parseView(text) {
  const start = text.lastIndexOf(`<!-- ${VIEW_MARKER} `)
  if (start < 0) return null
  const end = text.indexOf(' -->', start)
  try {
    return { view: JSON.parse(text.slice(start + VIEW_MARKER.length + 6, end)), markdown: text.slice(0, start).trim() }
  } catch {
    return null
  }
}

function Badge({ level }) {
  useUiLocale()
  return h('span', { className: 'la-badge', 'data-level': level ?? 'none' }, LEVEL_LABEL[level ?? 'none'] ?? level)
}

function CardHeader({ icon, label, title, subtitle, status, isStreaming }) {
  useUiLocale()
  return h('div', { className: 'la-header' },
    h('span', { className: 'la-emblem' }, h(Icon, { name: icon })),
    h('div', { className: 'la-header-copy' },
      h('p', { className: 'la-eyebrow' }, label),
      h('h3', { className: 'la-title' }, title),
      subtitle ? h('p', { className: 'la-sub' }, subtitle) : null),
    status ? h('span', { className: 'la-status', 'data-streaming': isStreaming }, status) : null)
}

const mastered = (kp) => kp.mastery === 'proficient' || kp.mastery === 'expert'

function OutlineCard({ view: initialView, isStreaming = false, useSession }) {
  const sessionId = useSession?.((s) => s.sessionId)
  const [edited, setEdited] = react.useState(null)
  const view = edited?.sessionId === sessionId && edited?.source === initialView ? edited.view : initialView
  const saveEdited = (view) => setEdited({ sessionId, source: initialView, view })
  useUiLocale()
  const points = view.chapters.flatMap((ch) => ch.kps)
  const minutes = points.reduce((n, kp) => n + (kp.estMinutes ?? 0), 0)
  const next = !isStreaming && view.status === 'active' ? points.find((kp) => !mastered(kp))?.id : undefined
  const titles = new Map(points.map((kp) => [kp.id, kp.title]))
  const status = isStreaming ? t('正在生成') : view.status === 'planning' ? t('待确认') : view.status === 'done' ? t('已完成') : t('进行中')
  return h('section', { className: 'la-card la-outline', 'aria-busy': isStreaming, 'aria-label': t('学习路线') },
    h(CardHeader, { icon: 'route', label: t('学习路线'), title: view.goal, status, isStreaming }),
    !isStreaming && view.status === 'planning' ? h(OutlineEditor, { view, sessionId, onSaved: saveEdited }) : null,
    h('div', { className: 'la-route-meta' },
      h('span', null, h('strong', null, view.chapters.length), t('章节')),
      h('span', null, h('strong', null, points.length), t('知识点')),
      minutes ? h('span', null, h('strong', null, Math.round(minutes / 6) / 10), t('预计小时')) : null,
      !isStreaming ? h('span', null, h('strong', null, points.filter(mastered).length), t('已掌握')) : null),
    h('div', { className: 'la-chapters' }, view.chapters.map((ch, i) => {
      const current = ch.kps.some((kp) => kp.id === next)
      const done = ch.kps.length > 0 && ch.kps.every(mastered)
      return h('details', { key: ch.id, className: 'la-chapter', open: isStreaming || view.status === 'planning' || current || (i === 0 && next === undefined), 'data-current': current, 'data-done': done },
        h('summary', null,
          h('span', { className: 'la-node' }, done ? h(Icon, { name: 'check' }) : String(i + 1).padStart(2, '0')),
          h('div', { className: 'la-grow' },
            h('div', { className: 'la-chapter-name' }, ch.title),
            h('div', { className: 'la-chapter-meta' }, t('{count} 个知识点', { count: ch.kps.length }), current ? h('span', { className: 'la-current-label' }, t('下一站')) : null)),
          h(Icon, { name: 'chevron', className: 'la-chevron' })),
        h('ul', { className: 'la-stops' }, ch.kps.map((kp) => h('li', { key: kp.id, className: 'la-stop', 'data-current': kp.id === next, 'data-done': mastered(kp), 'aria-current': kp.id === next ? 'step' : undefined },
          h('span', { className: 'la-stop-dot', 'aria-hidden': true }),
          h('div', { className: 'la-grow' },
            h('div', { className: 'la-stop-title' }, kp.title),
            h('div', { className: 'la-stop-meta' }, [kp.kind === 'information' ? t('记忆与复习') : t('理解与应用'), kp.estMinutes ? t('{count} 分钟', { count: kp.estMinutes }) : null].filter(Boolean).join(' · ')),
            kp.prerequisites?.length ? h('span', { className: 'la-stop-prereq' }, t('先学：{items}', { items: kp.prerequisites.map((id) => titles.get(id) ?? id).join('、') })) : null),
          isStreaming ? null : h(Badge, { level: kp.mastery })))))
    })),
    view.resources?.length ? h('details', { className: 'la-resources', open: isStreaming },
      h('summary', null, h(Icon, { name: 'book' }), t('随行资料'), h('span', { className: 'la-muted' }, view.resources.length), h(Icon, { name: 'chevron', className: 'la-chevron' })),
      h('ul', { className: 'la-resource-list' }, view.resources.map((r, i) => h('li', { key: i },
        !isStreaming && /^https?:\/\//i.test(r.url)
          ? h('a', { href: r.url, target: '_blank', rel: 'noreferrer' }, r.title)
          : h('span', { title: isStreaming ? undefined : r.url }, r.title),
        h('small', null, [!isStreaming && !/^https?:\/\//i.test(r.url) ? t('已导入材料') : null, r.note].filter(Boolean).join(' · ')))))) : null)
}

function modelHeading(m) {
  return m.type === 'discriminative' ? `判别「${m.concept}」` : `联结「${m.input}」→「${m.output}」`
}

function ModelSection({ model }) {
  useUiLocale()
  const examples = model.examples ?? []
  const [filter, setFilter] = react.useState('all')
  const filtered = filter === 'all' ? examples : examples.filter((e) => e.polarity === filter)
  return h('section', { className: 'la-model', 'aria-label': modelHeading(model) },
    h('div', { className: 'la-model-top' }, h('span', null, [model.type === 'discriminative' ? '辨清概念边界' : '连接输入与结果', PHASE_LABEL[model.phase] ?? model.phase].filter(Boolean).join(' · ')), h(Badge, { level: model.mastery })),
    h('div', { className: 'la-link-map' },
      h('div', { className: 'la-map-node' }, h('small', null, model.type === 'discriminative' ? t('概念') : '遇到这样的情况'), h('strong', null, model.type === 'discriminative' ? model.concept : model.input)),
      model.type !== 'discriminative' ? h(react.Fragment, null, h(Icon, { name: 'arrow', className: 'la-map-arrow' }), h('div', { className: 'la-map-node' }, h('small', null, '会得到什么结果'), h('strong', null, model.output))) : null),
    h('blockquote', { className: 'la-statement', 'data-empty': !model.statement }, h('small', null, t('你的解释')),
      model.statement ?? `等你用自己的话补上${model.type === 'discriminative' ? '这个概念的内涵' : '这条规律'}。`),
    model.annotation ? h('p', { className: 'la-annotation' }, model.annotation) : null,
    examples.length ? h(react.Fragment, null,
      h('div', { className: 'la-example-head' }, h('strong', null, '用例子检验规律'),
        h('div', { className: 'la-filters', role: 'group', 'aria-label': t('筛选例子') }, [['all', t('全部')], ['pos', t('正例')], ['neg', t('反例')]].map(([key, label]) => h('button', {
          key, type: 'button', className: 'la-filter', 'aria-pressed': filter === key, onClick: () => setFilter(key),
        }, label, ' ', key === 'all' ? examples.length : examples.filter((e) => e.polarity === key).length)))),
      h('div', { className: 'la-examples' }, filtered.length ? filtered.map((e) => h('article', { key: e.id, className: 'la-example', 'data-polarity': e.polarity },
        h('div', { className: 'la-example-meta' },
          h('span', { className: 'la-example-type' }, e.polarity === 'neg' ? '反例 · 看清边界' : e.polarity === 'pos' ? '正例 · 印证规律' : TAG_LABEL[e.tag] ?? e.tag),
          h('span', null, `${ORIGIN_LABEL[e.origin] ?? e.origin}${e.checked && e.origin !== 'verification' ? t(' · 已校验') : ''}`)),
        h('div', { className: 'la-example-pair' }, h('span', null, e.input ?? ''), h(Icon, { name: 'arrow' }), h('span', null, e.output ?? '')),
        h(Sources, { sources: e.sources }))) : h('p', { className: 'la-empty' }, t('还没有这一类例子。')))) : null,
    model.verifications?.length ? h('ul', { className: 'la-history' }, model.verifications.map((v, i) => h('li', { key: i },
      h('span', null, VERDICT_LABEL[v.verdict] ?? v.verdict),
      h('span', { className: 'la-grow' }, v.question, v.attribution ? h('small', null, ATTRIBUTION_LABEL[v.attribution] ?? v.attribution) : null,
        h(Sources, { sources: v.sources, label: t('判题依据') }))))) : null)
}

function TargetMapCard({ view: initialView, useSession }) {
  useUiLocale()
  const sessionId = useSession?.((s) => s.sessionId)
  const [saved, setSaved] = react.useState(null)
  const view = saved?.sessionId === sessionId && saved?.source === initialView ? saved.view : initialView
  const saveEdited = (view) => setSaved({ sessionId, source: initialView, view })
  const kp = view.kp
  return h('section', { className: 'la-card la-target', 'aria-label': t('我的理解') },
    h(CardHeader, { icon: 'target', label: t('我的理解'), title: kp.title, subtitle: '把你理解的规律，连接到具体的例子。', status: PHASE_LABEL[kp.phase] ?? kp.phase }),
    h(Sources, { sources: view.sources, label: t('参考资料') }),
    kp.kind !== 'information' && view.models.length ? h(TargetEditor, { view, sessionId, onSaved: saveEdited }) : null,
    kp.kind === 'information'
      ? h('p', { className: 'la-empty' }, '信息类知识点：用记忆卡和间隔复习来记住。')
      : view.models.length
        ? view.models.map((m) => h(ModelSection, { key: m.id, model: m }))
        : h('p', { className: 'la-empty' }, '这里将长出你的知识模型。先和导师一起，把这个知识点拆开。'))
}

const LEVEL_COLOR = {
  none: 'var(--la-line)', novice: 'var(--la-gold)', proficient: 'var(--la-accent)', expert: 'var(--la-ink)',
}

function ProgressCard({ view, useInput, inputActions }) {
  useUiLocale()
  const counts = view.counts ?? {}
  const total = view.total ?? 0
  const done = (counts.proficient ?? 0) + (counts.expert ?? 0)
  const percent = total ? Math.round(done / total * 100) : 0
  const draftEmpty = useInput ? useInput((input) => input.phase === 'plain' && input.draft.trim() === '' && input.attachmentIds.length === 0) : false
  return h('section', { className: 'la-card la-progress', 'aria-label': t('学习进度') },
    h(CardHeader, { icon: 'chart', label: t('成长记录'), title: view.goal }),
    h('div', { className: 'la-progress-main' },
      h('div', { className: 'la-orbit', style: { '--la-progress': `${percent}%` }, role: 'img', 'aria-label': t('已掌握 {percent}%，{done}/{total} 个知识点', { percent, done, total }) },
        h('div', { className: 'la-orbit-inner' }, h('strong', null, `${percent}%`), h('small', null, t('已掌握')))),
      h('div', { className: 'la-progress-copy' }, h('strong', null, t('{done} / {total} 个知识点', { done, total })), h('p', null, '从见过，到真正会用。'),
        h('div', { className: 'la-bar', 'aria-hidden': true }, Object.keys(LEVEL_LABEL).map((k) => h('span', { key: k, style: { width: `${((counts[k] ?? 0) / (total || 1)) * 100}%`, background: LEVEL_COLOR[k] } }))),
        h('div', { className: 'la-legend' }, Object.keys(LEVEL_LABEL).map((k) => h('span', { key: k }, h('i', { style: { background: LEVEL_COLOR[k] }, 'aria-hidden': true }), LEVEL_LABEL[k], h('b', null, counts[k] ?? 0)))))),
    h('div', { className: 'la-review-panel' }, h(Icon, { name: 'book' }),
      h('div', { className: 'la-grow' }, h('strong', null, view.due ? t('今天，回看 {count} 项', { count: view.due }) : t('今天没有到期复习')), h('small', null, view.due ? '趁记忆还热，把理解留住。' : '可以继续探索下一个知识点。')),
      view.due > 0 ? h('button', { type: 'button', className: 'la-action', disabled: !inputActions || !draftEmpty, title: !draftEmpty ? t('先发送或清空输入框里的内容') : undefined, onClick: () => { inputActions.setDraft(REVIEW_PROMPT); inputActions.submit() } }, t('开始复习'), h(Icon, { name: 'arrow' })) : null),
    view.weak?.length ? h(react.Fragment, null,
      h('p', { className: 'la-h' }, '下一步，优先补这里'),
      h('ul', { className: 'la-weak' }, view.weak.map((w, i) => h('li', { key: i }, h('span', { className: 'la-weak-no' }, String(i + 1).padStart(2, '0')), h('span', null, w.title, h('small', null, w.reason)))))) : null)
}

const LEVELS = Object.keys(LEVEL_LABEL)
const VERDICT_TEXT = labels({ correct: '✓ 答对了', partial: '△ 对了一部分', wrong: '✗ 还没答对' })
/** Which part of the model a wrong answer points at, and how that reads to the learner. */
const ATTRIBUTION_PART = {
  'memorized-wording': ['upper', '规律只有书上的原话，还没变成你自己的理解'],
  'upper-layer-loss': ['upper', '例子会做，但背后的规律还说不清'],
  'lower-layer-loss': ['lower', '规律说得出，遇到具体例子却用不上'],
  mismatch: ['link', '规律和例子对不上：你说的规律解释不了你做的判断'],
  'concept-confusion': ['upper', '和一个相近的概念混在了一起，边界还没分清'],
  'missing-prereq': ['base', '基础缺了一块：先补上一个基础知识'],
  careless: [null, '模型没问题，这次是粗心'],
}

/** The model as layers (规律 ↕ 例子, on a base of prerequisites), the broken one lit up. */
function LayerDiagram({ part }) {
  useUiLocale()
  const layer = (key, name, text) => [
    h('span', { key: `${key}-n`, className: 'la-layer-name' }, name),
    h('span', { key, className: 'la-layer', 'data-broken': part === key }, text),
  ]
  return h('div', { className: 'la-layers' },
    layer('upper', t('规律'), '规律：用你自己的话说出的内涵'),
    h('span', { key: 'link-n' }),
    h('span', { key: 'link', className: 'la-layer-link', 'data-broken': part === 'link' }, part === 'link' ? t('↕ 对不上') : '↕'),
    layer('lower', t('例子'), '例子：具体情境里的判断和预测'),
    layer('base', t('基础'), t('基础知识')))
}

const ZONE_TEXT = labels({ easy: '可以再难一点', flow: '难度刚刚好', hard: '放慢一点，先站稳' })
/** What is still needed for the next level, as the learner would read it. */
const NEED_TEXT = labels({
  'discriminate-neg': '一道判断反例的题', rephrase: '一道换个问法的题', transfer: '一道换个场景用的题',
  'own-pos': '自己举一个正例', 'own-neg': '自己举一个反例',
})

/**
 * The flow channel (challenge against skill, 1–5 each): the band along the diagonal is
 * flow, above it is anxiety, below it boredom. The filled dot is this question (placed
 * by how it went: too hard sits above the band, too easy below), the dashed ring the
 * next one, which the staircase puts back on the diagonal.
 */
function FlowChannel({ asked, next, zone }) {
  useUiLocale()
  const skill = Math.min(5.3, Math.max(0.7, asked + ({ hard: -1, easy: 1 }[zone] ?? 0)))
  const x = (s) => 18 + ((s - 0.5) / 5) * 126
  const y = (c) => 94 - ((c - 0.5) / 5) * 88
  const band = [[0.5, 1.4], [4.6, 5.5], [5.5, 5.5], [5.5, 4.6], [1.4, 0.5], [0.5, 0.5]].map(([s, c]) => `${x(s)},${y(c)}`).join(' ')
  return h('svg', { viewBox: '0 0 150 110', role: 'img', 'aria-label': t('这题难度 {asked}/5，下一题难度 {next}/5', { asked, next }) },
    h('polygon', { className: 'la-flow-band', points: band }),
    h('polyline', { className: 'la-flow-axis', points: `${x(0.5)},${y(5.5)} ${x(0.5)},${y(0.5)} ${x(5.5)},${y(0.5)}` }),
    h('text', { className: 'la-flow-text', x: 2, y: 10 }, t('难度')),
    h('text', { className: 'la-flow-text', x: 122, y: 107 }, t('我的水平')),
    h('text', { className: 'la-flow-text', x: 24, y: 20 }, t('太难')),
    h('text', { className: 'la-flow-text', x: 108, y: 88 }, t('太简单')),
    h('text', { className: 'la-flow-text', x: x(3.3), y: y(3.8), transform: `rotate(-35 ${x(3.3)} ${y(3.8)})` }, t('刚刚好')),
    skill !== next || asked !== next ? h('line', { className: 'la-flow-arrow', x1: x(skill), y1: y(asked), x2: x(next), y2: y(next) }) : null,
    h('circle', { className: 'la-flow-next', cx: x(next), cy: y(next), r: 6 }),
    h('circle', { className: 'la-flow-dot', cx: x(skill), cy: y(asked), r: 4 }))
}

function GoalProgress({ progress }) {
  useUiLocale()
  const parts = []
  const { streak } = progress
  if (streak) parts.push(h('span', { key: 's', className: 'la-goal-dots', title: '连续答对（无提示、不是蒙的）' }, '●'.repeat(streak.have), h('span', null, '●'.repeat(Math.max(0, streak.need - streak.have)))))
  const needs = [
    streak && streak.have < streak.need ? `再连对 ${streak.need - streak.have} 题` : null,
    ...progress.missing.map((t) => NEED_TEXT[t] ?? t),
  ].filter(Boolean)
  return h('p', { className: 'la-goal' },
    h('span', { className: 'la-muted' }, `离「${LEVEL_LABEL[progress.target]}」`), ...parts,
    h('span', null, needs.length ? `还差：${needs.join('、')}` : '就差这一步'))
}

function FeedbackCard({ view }) {
  useUiLocale()
  const up = LEVELS.indexOf(view.level?.to) > LEVELS.indexOf(view.level?.from)
  const kpDone = view.passed && LEVELS.indexOf(view.kpLevel?.to) > LEVELS.indexOf(view.kpLevel?.from) && view.kpLevel.to !== view.level?.to
  const [part, cause] = ATTRIBUTION_PART[view.attribution] ?? [undefined, null]
  const flow = view.flow
  return h('section', { className: 'la-card la-fb', 'data-verdict': view.verdict, 'aria-label': t('练习反馈') },
    h('div', { className: 'la-fb-head' },
      h('span', { className: 'la-result-seal', 'aria-hidden': true }, view.verdict === 'correct' ? h(Icon, { name: 'check' }) : view.verdict === 'partial' ? '≈' : '↗'),
      h('div', { className: 'la-grow' }, h('p', { className: 'la-eyebrow' }, t('练习反馈')),
        h('h3', { className: 'la-fb-verdict' }, ({ correct: '这一步，答对了', partial: '接近了，再补一块', wrong: '发现了一个突破口' })[view.verdict] ?? view.verdict),
        h('p', { className: 'la-sub' }, `${VERDICT_TEXT[view.verdict]} · ${view.kp.title}${view.model ? ` · ${view.model}` : ''}`)),
      view.difficulty ? h('span', { className: 'la-fb-level' }, t('难度 {level}/5', { level: view.difficulty })) : null),
    view.calibration ? h('p', { className: 'la-calib', 'data-kind': view.calibration.kind }, view.calibration.text) : null,
    up ? h('div', { className: 'la-levelup' }, h(Icon, { name: 'spark' }), h('div', null,
      h('small', null, view.passed ? '模型达标 · 新里程碑' : '这次练习，理解更深一层'),
      h('strong', null, LEVEL_LABEL[view.level.from], h(Icon, { name: 'arrow', className: 'la-up-arrow' }), LEVEL_LABEL[view.level.to]))) : null,
    kpDone ? h('div', { className: 'la-levelup' }, h(Icon, { name: 'check' }), h('strong', null, `「${view.kp.title}」达到${LEVEL_LABEL[view.kpLevel.to]}`)) : null,
    flow?.last && !view.passed ? h('div', { className: 'la-flow' },
      h(FlowChannel, { asked: flow.last.difficulty, next: flow.next, zone: flow.last.zone }),
      h('div', { className: 'la-flow-info' },
        h('span', { className: 'la-flow-zone' }, ZONE_TEXT[flow.last.zone]),
        h('span', null, `下一题：难度 ${flow.next} 级${flow.last.change > 0 ? ' ↑' : flow.last.change < 0 ? ' ↓' : ''}`),
        h('span', { className: 'la-muted' }, flow.reason))) : null,
    flow?.progress && !view.passed ? h(GoalProgress, { progress: flow.progress }) : null,
    cause ? h('details', { className: 'la-feedback-detail', open: view.verdict !== 'correct' },
      h('summary', null, '找到卡住的那一层', h(Icon, { name: 'chevron', className: 'la-chevron' })),
      h('p', { className: 'la-fb-cause' }, h('span', { className: 'la-badge' }, ATTRIBUTION_LABEL[view.attribution]), ' ', cause),
      part !== null ? h(LayerDiagram, { part }) : null) : null,
    h('p', { className: 'la-sub', style: { margin: 0 } }, [
      view.explainedRule ? '能说清背后的规律 ✓' : view.verdict === 'correct' ? '下次试着说出背后的规律' : null,
      view.hintsUsed ? t('用了 {count} 次提示', { count: view.hintsUsed }) : null,
      t('当前掌握度：{level}', { level: LEVEL_LABEL[view.level?.to] ?? view.level?.to }),
    ].filter(Boolean).join(' · ')),
    view.retry ? h('section', { className: 'la-retry-compare', 'aria-label': t('重赛前后对照') },
      h('div', { className: 'la-retry-heading' }, h(Icon, { name: 'route' }),
        h('strong', null, view.verdict === 'correct' ? '这次，你走通了' : '再看一次思路的变化')),
      h('div', { className: 'la-retry-columns' },
        h('div', null, h('span', { className: 'la-eyebrow' }, t('上一次')), h('p', { className: 'la-sub' }, view.retry.question), h('blockquote', null, view.retry.answer)),
        h('div', null, h('span', { className: 'la-eyebrow' }, t('这一次')), h('p', { className: 'la-sub' }, view.retry.currentQuestion), h('blockquote', null, view.retry.currentAnswer)))) : null,
    h(Sources, { sources: view.sources, label: t('判题依据') }))
}

const CARDS = { 'concept-compare': ConceptCompareCard, outline: OutlineCard, 'target-map': TargetMapCard, progress: ProgressCard, quiz: QuizCard, flashcard: FlashcardCard, feedback: FeedbackCard }

function makeRow(toolName) {
  return function LearnRow({ block }) {
    const label = TOOL_LABEL[toolName] ?? toolName
    if (!block || !('kind' in block)) return h('div', { className: 'la-row' }, `${label}…`)
    const text = resultText(block) ?? ''
    if (block.isError) return h('div', { className: 'la-row la-error' }, `${label}：${text.split('\n')[0]}`)
    const parsed = parseView(text)
    return h('div', { className: 'la-row' }, `${label} · ${parsed && CARDS[parsed.view.view] ? viewTitle(parsed.view) : text.split('\n')[0]}`)
  }
}

function viewTitle(view) {
  if (view.view === 'concept-compare') return view.title
  if (view.view === 'outline') return view.goal
  if (view.view === 'target-map') return view.kp.title
  if (view.view === 'quiz') return t('在学习侧栏作答')
  if (view.view === 'flashcard') return view.fact.prompt
  if (view.view === 'feedback') return VERDICT_TEXT[view.verdict] ?? view.verdict
  return view.goal ?? ''
}

const TURN_DATA_KEY = 'learn-anything'

/**
 * State-only Conversation Definition: collects outline previews and view results
 * of one Turn's learn-anything tool calls and publishes them as Turn data. It
 * publishes no view Node, so Chat's own rows are unchanged.
 */
const viewsDefinition = {
  kind: TURN_DATA_KEY,
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'turn/end' || (event.type === 'assistant/live-chunk' && event.data.chunk.type === 'tool-call-delta')) return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'tool/call' && event.data.name in TOOL_LABEL) return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'tool/result' && event.surfaceOp === 'append' && typeof event.data?.turn === 'number') {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  publication: (match) => match.event.type === 'assistant/live-chunk' ? 'animation-frame' : 'immediate',
  start: (_context, match) => ({ turn: match.event.data.turn, calls: new Set(), views: [], previews: new Map() }),
  update: (context, match) => {
    const state = context.state
    const event = match.event
    if (event.type === 'turn/end') return { ...state, previews: new Map() }
    if (event.type === 'assistant/live-chunk') {
      const chunk = event.data.chunk
      const callId = String(chunk.id)
      const previous = state.previews.get(callId)
      const name = chunk.name ?? previous?.name
      if (name !== 'quiz_show') return state
      const raw = (previous?.raw ?? '') + chunk.argumentsDelta
      const previews = new Map(state.previews)
      previews.set(callId, { name, raw, seq: event.seq, view: previewView(name, raw, callId) })
      return { ...state, previews }
    }
    if (event.type === 'tool/call') {
      const calls = new Set(state.calls)
      calls.add(String(event.data.callId))
      const previews = new Map(state.previews)
      // Dispatch text is authoritative if any live chunks were missed or corrected.
      if (event.data.name === 'quiz_show') previews.set(String(event.data.callId), { seq: event.seq, view: previewView(event.data.name, event.data.arguments ?? '', event.data.callId) })
      return { ...state, calls, previews }
    }
    if (event.type !== 'tool/result') return state
    const message = event.data.message
    const callId = String(message.source?.callId)
    const previews = new Map(state.previews)
    previews.delete(callId)
    const next = { ...state, previews }
    if (message.isError === true || !state.calls.has(callId)) return next
    const parsed = parseView(resultText({ kind: 'result', ...message }) ?? '')
    if (!parsed || !CARDS[parsed.view.view]) return next
    return { ...next, views: [...state.views, { seq: event.seq, callId, view: parsed.view }] }
  },
  buildLocationData: (context, scope, previous) => {
    if (scope !== 'turn' || context.state === undefined) return null
    if (previous?.kind === 'turn' && previous.key === TURN_DATA_KEY && previous.turn === context.state.turn && previous.value === context.state) return previous
    return { kind: 'turn', turn: context.state.turn, key: TURN_DATA_KEY, value: context.state }
  },
}

const LEARNING_KIND = 'learn-anything'
const LEARNING_TAB = '@corilo/learn-anything/learning'
const isTask = (view) => view?.view === 'quiz' || view?.view === 'flashcard'
const isTaskTool = (name) => name === 'quiz_show' || name === 'flashcard_show'

function previewView(name, raw, callId) {
  const args = partialJson(raw)
  if (name !== 'quiz_show' || !args?.ui) return null
  return { view: 'quiz', id: `pending:${callId}`, ui: args.ui.replace(/^\s*```[\w-]*\s*\n/, '').replace(/```\s*$/, ''), question: args.question ?? '' }
}

// Only persistent tasks have a separate Chat entry; explanations render in the answer.
const cardDefinition = {
  kind: 'learn-anything-card', target: 'chat',
  match(event) {
    if (event.type === 'assistant/live-chunk' && event.data.chunk.type === 'tool-call-delta') {
      const { id, name } = event.data.chunk
      return !name || isTaskTool(name) ? { id: String(id), role: name ? 'start' : 'update' } : null
    }
    if (event.type === 'tool/call' && isTaskTool(event.data.name)) return { id: String(event.data.callId), role: 'start' }
    if (event.type === 'tool/result' && event.surfaceOp === 'append' && event.data.message?.source?.callId) return { id: String(event.data.message.source.callId), role: 'update' }
    return null
  },
  publication: (match) => match.event.type === 'assistant/live-chunk' ? 'animation-frame' : 'immediate',
  start: (_context, match) => updateCard(null, match.event),
  update: (context, match) => updateCard(context.state, match.event),
  buildViewNode(context) {
    const state = context.state
    if (!isTask(state?.view)) {
      const previous = context.current.get('chat')
      return previous ? { ...previous, visibility: 'hidden' } : null
    }
    return { key: context.key, id: context.id, kind: 'learn-anything-card', target: 'chat',
      anchorSeq: state.seq, location: context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' },
      groupTree: 'turn', visibility: 'visible', data: state }
  },
}

function updateCard(previous, event) {
  const base = previous ?? { seq: event.seq, time: event.time, view: null }
  if (event.type === 'tool/result') {
    const message = event.data.message
    const parsed = !message.isError && parseView(resultText({ kind: 'result', ...message }) ?? '')
    return { ...base, raw: '', view: parsed && CARDS[parsed.view.view] ? parsed.view : null, isStreaming: false }
  }
  const chunk = event.data.chunk
  const name = chunk?.name ?? event.data.name ?? base.name
  const raw = chunk ? (base.raw ?? '') + chunk.argumentsDelta : event.data.arguments ?? ''
  return { ...base, name, raw, view: previewView(name, raw, chunk?.id ?? event.data.callId), isStreaming: true }
}

function tasksIn(chat) {
  const tasks = []
  for (const turn of chat?.timeline.turns.values() ?? []) {
    const data = turn.data.get(TURN_DATA_KEY)
    for (const entry of data?.views ?? []) if (isTask(entry.view)) tasks.push({ ...entry, isStreaming: false })
    if (!turn.end) for (const preview of data?.previews.values() ?? []) if (isTask(preview.view)) tasks.push({ seq: preview.seq, view: preview.view, isStreaming: true })
  }
  return tasks.sort((a, b) => a.seq - b.seq)
}

function LearningCard(props) {
  useUiLocale()
  const { node } = props
  const { view, isStreaming } = node.data
  // Interrupted previews disappear, while durable cards retain their original position.
  const visible = props.useConversation(({ views }) => {
    if (!isStreaming) return true
    const turn = views.get('chat')?.timeline.turns.get(node.location?.turn?.turn)
    return !turn?.end && Boolean(turn?.data.get(TURN_DATA_KEY)?.previews.get(node.id)?.view)
  })
  const sessionId = props.useSession((session) => session.sessionId)
  const closed = props.useConversation(({ views }) => view.view === 'quiz' ? quizHistory(views.get('chat'), view.id).closed : view.view === 'flashcard' ? flashcardHistory(views.get('chat'), view.id).closed : null)
  react.useEffect(() => {
    if (visible && isTask(view)) props.autoOpenLearning(sessionId, node.data.time)
  }, [visible, sessionId, view.id, node.data.time])
  if (!visible) return null
  return h('button', { type: 'button', className: 'la-task-entry', onClick: () => props.openLearning(sessionId, isStreaming ? undefined : view.id) },
    h(Icon, { name: view.view === 'quiz' ? 'target' : 'book' }),
    h('span', { className: 'la-grow' }, h('strong', null, view.view === 'quiz' ? view.question?.split('\n')[0] || t('互动练习') : view.kp.title),
      h('small', null, isStreaming ? t('正在生成…') : closed ? t('查看这次练习') : view.view === 'quiz' ? t('继续作答 · 学习侧栏') : t('继续回忆 · 学习侧栏'))),
    h(Icon, { name: 'arrow' }))
}

function LearningTab(props) {
  useUiLocale()
  const info = props.useTabInfo()
  const data = props.useConversation(({ views }) => JSON.stringify(tasksIn(views.get('chat'))))
  const tasks = react.useMemo(() => JSON.parse(data), [data])
  const current = tasks.at(-1)
  const requested = info.tab.navigation.params?.id
  const [selectedId, select] = react.useState(() => requested === current?.view.id ? null : requested ?? null)
  react.useEffect(() => { select(requested === current?.view.id ? null : requested ?? null) }, [info.tab.navigation.revision])
  const selected = tasks.findLast((task) => task.view.id === selectedId) ?? current
  const stats = props.useProjection?.(OVERVIEW_STATS_KEY)
  const draftEmpty = props.useInput?.((input) => input.phase === 'plain' && input.draft.trim() === '' && input.attachmentIds.length === 0)
  if (!selected) {
    const empty = h('div', { className: 'la-learning-empty' }, h(Icon, { name: 'book' }), h('p', null, t('开始练习后，题目会留在这里。')))
    return h(Overview, { stats, empty, canStart: Boolean(draftEmpty && props.inputActions), onStart: () => startReview(props.inputActions) })
  }
  return h('div', { className: 'la-learning', 'aria-label': t('学习工作区') },
    selected !== current ? h('button', { type: 'button', className: 'la-action la-return-task', onClick: () => select(null) }, t('回到当前练习'), h(Icon, { name: 'arrow' })) : null,
    h(CARDS[selected.view.view], { ...props, key: selected.view.id, view: selected.view, isStreaming: selected.isStreaming }))
}

const STATS_KEY = 'learn-anything/stats'
const REVIEW_PROMPT = '开始今日复习'

/**
 * Composer-dock chip: 「🔥 N 天 今日复习 N 项 · 掌握度 X%」. Hidden until a learn-anything tool
 * has reported on a course in this Session. The flame is the daily streak, dimmed while
 * today has no answer yet. With reviews due and an empty draft, a click sends 「开始今日复习」.
 */
function ReviewChip({ useProjection, useInput, inputActions }) {
  useUiLocale()
  const stats = useProjection(STATS_KEY)
  const draftEmpty = useInput((input) => input.phase === 'plain' && input.draft.trim() === '' && input.attachmentIds.length === 0)
  if (!stats) return null
  const streak = stats.streak ? h('span', { className: 'la-streak', 'data-today': Boolean(stats.today) }, t('🔥 {count} 天', { count: stats.streak })) : null
  const label = [streak, t('今日复习 {due} 项 · 掌握度 {percent}%', { due: stats.due, percent: stats.percent })]
  const title = [
    t('{goal}：{mastered}/{total} 个知识点达到熟练', { goal: stats.goal, mastered: stats.mastered, total: stats.total }),
    stats.streak ? t('连续学习 {count} 天{note}', { count: stats.streak, note: stats.today ? '' : t('（今天答一题就能续上）') }) : null,
  ].filter(Boolean).join('；')
  if (stats.due === 0 || !draftEmpty || !inputActions) {
    return h('span', { className: 'la-chip', 'data-composer-stat': 'learn-anything', title }, ...label)
  }
  return h('button', {
    type: 'button', className: 'la-chip', 'data-composer-stat': 'learn-anything', title: t('{title}。点击开始今日复习', { title }),
    onClick: () => { inputActions.setDraft(REVIEW_PROMPT); inputActions.submit() },
  }, ...label)
}

const inject = ['slots', 'uiConversation']

function apply(ctx) {
  ctx.inject(['locale'], (scope) => scope.effect(() => installLocale(scope.locale), 'learn-anything: UI locale'))
  ctx.effect(() => ctx.uiConversation.events.register(viewsDefinition), 'learn-anything: view turn data')
  ctx.effect(() => ctx.uiConversation.events.register(cardDefinition), 'learn-anything: ordered cards')
  registerAnswerCards(ctx, (view, props) => h(CARDS[view.view], { ...props, view }))
  ctx.inject(['sidebarRight', 'sidebarRightTabs'], (ctx) => {
    const loadedAt = Date.now()
    const offered = new Set()
    const openLearning = (sessionId, id) => {
      if (ctx.sidebarRight.mounted.getSnapshot() !== sessionId) return
      const tab = ctx.sidebarRight.openTabs.getSnapshot().find((tab) => tab.sessionId === sessionId && tab.kind === LEARNING_KIND)
      if (tab) ctx.sidebarRight.focus(tab.tabId)
      ctx.sidebarRight.openTab(LEARNING_KIND, { params: id ? { id } : {} })
    }
    const autoOpenLearning = (sessionId, time) => {
      if (!(time >= loadedAt) || offered.has(sessionId) || ctx.sidebarRight.mounted.getSnapshot() !== sessionId) return
      offered.add(sessionId)
      // Respect a restored/collapsed learning tab and an already occupied sidebar.
      if (!ctx.sidebarRight.isExpanded() && !ctx.sidebarRight.openTabs.getSnapshot().some((tab) => tab.sessionId === sessionId && tab.kind === LEARNING_KIND)) openLearning(sessionId)
    }
    ctx.effect(() => ctx.sidebarRightTabs.register({ id: LEARNING_TAB, kind: LEARNING_KIND, title: () => t('学习'), keepMounted: true }), 'learn-anything: learning tab')
    ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: LEARNING_TAB }, LearningTab))
    ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: 'learn-anything-card', inject: () => ({ openLearning, autoOpenLearning }) }, LearningCard))
  })
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'learn-anything',
    order: -1,
  }, ReviewChip))
  for (const toolName of Object.keys(TOOL_LABEL)) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
      name: 'tool.call.toolview',
      key: toolName,
    }, toolName === 'verification_record' ? withFeedbackCard(makeRow(toolName), { parseView, resultText, card: (view) => h(CARDS[view.view], { view }) }) : makeRow(toolName)))
  }
}

export { apply, inject }
export const name = '@corilo/learn-anything'
