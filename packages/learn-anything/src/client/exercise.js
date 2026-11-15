// Pure interactive-quiz UI: an OpenUI renderer, the shared quiz context, the original
// answer components and their styles. It knows nothing about DSH, localStorage, the
// composer or mastery; the Host passes `answers`/`status`/`onAction` down and
// src/client/quiz.js adapts the Session to this surface.
import * as react from 'react'
import { Renderer } from '@openuidev/react-lang'
import { Icon } from './icons.js'
import { Sources } from './sources.js'
import { createPlayRenderers, PLAY_CSS } from './play.js'
import { TaskDemo, TASK_DEMO_CSS } from './task-demo.js'
import { InlineText, QuestionText, QUESTION_TEXT_CSS } from './question-text.js'
// The library's JSON Schema, written by scripts/build.mjs from src/quiz/library.js, so
// the browser needs neither zod nor the props schemas, only the renderers below.
import schema from 'virtual:quiz-schema'

const h = react.createElement

const CONFIDENCE = [['sure', '稳'], ['unsure', '有点把握'], ['guess', '蒙的']]
const TYPE_LABEL = {
  scenario: '情境题', predict: '预测题', 'discriminate-pos': '判别题', 'discriminate-neg': '判别题',
  contrast: '对比辨析', rephrase: '换个说法', 'own-examples': '举例题', transfer: '迁移题', recall: '记忆题',
}
const LETTERS = 'ABCDEFGHIJ'

