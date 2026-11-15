import { t, useUiLocale } from './locale.js'
// Four answer *forms* on top of the existing quiz card: Counterexample,
// MinimalChange, DualPredict and TransferTask. They only lay out the task and collect
// one value in the agreed shape; completion and the readable form come from
// src/quiz/play.js, and no prop or UI marks an answer as correct. The hooks are
// injected by ./exercise.js, so this module never imports the quiz context back.
import * as react from 'react'
import { playAnswerComplete, playAnswerText } from '../quiz/play.js'
import { InlineText, QuestionText } from './question-text.js'

const h = react.createElement
const LETTERS = 'ABCDEFGHIJ'

const asText = (value) => (typeof value === 'string' ? value : value == null ? '' : String(value))
const asList = (value) => (Array.isArray(value) ? value : [])
const indexIn = (value, length) => (Number.isInteger(value) && value >= 0 && value < length ? value : null)

function Intro({ eyebrow, title, note }) {
  useUiLocale()
  return h('div', { className: 'la-play-intro' },
    h('div', { className: 'la-play-head' },
      h('span', { className: 'la-play-kicker' }, h('span', { className: 'la-play-spark', 'aria-hidden': true }), eyebrow),
      h('p', { className: 'la-q' }, h(InlineText, { text: title }))),
    note ? h('p', { className: 'la-play-note' }, note) : null)
}

/** A case marker for the detective/blueprint framing; purely visual. */
function CaseNo({ children }) {
  useUiLocale()
  return h('span', { className: 'la-play-no', 'aria-hidden': true }, children)
}