export const QUIZ_CSS = `
.la-quiz-head{display:flex;align-items:center;gap:13px;padding:20px 22px;border-bottom:1px solid var(--la-line);background:var(--la-soft)}.la-quiz-head>.la-emblem{background:var(--la-paper)}.la-quiz-title{font-weight:650;font-size:18px;line-height:1.4;letter-spacing:-.02em;margin:0}.la-quiz-body{display:flex;flex-direction:column;gap:22px;padding:22px}.la-quiz-body>div{min-width:0}.la-level{display:flex;flex-direction:column;gap:5px;align-items:flex-end;color:var(--la-muted);font-size:10px;white-space:nowrap}.la-level-bars{display:flex;align-items:flex-end;gap:3px;height:15px}.la-level-bars i{width:4px;border-radius:2px;background:var(--la-line)}.la-level-bars i[data-on=true]{background:var(--la-accent)}
.la-scene{padding:17px 18px;border:1px solid var(--la-line);border-radius:12px;background:var(--la-paper);font-size:13px}.la-scene-who{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:var(--la-accent);margin-bottom:12px;letter-spacing:.03em}.la-scene-who .la-icon{width:13px;height:13px}.la-scene-role{margin-left:auto;color:var(--la-muted);font-weight:400;letter-spacing:0}.la-q{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;font-size:14px;font-weight:650;margin:0 0 12px;line-height:1.75}.la-q-secondary{font-size:12px;font-weight:500;margin-bottom:8px}.la-q small{flex:none;font-weight:400;font-size:10px;color:var(--la-accent)}.la-q .la-muted{font-size:10px;font-weight:400}
.la-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}.la-pick,.la-option{position:relative;text-align:left;font:inherit;color:inherit;border:1px solid var(--la-line);border-radius:11px;background:var(--la-paper);cursor:pointer;transition:background 140ms ease,border-color 140ms ease,transform 140ms var(--la-ease)}.la-pick{padding:15px;min-height:108px;display:flex;flex-direction:column;align-items:flex-start;gap:7px}.la-pick-title{font-weight:550;font-size:13px;padding-right:14px}.la-pick-detail{font-size:11px;color:var(--la-muted);line-height:1.6}.la-pick[aria-pressed=true],.la-option[aria-pressed=true]{border-color:var(--la-accent);background:var(--la-soft);box-shadow:inset 0 0 0 .5px var(--la-accent)}.la-pick[aria-pressed=true]::after{content:'✓';position:absolute;top:14px;right:13px;color:var(--la-accent)}.la-pick:disabled,.la-option:disabled{cursor:default}
.la-options{display:flex;flex-direction:column;gap:9px}.la-option{display:flex;align-items:center;gap:12px;min-height:50px;padding:10px 14px}.la-option::after{content:'';width:16px;height:16px;flex:none;margin-left:auto;border:1px solid var(--la-line);border-radius:50%;font-size:10px;line-height:14px;text-align:center}.la-option[aria-pressed=true]::after{content:'✓';background:var(--la-accent);border-color:var(--la-accent);color:var(--la-paper)}.la-letter{display:grid;place-items:center;flex:none;width:25px;height:25px;font:11px ui-monospace,monospace;color:var(--la-muted);border:1px solid var(--la-line);border-radius:7px}.la-option[aria-pressed=true] .la-letter,.la-pick[aria-pressed=true] .la-letter{color:var(--la-accent);border-color:color-mix(in srgb,var(--la-accent) 25%,var(--la-line));background:var(--la-paper)}
.la-reason{box-sizing:border-box;width:100%;min-height:88px;resize:vertical;font:inherit;font-size:12px;line-height:1.7;color:inherit;background:var(--la-paper);border:1px solid var(--la-line);border-radius:11px;padding:13px 15px;transition:border-color 140ms ease}.la-reason::placeholder{color:var(--la-muted);opacity:.75}.la-reason:focus{border-color:var(--la-accent)}.la-reason[readonly]{background:var(--la-soft)}.la-boss{padding:17px;border:1px solid color-mix(in srgb,var(--la-gold) 35%,var(--la-line));border-radius:12px;background:color-mix(in srgb,var(--la-gold) 8%,var(--la-paper))}.la-boss-name{display:flex;align-items:center;gap:8px;color:var(--la-gold);font-weight:600;font-size:12px;margin-bottom:8px}
.la-slider{display:flex;flex-direction:column;gap:10px}.la-slider input{width:100%;accent-color:var(--la-accent);height:24px}.la-slider-value{align-self:center;font-size:30px;font-weight:600;color:var(--la-accent);font-variant-numeric:tabular-nums;letter-spacing:-.04em}.la-slider-value[data-unset=true]{font-size:12px;font-weight:400;color:var(--la-muted);letter-spacing:0}.la-slider-ends{display:flex;justify-content:space-between;font-size:10px;color:var(--la-muted)}.la-sort{display:flex;flex-direction:column;gap:8px}.la-sort-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;border:1px solid var(--la-line);border-radius:10px;padding:12px;font-size:12px}.la-sort-row[data-done=true]{background:var(--la-soft);border-color:color-mix(in srgb,var(--la-accent) 20%,var(--la-line))}.la-bins{display:flex;gap:5px;flex-wrap:wrap}.la-bin{font:inherit;font-size:11px;color:var(--la-muted);border:1px solid var(--la-line);border-radius:7px;background:var(--la-paper);padding:6px 10px;cursor:pointer}.la-bin[aria-pressed=true]{border-color:var(--la-accent);color:var(--la-accent);box-shadow:inset 0 0 0 .5px var(--la-accent)}.la-bin:disabled{cursor:default}.la-bubble{border-left:3px solid var(--la-line);padding:12px 15px;margin:0 0 12px;background:var(--la-soft);border-radius:0 9px 9px 0;font-size:12px}.la-slots{display:flex;flex-direction:column;gap:10px}.la-slot-name{font-size:11px;color:var(--la-muted);margin-bottom:7px}.la-slot .la-reason{min-height:70px}
.la-answer-progress{display:flex;align-items:center;gap:10px;margin:0 22px 16px;font-size:10px;color:var(--la-muted)}.la-answer-track{display:flex;gap:4px;flex:1}.la-answer-track i{height:3px;flex:1;border-radius:3px;background:var(--la-line)}.la-answer-track i[data-done=true]{background:var(--la-accent)}.la-conf{display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:16px 22px 0;border-top:1px solid var(--la-line);font-size:11px;color:var(--la-muted)}.la-confidence-options{display:flex;gap:5px;flex-wrap:wrap}.la-conf-chip{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:11px;color:var(--la-muted);border:1px solid var(--la-line);border-radius:8px;background:var(--la-paper);padding:6px 10px;min-height:32px;cursor:pointer}.la-conf-chip[aria-pressed=true]{border-color:var(--la-accent);background:var(--la-soft);color:var(--la-accent)}.la-signal{display:inline-flex;align-items:flex-end;gap:2px;height:12px}.la-signal i{display:block;width:3px;background:currentColor;border-radius:1px}.la-signal i[data-on=false]{opacity:.2}
.la-quiz-foot{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:17px 22px}.la-quiz-hint{flex:1;color:var(--la-muted);font-size:11px}.la-submit{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:40px;font:inherit;font-size:12px;font-weight:550;border:0;border-radius:10px;padding:10px 17px;cursor:pointer;background:var(--la-accent);color:var(--la-paper);transition:transform 140ms var(--la-ease),background 140ms ease}.la-submit .la-icon{width:16px;height:16px}.la-submit:disabled{background:var(--la-line);color:var(--la-muted);cursor:default}.la-controls{display:flex;gap:6px;justify-content:space-between;flex-wrap:wrap;padding:10px 16px;border-top:1px solid var(--la-line);background:var(--la-soft)}.la-ctl{display:inline-flex;align-items:center;justify-content:center;gap:5px;font:inherit;font-size:10px;color:var(--la-muted);border:0;border-radius:6px;background:none;padding:6px;min-height:30px;cursor:pointer}.la-ctl .la-icon{width:14px;height:14px}.la-ctl:disabled{cursor:default;opacity:.45}.la-done{display:flex;align-items:center;gap:8px;color:var(--la-accent);font-size:12px;font-weight:550}.la-done .la-icon{width:18px;height:18px}
.la-retry-note{margin:0;padding:10px 22px;background:var(--la-soft);color:var(--la-accent);font-size:11px;border-bottom:1px solid var(--la-line)}.la-code-lines,.la-step-pool{display:flex;flex-direction:column;gap:7px}.la-code-line,.la-step{display:flex;align-items:baseline;gap:12px;width:100%;text-align:left;font:inherit;font-size:12px;color:inherit;border:1px solid var(--la-line);border-radius:9px;background:var(--la-paper);padding:11px 12px;cursor:pointer}.la-code-line code{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.7 ui-monospace,monospace}.la-line-no{flex:none;min-width:23px;font:11px ui-monospace,monospace;color:var(--la-muted)}.la-code-line[aria-pressed=true]{border-color:var(--la-gold);background:color-mix(in srgb,var(--la-gold) 7%,var(--la-paper))}.la-repair{display:block;margin-top:13px}.la-repair>span{display:block;font-size:11px;color:var(--la-muted);margin-bottom:7px}.la-step-path{display:flex;gap:6px;flex-wrap:wrap;padding:12px;margin:0 0 12px;list-style:none;background:var(--la-soft);border-radius:10px;min-height:36px}.la-step-path li{display:flex;gap:6px;align-items:center;font-size:11px;overflow-wrap:anywhere}.la-step-path li:not(:last-child)::after{content:'→';color:var(--la-muted);margin-left:4px}.la-step-path b{display:grid;place-items:center;flex:none;width:20px;height:20px;border-radius:50%;background:var(--la-accent);color:var(--la-paper);font:10px ui-monospace,monospace}.la-step[aria-pressed=true]{color:var(--la-muted);background:var(--la-soft)}.la-step-tools{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}.la-code-line:disabled,.la-step:disabled{cursor:default}.la-code-line:focus-visible,.la-step:focus-visible{outline:2px solid var(--la-accent);outline-offset:2px}.la-code-line:active:not(:disabled),.la-step:active:not(:disabled){transform:scale(.99)}
@media(prefers-reduced-motion:reduce){.la-code-line:active:not(:disabled),.la-step:active:not(:disabled){transform:none}}
@container learning (max-width:420px){.la-quiz-head{padding:17px;gap:10px}.la-quiz-title{font-size:16px}.la-quiz-head>.la-emblem{width:34px;height:34px}.la-quiz-body{padding:17px;gap:20px}.la-conf{padding:14px 17px 0;gap:9px}.la-quiz-foot{padding:16px 17px}.la-quiz-hint{font-size:10px}.la-answer-progress{margin:0 17px 14px}.la-cards{grid-template-columns:repeat(auto-fit,minmax(120px,1fr))}.la-ctl{font-size:10px}.la-level>span:last-child{font-size:9px}.la-conf-chip{padding:6px 8px}.la-controls{gap:0;padding:8px 10px}}
@media(hover:hover) and (pointer:fine){.la-pick:hover:not(:disabled),.la-option:hover:not(:disabled){background:var(--la-soft);border-color:var(--la-accent)}.la-ctl:hover:not(:disabled),.la-conf-chip:hover{color:var(--la-accent);background:var(--la-soft)}.la-submit:hover:not(:disabled){filter:brightness(1.08)}}
.la-help{padding:16px 22px;border-top:1px solid var(--la-line);background:var(--la-soft)}.la-help-title{margin:0 0 6px;font-size:12px;font-weight:600;color:var(--la-accent)}.la-help-note{margin:0 0 12px;font-size:11px;line-height:1.7;color:var(--la-muted)}.la-help-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.la-help .la-bin{min-height:36px}
` + QUESTION_TEXT_CSS + PLAY_CSS + TASK_DEMO_CSS

/** Collects the answers of one quiz; provided outside OpenUI's Renderer. */
const QuizContext = react.createContext(null)

function useQuizField(key, complete) {
  const quiz = react.useContext(QuizContext)
  const register = quiz?.register
  const completeRef = react.useRef(complete)
  completeRef.current = complete
  const hasComplete = typeof complete === 'function'
  react.useEffect(() => register?.(key, hasComplete ? (value) => completeRef.current(value) : undefined), [register, key, hasComplete])
  return quiz ? [quiz.answers[key], (value) => quiz.set(key, value), quiz.locked] : [undefined, () => {}, true]
}

/** A child element's props: the Renderer hands sub-components over as element nodes. */
function nodeProps(node) {
  return node && typeof node === 'object' && 'props' in node ? node.props : node ?? {}
}

function toggle(list = [], index, multi) {
  if (!multi) return [index]
  return list.includes(index) ? list.filter((i) => i !== index) : [...list, index].sort((a, b) => a - b)
}

function QuizRoot({ props, renderNode }) {
  const quiz = react.useContext(QuizContext)
  return h('div', { className: 'la-quiz', 'data-quiz': quiz?.id, 'aria-busy': quiz?.isStreaming },
    h('div', { className: 'la-quiz-head' },
      h('span', { className: 'la-emblem' }, h(Icon, { name: 'target' })),
      h('div', { className: 'la-grow' },
        h('p', { className: 'la-eyebrow' }, quiz?.purpose === 'practice' ? '理解练习' : quiz?.retry ? '错题重赛' : TYPE_LABEL[props.type] ?? props.type ?? '互动练习'),
        h('h3', { className: 'la-quiz-title' }, props.title)),
      props.level ? h(Level, { level: props.level }) : null),
    quiz?.retry ? h('p', { className: 'la-retry-note' }, '换个情境，再试一次。用这次的思路完成挑战。') : null,
    h('div', { className: 'la-quiz-body' }, renderNode(props.body)),
    quiz ? h(QuizFooter, { quiz, title: props.title }) : null)
}