export function createPlayRenderers({ useField, useLabel }) {
  function Counterexample({ props = {} }) {
    useUiLocale()
    const cases = asList(props.cases)
    const [value, set, locked] = useField(props.prompt, (next) => playAnswerComplete('Counterexample', props, next))
    useLabel(props.prompt, (next) => playAnswerText('Counterexample', props, next))
    const current = Array.isArray(value) ? value : []
    const selected = indexIn(current[0], cases.length)
    const reason = asText(current[1])
    const update = (index, text) => set([index, text])
    return h('section', { className: 'la-play', 'data-play': 'counterexample' },
      h(Intro, { eyebrow: t('反例侦探 · 01'), title: props.prompt, note: '从候选里挑一条最能推翻说法的案例，再说清它缺了哪个条件。' }),
      h('div', { className: 'la-play-claim' },
        h('span', { className: 'la-play-tag' }, t('待检验的说法')),
        h(QuestionText, { text: props.claim })),
      h('div', { className: 'la-play-step' },
        h('p', { className: 'la-play-label' }, '哪条候选案例能让这个说法站不住？',
          h('small', null, cases.length ? t('{count} 条候选', { count: cases.length }) : t('候选还在生成'))),
        cases.length ? h('div', { className: 'la-play-cases', role: 'group', 'aria-label': asText(props.prompt) || t('候选案例') },
          cases.map((item, index) => h('button', {
            key: index, type: 'button', className: 'la-play-case', disabled: locked,
            'aria-pressed': selected === index, onClick: () => update(index, reason),
          }, h(CaseNo, null, LETTERS[index] ?? index + 1), h(InlineText, { text: item }))))
          : h('p', { className: 'la-play-empty' }, t('候选案例还没有生成完。'))),
      h('label', { className: 'la-play-field' },
        h('span', { className: 'la-play-label' }, '缺了哪个条件？'),
        h('textarea', {
          className: 'la-reason', 'aria-label': `${asText(props.prompt) || t('反例')}：说明缺失条件`,
          value: reason, readOnly: locked, placeholder: props.placeholder ?? '这条案例为什么推翻说法？它缺了哪个前提？',
          onChange: (event) => update(selected, event.target.value),
        })))
  }

  function MinimalChange({ props = {} }) {
    useUiLocale()
    const conditions = asList(props.conditions)
    const [value, set, locked] = useField(props.prompt, (next) => playAnswerComplete('MinimalChange', props, next))
    useLabel(props.prompt, (next) => playAnswerText('MinimalChange', props, next))
    const current = Array.isArray(value) ? value : []
    const selected = indexIn(current[0], conditions.length)
    const replacement = asText(current[1])
    const reason = asText(current[2])
    const update = (index, text, why) => set([index, text, why])
    return h('section', { className: 'la-play', 'data-play': 'minimal-change' },
      h(Intro, { eyebrow: t('最小改动 · 02'), title: props.prompt, note: '只动一条条件，其余保持原样；先改，再看预览。' }),
      h('div', { className: 'la-play-brief la-play-goal' },
        h('span', { className: 'la-play-tag' }, t('目标')),
        h(QuestionText, { text: props.goal })),
      h('div', { className: 'la-play-step' },
        h('p', { className: 'la-play-label' }, t('选一条要改的条件'),
          h('small', null, conditions.length ? t('其余条件不变') : t('条件还在生成'))),
        conditions.length ? h('div', { className: 'la-play-conds', role: 'group', 'aria-label': asText(props.prompt) || t('选择要改的条件') },
          conditions.map((item, index) => h('button', {
            key: index, type: 'button', className: 'la-play-cond', disabled: locked,
            'aria-pressed': selected === index, onClick: () => update(index, replacement, reason),
          }, h(CaseNo, null, index + 1), h('span', { className: 'la-play-cond-text' }, h(InlineText, { text: item })),
          selected === index ? h('span', { className: 'la-play-cond-flag' }, t('改这条')) : null)))
          : h('p', { className: 'la-play-empty' }, t('条件还没有生成完。'))),
      h('label', { className: 'la-play-field' },
        h('span', { className: 'la-play-label' }, selected === null ? t('先选一条条件，再写替换') : t('把第 {index} 条改成', { index: selected + 1 })),
        h('textarea', {
          className: 'la-reason', 'aria-label': t('替换后的条件'), value: replacement, readOnly: locked || selected === null,
          placeholder: selected === null ? t('点上面的一条条件') : props.placeholder ?? t('写出替换后的条件，不改变其它条件'),
          onChange: (event) => update(selected, event.target.value, reason),
        })),
      h('div', { className: 'la-play-preview', 'aria-label': t('修改预览') },
        h('span', { className: 'la-play-tag' }, t('修改预览')),
        conditions.length ? h('ol', null, conditions.map((item, index) => h('li', {
          key: index, 'data-active': selected === index,
        }, h(CaseNo, null, index + 1), h('span', { className: 'la-play-cond-text' }, h(InlineText, { text: item })),
        selected === index
          ? h('span', { className: 'la-play-cond-new' }, replacement.trim() ? `→ ${replacement.trim()}` : t('→ 待填写'))
          : h('span', { className: 'la-play-cond-keep' }, t('不变')))))
          : h('p', { className: 'la-play-empty' }, t('还没有可预览的条件。'))),
      h('label', { className: 'la-play-field' },
        h('span', { className: 'la-play-label' }, '为什么只改这一条？'),
        h('textarea', {
          className: 'la-reason', 'aria-label': `${asText(props.prompt) || '最小改动'}：理由`,
          value: reason, readOnly: locked, placeholder: '说说为什么这一处改动足够，其它条件为什么不用动',
          onChange: (event) => update(selected, replacement, event.target.value),
        })))
  }

  function DualPredict({ props = {} }) {
    useUiLocale()
    const options = asList(props.options)
    const [value, set, locked] = useField(props.prompt, (next) => playAnswerComplete('DualPredict', props, next))
    useLabel(props.prompt, (next) => playAnswerText('DualPredict', props, next))
    const current = Array.isArray(value) ? value : []
    const before = indexIn(current[0], options.length)
    const after = indexIn(current[1], options.length)
    const reason = asText(current[2])
    const choose = (side, index) => set(side === 'before' ? [index, after, reason] : [before, index, reason])
    const column = (side, title, scene, selected) => h('section', { className: 'la-play-split' },
      h('div', { className: 'la-play-split-head' },
        h('span', { className: 'la-play-tag' }, title),
        h('span', { className: 'la-play-split-no', 'aria-hidden': true }, side === 'before' ? 'A' : 'B')),
      h(QuestionText, { className: 'la-play-scene', text: scene }),
      h('div', { className: 'la-play-options', role: 'group', 'aria-label': `${title}：选一个预测` },
        options.length ? options.map((option, index) => h('button', {
          key: index, type: 'button', className: 'la-play-opt', disabled: locked,
          'aria-pressed': selected === index, onClick: () => choose(side, index),
        }, h(CaseNo, null, LETTERS[index] ?? index + 1), h(InlineText, { text: option })))
          : h('p', { className: 'la-play-empty' }, t('选项还没有生成完。'))))
    return h('section', { className: 'la-play', 'data-play': 'dual-predict' },
      h(Intro, { eyebrow: t('双局预测 · 03'), title: props.prompt, note: '两场只改变一个因素；同一组选项，分别预测。' }),
      h('div', { className: 'la-play-cols' },
        column('before', t('变化前'), props.before, before),
        column('after', t('变化后'), props.after, after)),
      h('label', { className: 'la-play-field' },
        h('span', { className: 'la-play-label' }, '结果相同或不同的依据是什么？'),
        h('textarea', {
          className: 'la-reason', 'aria-label': `${asText(props.prompt) || '双局预测'}：理由`,
          value: reason, readOnly: locked, placeholder: props.placeholder ?? '分别说说两场的预测，以及只变这一个因素怎样影响结果',
          onChange: (event) => set([before, after, event.target.value]),
        })))
  }

  function TransferTask({ props = {} }) {
    useUiLocale()
    const constraints = asList(props.constraints)
    const [value, set, locked] = useField(props.prompt, (next) => playAnswerComplete('TransferTask', props, next))
    useLabel(props.prompt, (next) => playAnswerText('TransferTask', props, next))
    const current = Array.isArray(value) ? value : []
    const plan = asText(current[0])
    const reason = asText(current[1])
    const update = (nextPlan, nextReason) => set([nextPlan, nextReason])
    return h('section', { className: 'la-play', 'data-play': 'transfer' },
      h(Intro, { eyebrow: t('迁移任务 · 04'), title: props.prompt, note: '进入新的任务现场：写方案，再说清你的判断依据。' }),
      h('div', { className: 'la-play-brief' },
        h('span', { className: 'la-play-tag' }, t('新领域现场')),
        h(QuestionText, { text: props.situation }),
        h('div', { className: 'la-play-goal' },
          h('span', { className: 'la-play-tag' }, t('目标')),
          h(QuestionText, { text: props.goal })),
        constraints.length ? h('div', { className: 'la-play-constraints' },
          h('span', { className: 'la-play-label' }, t('约束')),
          h('ul', null, constraints.map((item, index) => h('li', { key: index }, h(InlineText, { text: item }))))) : null),
      h('label', { className: 'la-play-field' },
        h('span', { className: 'la-play-label' }, t('行动方案')),
        h('textarea', {
          className: 'la-reason', 'aria-label': t('行动方案'), value: plan, readOnly: locked,
          placeholder: '在这个新领域里，具体怎么做？写出可执行的步骤。',
          onChange: (event) => update(event.target.value, reason),
        })),
      h('label', { className: 'la-play-field' },
        h('span', { className: 'la-play-label' }, '原规律为什么在这里适用？'),
        h('textarea', {
          className: 'la-reason', 'aria-label': `${asText(props.prompt) || '迁移任务'}：适用理由`,
          value: reason, readOnly: locked, placeholder: '你用了哪条规律？题面哪些条件让它适用？',
          onChange: (event) => update(plan, event.target.value),
        })))
  }

  return { Counterexample, MinimalChange, DualPredict, TransferTask }
}