/** Five steps show the challenge before the learner starts. */
function Level(props) {
  const level = Math.min(5, Math.max(1, Math.round(props.level)))
  return h('span', { className: 'la-level', title: `本题难度 ${level}/5` },
    h('span', { className: 'la-level-bars', 'aria-hidden': true }, Array.from({ length: 5 }, (_, i) => h('i', { key: i, 'data-on': i < level, style: { height: `${5 + i * 2.5}px` } }))),
    h('span', null, `难度 ${level}/5`))
}

const CLOSED_TEXT = { answered: '已提交作答', easier: '已请求换一道简单点的', harder: '已请求换一道难一点的', break: '已暂停', superseded: '本题已结束，请在最新题卡作答' }

/**
 * Answering plus the learner's controls over the pace. Every control checks the same
 * read-only state as its disabled style, so a closed, sending or non-sendable card
 * cannot be acted on through an event handler.
 */
function QuizFooter({ quiz, title }) {
  const [helpOpen, setHelpOpen] = react.useState(false)
  const [demoOpen, setDemoOpen] = react.useState(false)
  const helpButton = react.useRef(null)
  const returnToQuestion = () => {
    setDemoOpen(false)
    setHelpOpen(false)
    helpButton.current?.focus()
  }
  if (quiz.isStreaming) return null
  if (quiz.closed !== null) return h('div', { className: 'la-quiz-foot', role: 'status' }, h('div', null,
    h('span', { className: 'la-done' }, h(Icon, { name: quiz.closed === 'break' ? 'pause' : 'check' }), CLOSED_TEXT[quiz.closed] ?? CLOSED_TEXT.answered),
    typeof quiz.answerText === 'string' && quiz.answerText ? h('p', { className: 'la-pre' }, quiz.answerText) : null,
    quiz.closed === 'answered' ? h(Sources, { sources: quiz.sources, label: '教材依据' }) : null))
  const missing = quiz.fields.filter((field) => !fieldComplete(field, quiz.answers[field.key])).length
  const status = quiz.error
    || (quiz.readOnly ? '只读模式，不能作答'
      : !quiz.canSend ? quiz.blocked
        : !quiz.actionable ? quiz.blocked
          : quiz.pending ? '提交尚未确认，可以重试'
            : !quiz.fields.length ? '题目还没有可作答的内容'
              : missing ? `还有 ${missing} 处没答` : '答完了，提交吧')
  return h(react.Fragment, null,
    quiz.fields.length ? h('div', { className: 'la-answer-progress', 'aria-label': `已完成 ${quiz.fields.length - missing}/${quiz.fields.length} 项作答` },
      h('span', null, `已完成 ${quiz.fields.length - missing} / ${quiz.fields.length}`),
      h('span', { className: 'la-answer-track', 'aria-hidden': true }, quiz.fields.map((field) => h('i', { key: field.key, 'data-done': fieldComplete(field, quiz.answers[field.key]) })))) : null,
    h('div', { className: 'la-conf', role: 'group', 'aria-label': '作答把握' }, h('span', null, '有几成把握？'),
      h('div', { className: 'la-confidence-options' }, CONFIDENCE.map(([key, text], i) => h('button', {
        key, type: 'button', className: 'la-conf-chip', 'aria-pressed': quiz.confidence === key,
        disabled: !quiz.canSetConfidence,
        onClick: () => quiz.setConfidence(quiz.confidence === key ? null : key),
      }, h('span', { className: 'la-signal', 'aria-hidden': true }, [0, 1, 2].map((bar) => h('i', { key: bar, 'data-on': bar < 3 - i, style: { height: `${5 + bar * 3}px` } }))), text)))),
    h('div', { className: 'la-quiz-foot' },
      h('span', { className: 'la-quiz-hint' }, status),
      h('button', { type: 'button', className: 'la-submit', disabled: !quiz.actionable || !quiz.fields.length || missing > 0, onClick: () => quiz.submit(title) }, quiz.pending ? '重试提交' : '提交作答', h(Icon, { name: 'arrow' }))),
    h('div', { className: 'la-controls' },
      h('button', { ref: helpButton, type: 'button', className: 'la-ctl', disabled: !quiz.actionable, 'aria-expanded': helpOpen,
        onClick: () => { if (quiz.actionable) setHelpOpen((open) => !open) } }, h(Icon, { name: 'book' }), '没看懂'),
      h('button', { type: 'button', className: 'la-ctl', disabled: !quiz.actionable, onClick: () => quiz.hint(title) }, h(Icon, { name: 'bulb' }), quiz.hints ? `再给个提示（已用 ${quiz.hints}）` : '要个提示'),
      h('button', { type: 'button', className: 'la-ctl', disabled: !quiz.actionable, onClick: () => quiz.close('easier', title) }, h(Icon, { name: 'minus' }), '太难了'),
      h('button', { type: 'button', className: 'la-ctl', disabled: !quiz.actionable, onClick: () => quiz.close('harder', title) }, h(Icon, { name: 'plus' }), '太简单'),
      h('button', { type: 'button', className: 'la-ctl', disabled: !quiz.actionable, onClick: () => quiz.close('break', title) }, h(Icon, { name: 'pause' }), '歇一会儿')),
    helpOpen ? h('div', { className: 'la-help', role: 'group', 'aria-label': '学习补给' },
      demoOpen && quiz.demoReady && quiz.helpDemo ? h(TaskDemo, {
        config: quiz.helpDemo, disabled: quiz.locked,
        onAction: (event) => event.type === 'return' ? returnToQuestion() : quiz.demoAction(title, event),
      }) : h(react.Fragment, null,
      h('p', { className: 'la-help-title' }, '先补一小块，再回来继续'),
      h('p', { className: 'la-help-note' }, '选一下卡在哪里。导师会先补必要概念或小例子，原题和已填答案保留。'),
      h('div', { className: 'la-help-actions' },
        h('button', { type: 'button', className: 'la-bin', disabled: !quiz.actionable, onClick: () => quiz.help('term', title) }, '这个词不懂'),
        h('button', { type: 'button', className: 'la-bin', disabled: !quiz.actionable, onClick: () => quiz.help('approach', title) }, '不知道从哪开始'),
        quiz.helpDemo ? h('button', { type: 'button', className: 'la-bin', disabled: quiz.locked || (!quiz.demoReady && !quiz.actionable), onClick: () => {
          if (quiz.locked || (!quiz.demoReady && !quiz.actionable)) return
          setDemoOpen(true)
          if (!quiz.demoReady) quiz.help('demo', title)
        } }, demoOpen && !quiz.demoReady ? '重试打开演示' : '动手看一眼') : null,
        h('button', { type: 'button', className: 'la-ctl', onClick: returnToQuestion }, '回到题目')),
      demoOpen && !quiz.demoReady ? h('p', { className: 'la-help-note', role: 'status' }, '确认补给请求后会打开演示；未确认时可以重试。') : null)) : null)
}

/** Answered: a number, non-blank text, or a non-empty list whose every entry is answered. */
function filled(value) {
  if (Array.isArray(value)) return value.length > 0 && value.every(filled)
  if (typeof value === 'number') return Number.isFinite(value)
  return typeof value === 'string' && value.trim() !== ''
}

/** Old components keep `filled`; play components register their own complete predicate. */
function fieldComplete(field, value) {
  return typeof field.complete === 'function' ? field.complete(value) : filled(value)
}

function Scene({ props }) {
  return h('div', { className: 'la-scene' },
    h('div', { className: 'la-scene-who' }, h(Icon, { name: 'book' }), '情境',
      props.who ? h('span', { className: 'la-scene-role' }, props.who) : null),
    h(QuestionText, { text: props.text }))
}

function Pick({ props }) {
  const cards = (props.cards ?? []).map(nodeProps)
  const [value, set, locked] = useQuizField(props.prompt)
  useQuizLabel(props.prompt, (v) => v.map((i) => `「${cards[i]?.title}」`).join('、'))
  return h('div', null,
    h('p', { className: 'la-q' }, h(InlineText, { text: props.prompt }), props.multi ? h('span', { className: 'la-muted' }, '（可多选）') : null),
    h('div', { className: 'la-cards' }, cards.map((card, i) => h('button', {
      key: i, type: 'button', className: 'la-pick', disabled: locked,
      'aria-pressed': (value ?? []).includes(i), onClick: () => set(toggle(value, i, props.multi)),
    }, h('span', { className: 'la-letter', 'aria-hidden': true }, LETTERS[i]), h('div', { className: 'la-pick-title' }, h(InlineText, { text: card.title })), card.detail ? h('div', { className: 'la-pick-detail' }, h(InlineText, { text: card.detail })) : null))))
}