export const PLAY_CSS = `
.la-play{display:flex;flex-direction:column;gap:15px}
.la-play-intro{display:flex;flex-direction:column;gap:5px}.la-play-head{display:flex;flex-direction:column;align-items:flex-start;gap:9px}
.la-play-kicker{display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:600;letter-spacing:.08em;color:var(--la-accent);white-space:nowrap}
.la-play-spark{width:6px;height:6px;border-radius:50%;background:var(--la-gold);box-shadow:0 0 0 3px color-mix(in srgb,var(--la-gold) 14%,transparent)}
.la-play-intro .la-q{margin:0;min-width:0}.la-play-note{margin:0;color:var(--la-muted);font-size:11px;line-height:1.7}
.la-play-tag{display:inline-block;font-size:10px;font-weight:550;letter-spacing:.05em;color:var(--la-muted);margin-bottom:6px}
.la-play-claim,.la-play-brief{position:relative;padding:14px 16px;border:1px solid color-mix(in srgb,var(--la-gold) 18%,var(--la-line));border-radius:12px;background:color-mix(in srgb,var(--la-gold) 5%,var(--la-paper));font-size:12px;line-height:1.75}
.la-play-goal{border-left:3px solid var(--la-accent)}.la-play-brief>.la-play-goal{margin-top:16px;padding:0 0 0 12px}.la-play-goal>.la-play-tag{color:var(--la-accent);font-weight:600}
.la-play-step{display:flex;flex-direction:column;gap:8px}.la-play-label{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;font-size:11px;font-weight:550;color:var(--la-ink);margin:0}
.la-play-label small{margin-left:auto;font-size:10px;font-weight:400;color:var(--la-muted)}
.la-play-cases,.la-play-conds{display:flex;flex-direction:column;gap:7px}
.la-play-case,.la-play-cond{display:flex;align-items:center;gap:10px;width:100%;text-align:left;font:inherit;font-size:12px;line-height:1.65;color:inherit;border:1px solid var(--la-line);border-radius:10px;background:var(--la-paper);padding:11px 12px;cursor:pointer;transition:border-color 140ms ease,background 140ms ease}
.la-play-case[aria-pressed=true],.la-play-cond[aria-pressed=true]{border-color:var(--la-accent);background:var(--la-soft);box-shadow:inset 0 0 0 .5px var(--la-accent)}
.la-play-case:disabled,.la-play-cond:disabled,.la-play-opt:disabled{cursor:default}
.la-play-no{display:grid;place-items:center;flex:none;width:23px;height:23px;font:10px/1 ui-monospace,monospace;color:var(--la-muted);border:1px solid var(--la-line);border-radius:50%;background:var(--la-paper)}
.la-play-case[aria-pressed=true] .la-play-no,.la-play-cond[aria-pressed=true] .la-play-no{color:var(--la-paper);background:var(--la-accent);border-color:var(--la-accent)}
.la-play-cond-text{min-width:0;overflow-wrap:anywhere}.la-play-cond-flag{margin-left:auto;font-size:10px;color:var(--la-accent);white-space:nowrap}
.la-play-field{display:flex;flex-direction:column;gap:7px}
.la-play-field .la-reason{min-height:78px}
.la-play-preview{padding:13px 14px;border:1px dashed color-mix(in srgb,var(--la-accent) 25%,var(--la-line));border-radius:11px;background:var(--la-soft)}
.la-play-preview ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:7px}
.la-play-preview li{display:grid;grid-template-columns:23px minmax(0,1fr);gap:5px 9px;align-items:baseline;font-size:11px;line-height:1.6;color:var(--la-muted)}
.la-play-preview li .la-play-cond-text{grid-column:2;color:var(--la-ink)}
.la-play-preview li[data-active=true] .la-play-cond-text{text-decoration:line-through;text-decoration-color:var(--la-muted);opacity:.72}
.la-play-cond-new,.la-play-cond-keep{grid-column:2;font-size:10px}.la-play-cond-new{color:var(--la-accent);overflow-wrap:anywhere}.la-play-cond-keep{color:var(--la-muted)}
.la-play-cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.la-play-split{min-width:0;padding:12px;border:1px solid var(--la-line);border-radius:12px;background:var(--la-paper)}
.la-play-split-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.la-play-split-head .la-play-tag{margin:0}
.la-play-split-no{font:10px ui-monospace,monospace;color:var(--la-gold);letter-spacing:.08em}
.la-play-scene{min-height:54px;margin:10px 0 14px;font-size:12px}
.la-play-options{display:flex;flex-direction:column;gap:6px}
.la-play-opt{display:flex;align-items:center;gap:8px;width:100%;text-align:left;font:inherit;font-size:11px;line-height:1.55;color:inherit;border:1px solid var(--la-line);border-radius:8px;background:var(--la-paper);padding:8px 9px;cursor:pointer}
.la-play-opt[aria-pressed=true]{border-color:var(--la-accent);color:var(--la-accent);background:var(--la-soft)}
.la-play-opt .la-play-no{width:19px;height:19px;font-size:9px}.la-play-opt[aria-pressed=true] .la-play-no{color:var(--la-paper);background:var(--la-accent);border-color:var(--la-accent)}
.la-play-constraints{margin-top:16px;padding-top:14px;border-top:1px solid var(--la-line)}.la-play-constraints ul{list-style:disc;margin:8px 0 0;padding-left:18px;display:grid;gap:8px}
.la-play-constraints li{font-size:12px;line-height:1.8;padding-left:3px;overflow-wrap:anywhere}.la-play-constraints li::marker{color:var(--la-muted)}
.la-play-empty{margin:0;padding:12px;color:var(--la-muted);font-size:11px;border:1px dashed var(--la-line);border-radius:9px}
.la-play textarea:disabled{opacity:.65;cursor:not-allowed}
@container learning (max-width:560px){.la-play-cols{grid-template-columns:1fr}.la-play-scene{min-height:0}}
@container learning (max-width:420px){.la-play-label small{margin-left:0}}
@media(hover:hover) and (pointer:fine){.la-play-case:hover:not(:disabled),.la-play-cond:hover:not(:disabled),.la-play-opt:hover:not(:disabled){border-color:var(--la-accent);background:var(--la-soft)}}
@media(prefers-reduced-motion:reduce){.la-play-case,.la-play-cond,.la-play-opt{transition:none}}
`