function Choice({ props }) {
  const options = props.options ?? []
  const [value, set, locked] = useQuizField(props.prompt)
  useQuizLabel(props.prompt, (v) => v.map((i) => `${LETTERS[i]}. ${options[i]}`).join('；'))
  return h('div', null,
    h('p', { className: 'la-q' }, h(InlineText, { text: props.prompt }), props.multi ? h('span', { className: 'la-muted' }, '（可多选）') : null),
    h('div', { className: 'la-options' }, options.map((option, i) => h('button', {
      key: i, type: 'button', className: 'la-option', disabled: locked,
      'aria-pressed': (value ?? []).includes(i), onClick: () => set(toggle(value, i, props.multi)),
    }, h('span', { className: 'la-letter' }, LETTERS[i]), h(InlineText, { text: option })))))
}

function Reason({ props }) {
  const [value, set, locked] = useQuizField(props.prompt)
  useQuizLabel(props.prompt, (v) => v.trim())
  return h('div', null,
    h('p', { className: 'la-q la-q-secondary' }, h(InlineText, { text: props.prompt })),
    h('textarea', {
      className: 'la-reason', 'aria-label': props.prompt, value: value ?? '', readOnly: locked, placeholder: props.placeholder ?? '用你自己的话写',
      onChange: (event) => set(event.target.value),
    }))
}

function Boss({ props }) {
  return h('div', { className: 'la-boss' },
    h('div', { className: 'la-boss-name' }, h(Icon, { name: 'spark' }), `进阶挑战 · ${props.title}`),
    h(QuestionText, { text: props.text }))
}

function Slider({ props }) {
  const [value, set, locked] = useQuizField(props.prompt)
  const unit = props.unit ?? ''
  useQuizLabel(props.prompt, (v) => `${v}${unit}`)
  const min = Number(props.min ?? 0)
  const max = Number(props.max ?? 100)
  const step = Number(props.step ?? 1) || 1
  const shown = value ?? min + Math.round((max - min) / 2 / step) * step
  // A click on the thumb without moving fires no change, so releasing it also counts as an answer.
  const commit = (event) => set(Number(event.target.value))
  const [left, right] = props.labels ?? []
  return h('div', { className: 'la-slider' },
    h('p', { className: 'la-q' }, h(InlineText, { text: props.prompt })),
    h('span', { className: 'la-slider-value', 'data-unset': value === undefined }, value === undefined ? '拖动滑块给出你的估计' : `${value}${unit}`),
    h('input', { type: 'range', min, max, step, value: shown, disabled: locked, 'aria-label': props.prompt, onChange: commit, onPointerUp: commit, onKeyUp: commit }),
    h('div', { className: 'la-slider-ends' },
      h('span', null, `${min}${unit}${left ? ` · ${left}` : ''}`),
      h('span', null, `${right ? `${right} · ` : ''}${max}${unit}`)))
}

function Sorter({ props }) {
  const bins = props.bins ?? []
  const items = props.items ?? []
  const [value, set, locked] = useQuizField(props.prompt)
  useQuizLabel(props.prompt, (v) => items.map((item, i) => `${item}→${bins[v[i]]}`).join('；'))
  const current = value ?? items.map(() => null)
  const assign = (i, b) => set(current.map((x, j) => (j === i ? b : x)))
  return h('div', null,
    h('p', { className: 'la-q' }, h(InlineText, { text: props.prompt })),
    h('div', { className: 'la-sort' }, items.map((item, i) => h('div', { key: i, className: 'la-sort-row', 'data-done': current[i] !== null },
      h(InlineText, { text: item }),
      h('span', { className: 'la-bins' }, bins.map((bin, b) => h('button', {
        key: b, type: 'button', className: 'la-bin', disabled: locked, 'aria-pressed': current[i] === b, onClick: () => assign(i, b),
      }, bin)))))))
}

function SpotError({ props }) {
  const lines = props.lines ?? []
  const [value, set, locked] = useQuizField(props.prompt)
  const current = Array.isArray(value) ? value : [null, '']
  useQuizLabel(props.prompt, (v) => `第 ${v[0]} 行「${lines[v[0] - 1] ?? ''}」；修正：${String(v[1] ?? '').trim()}`)
  return h('div', null,
    h('p', { className: 'la-q' }, h(InlineText, { text: props.prompt }), h('small', null, '定位 → 修复')),
    h('div', { className: 'la-code-lines', role: 'group', 'aria-label': '选择有错的一行' }, lines.map((line, i) => h('button', {
      key: i, type: 'button', className: 'la-code-line', disabled: locked,
      'aria-pressed': current[0] === i + 1, onClick: () => set([i + 1, current[1]]),
    }, h('span', { className: 'la-line-no' }, String(i + 1).padStart(2, '0')), h('code', null, line)))),
    h('label', { className: 'la-repair' },
      h('span', null, current[0] ? `修复第 ${current[0]} 行` : '先定位问题，再写出修正'),
      h('textarea', { className: 'la-reason', 'aria-label': `${props.prompt ?? '找茬'}：修正`, value: current[1] ?? '', readOnly: locked,
        placeholder: props.placeholder ?? '这行应该怎么改？', onChange: (event) => set([current[0], event.target.value]) })))
}

function OrderSteps({ props }) {
  const items = props.items ?? []
  const [value, set, locked] = useQuizField(props.prompt)
  // Null placeholders keep a partly assembled path from counting as a complete answer.
  const chosen = (Array.isArray(value) ? value : []).filter((i) => Number.isInteger(i) && i >= 0 && i < items.length)
  const commit = (next) => set([...next, ...Array(Math.max(0, items.length - next.length)).fill(null)])
  useQuizLabel(props.prompt, (v) => v.map((i, n) => `${n + 1}. ${items[i]}`).join(' → '))
  return h('div', null,
    h('p', { className: 'la-q' }, h(InlineText, { text: props.prompt }), h('small', null, `${chosen.length} / ${items.length}`)),
    h('ol', { className: 'la-step-path', 'aria-label': '你排列的步骤', 'aria-live': 'polite' },
      chosen.length ? chosen.map((i, n) => h('li', { key: i }, h('b', null, n + 1), items[i])) : h('li', { className: 'la-muted' }, '依次点选，拼出你的路径')),
    h('div', { className: 'la-step-pool', role: 'group', 'aria-label': '待排列步骤' }, items.map((item, i) => h('button', {
      key: i, type: 'button', className: 'la-step', disabled: locked || chosen.includes(i), 'aria-pressed': chosen.includes(i),
      onClick: () => { if (!chosen.includes(i)) commit([...chosen, i]) },
    }, h('span', { className: 'la-line-no' }, chosen.includes(i) ? '✓' : '＋'), h('span', null, item)))),
    h('div', { className: 'la-step-tools' },
      h('button', { type: 'button', className: 'la-bin', disabled: locked || !chosen.length, onClick: () => commit(chosen.slice(0, -1)) }, '撤销上一步'),
      h('button', { type: 'button', className: 'la-bin', disabled: locked || !chosen.length, onClick: () => commit([]) }, '重新排列')))
}

function Rewrite({ props }) {
  const [value, set, locked] = useQuizField(props.prompt)
  useQuizLabel(props.prompt, (v) => v.trim())
  return h('div', null,
    h('p', { className: 'la-q' }, h(InlineText, { text: props.prompt })),
    h(QuestionText, { className: 'la-bubble', text: `“${props.original ?? ''}”` }),
    h('textarea', {
      className: 'la-reason', 'aria-label': props.prompt, value: value ?? '', readOnly: locked, placeholder: props.placeholder ?? '换成你自己的话',
      onChange: (event) => set(event.target.value),
    }))
}

function Examples({ props }) {
  const slots = props.slots ?? []
  const [value, set, locked] = useQuizField(props.prompt)
  useQuizLabel(props.prompt, (v) => slots.map((slot, i) => `${slot}：${(v[i] ?? '').trim()}`).join('；'))
  const current = value ?? slots.map(() => '')
  return h('div', null,
    h('p', { className: 'la-q' }, h(InlineText, { text: props.prompt })),
    h('div', { className: 'la-slots' }, slots.map((slot, i) => h('label', { key: i, className: 'la-slot' },
      h('div', { className: 'la-slot-name' }, slot),
      h('textarea', {
        className: 'la-reason', value: current[i] ?? '', readOnly: locked, placeholder: '你自己想的例子',
        onChange: (event) => set(current.map((x, j) => (j === i ? event.target.value : x))),
      })))))
}

/** How a field's value reads in the 【作答】 message. */
function useQuizLabel(key, format) {
  const quiz = react.useContext(QuizContext)
  const ref = react.useRef(format)
  ref.current = format
  react.useEffect(() => quiz?.label(key, (v) => ref.current(v)), [quiz, key])
}

const RENDERERS = {
  Quiz: QuizRoot, Scene, Boss, Pick, Card: () => null, Choice, Slider, Sorter, Rewrite, Examples, SpotError, OrderSteps, Reason,
  ...createPlayRenderers({ useField: useQuizField, useLabel: useQuizLabel }),
}
/** The parts of a lang-core library that OpenUI's Renderer reads. */
const library = {
  id: 'learn-anything-quiz',
  __libraryId: 'learn-anything-quiz',
  root: schema.root,
  components: Object.fromEntries(Object.entries(RENDERERS).map(([name, component]) => [name, { name, component }])),
  componentGroups: undefined,
  functions: {},
  actions: {},
  toJSONSchema: () => schema.jsonSchema,
}

class Fallback extends react.Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/**
 * One quiz view. `answers`, `status` and `onAction` are owned by the caller; this
 * component never persists, sends or grades. Without `onAction` the card still shows
 * the question but cannot submit.
 */
export function Exercise({ view, answers = {}, onChange, confidence = null, onConfidenceChange, status = {}, onAction, isStreaming = false, helpDemo = null }) {
  const [fields, setFields] = react.useState([])
  const [failed, setFailed] = react.useState(false)
  const labels = react.useRef(new Map())
  const answersRef = react.useRef(answers)
  answersRef.current = answers

  const closed = status.closed ?? null
  const hints = status.hints ?? 0
  const pending = Boolean(status.pending)
  const error = status.error ?? null
  const canSend = status.canSend !== false
  const readOnly = Boolean(status.readOnly)
  const blocked = status.blocked ?? (readOnly || !onChange ? '这里不能作答' : '现在不能提交')
  const answerText = status.answerText ?? null
  const locked = readOnly || !onChange || isStreaming || closed !== null || Boolean(status.sending)

  const register = react.useCallback((key, complete) => {
    setFields((list) => {
      const index = list.findIndex((field) => field.key === key)
      if (index < 0) return [...list, { key, complete }]
      if (list[index].complete === complete) return list
      const next = list.slice()
      next[index] = { key, complete }
      return next
    })
    return () => setFields((list) => list.filter((field) => field.key !== key))
  }, [])

  const set = (key, value) => {
    if (locked) return
    const next = { ...answersRef.current, [key]: value }
    answersRef.current = next
    onChange?.(next)
  }

  const check = (field, value) => fieldComplete(field, value)
  const isComplete = () => fields.length > 0 && fields.every((field) => check(field, answersRef.current[field.key]))
  const canAct = () => !locked && canSend && typeof onAction === 'function'
  const canSetConfidence = !locked && typeof onConfidenceChange === 'function'

  const quiz = react.useMemo(() => ({
    id: view?.id,
    sources: view?.sources,
    retry: view?.retry,
    purpose: view?.purpose,
    isStreaming,
    answers,
    locked,
    closed,
    hints,
    pending,
    error,
    answerText,
    confidence,
    canSend,
    readOnly,
    helpDemo,
    demoReady: Boolean(status.demoReady),
    actionable: canAct(),
    canSetConfidence,
    blocked,
    fields,
    register,
    label: (key, format) => {
      labels.current.set(key, format)
      return () => labels.current.delete(key)
    },
    set,
    setConfidence: (value) => {
      if (locked || !onConfidenceChange) return
      onConfidenceChange(value)
    },
    submit: (title) => {
      if (!canAct() || !isComplete()) return
      const current = answersRef.current
      onAction({
        type: 'submit',
        title,
        answers: fields.map(({ key }) => ({ prompt: key, value: labels.current.get(key)?.(current[key]) ?? current[key] })),
        confidence,
      })
    },
    hint: (title) => {
      if (!canAct()) return
      onAction({ type: 'hint', title })
    },
    help: (kind, title) => {
      if (!canAct() || !['term', 'approach', 'demo'].includes(kind) || (kind === 'demo' && !helpDemo)) return
      onAction({ type: 'help', kind, title })
    },
    demoAction: (title, event) => {
      if (locked) return
      onAction?.({ type: 'demo', title, event })
    },
    close: (how, title) => {
      if (!canAct()) return
      onAction({ type: how, title })
    },
  }), [view?.id, view?.sources, view?.retry, view?.purpose, isStreaming, answers, locked, closed, hints, pending, error, answerText, confidence, canSend, readOnly, blocked, fields, register, onChange, onAction, onConfidenceChange, helpDemo, status.demoReady])

  const fallback = h('div', { className: 'la-card' }, h('p', { className: 'la-title' }, view?.purpose === 'practice' ? '理解练习' : '验证题'), h(QuestionText, { text: view?.question }))
  if (failed) return fallback
  return h(Fallback, { fallback },
    h(QuizContext.Provider, { value: quiz },
      isStreaming ? h('div', { className: 'la-row', role: 'status' }, '正在生成互动题…') : null,
      h(Renderer, {
        response: view?.ui,
        library,
        isStreaming,
        onParseResult: (result) => { if (!isStreaming && result && !result.root) setFailed(true) },
      })))
}
