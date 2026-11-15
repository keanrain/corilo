// Standalone playground for the four play answer forms. It imports the real Exercise
// renderer and shared examples directly: no src/client/main.js, no plugin loader and no
// DSH conversation/useInput mock. The page keeps the learner's answers, shows the exact
// structured submit event and never shows a standard answer or a made-up verdict.
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Exercise, QUIZ_CSS } from '../../src/client/exercise.js'
import { PLAY_EXAMPLES } from '../../src/quiz/examples.js'

const h = React.createElement

const CLOSED_LABEL = { answered: '已提交', easier: '已换一道更简单的', harder: '已换一道更难的', break: '已暂停' }
const readingScene = '你正在检查一套双相机采集系统，先根据现场记录确定下一步检查方向。\n\n**当前设置**\n- 两台相机的采集帧率均为 **60 fps**。\n- 曝光时间均为 **2 ms**，镜头与机位保持不变。\n\n**现场观察**\n- 分别查看每一路原片，静止物体和运动物体都清晰。\n- 静止时，两路画面中的标记能够重合。\n- 标记快速移动时，合成画面出现错开的副本；两路 `timestamp` 相差 **20 ms**。'
const readingPrompt = '为了定位运动时的重影，你会优先检查哪一类问题？'
const readingOptions = ['两路采集时间是否同步', '单路画面的曝光和清晰度', '静止物体的位置是否改变']
const examples = [...PLAY_EXAMPLES, {
  id: 'reading', title: '长题干的阅读层次', label: '题干排版',
  view: {
    view: 'quiz', id: 'play-reading', purpose: 'practice',
    ui: `root = Quiz("定位运动重影", "scenario", [Scene(${JSON.stringify(readingScene)}), Choice(${JSON.stringify(readingPrompt)}, ${JSON.stringify(readingOptions)}), Reason("哪条观察支持你的判断？")])`,
    question: `${readingScene}\n\n${readingPrompt}\n${readingOptions.map((option, i) => `${i + 1}. ${option}`).join('\n')}\n哪条观察支持你的判断？`,
  },
}]

const PLAYGROUND_CSS = `
:root{color-scheme:light;--pg-bg:#f3f4f0;--pg-paper:#fff;--pg-ink:#24322b;--pg-muted:#65736b;--pg-line:#cbd4ce;--pg-accent:#286444;--pg-gold:#9a6a24}
*{box-sizing:border-box}
body{margin:0;background:var(--pg-bg);color:var(--pg-ink);font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--pg-accent);text-underline-offset:3px}
button{font:inherit}
.pg{display:flex;flex-direction:column;gap:16px}
.pg-switch{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}
.pg-switch button{display:flex;flex-direction:column;gap:2px;text-align:left;padding:10px 12px;border:1px solid var(--pg-line);border-radius:10px;background:var(--pg-paper);color:var(--pg-ink);cursor:pointer;min-width:0}
.pg-switch button[aria-pressed=true]{border-color:var(--pg-accent);background:color-mix(in srgb,var(--pg-accent) 7%,var(--pg-paper));box-shadow:inset 0 0 0 1px var(--pg-accent)}
.pg-switch-label{font-size:10px;color:var(--pg-accent);font-weight:650;letter-spacing:.06em}
.pg-switch-title{font-size:12px;color:var(--pg-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pg-grid{display:grid;grid-template-columns:minmax(0,1.75fr) minmax(290px,1fr);gap:18px;align-items:start}
.pg-stage{display:flex;flex-direction:column;gap:10px;min-width:0}
.pg-stage-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap}
.pg-kicker{margin:0;color:var(--pg-accent);font-size:10px;font-weight:650;letter-spacing:.1em}
.pg-stage-head h2{margin:2px 0 0;font-size:16px;letter-spacing:-.02em}
.pg-live{font-size:11px;color:var(--pg-muted);white-space:nowrap}
.pg-live::before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--pg-muted);margin-right:6px;vertical-align:1px}
.pg-live[data-on=true]::before{background:var(--pg-accent);animation:pg-breathe 1.4s ease-in-out infinite}
.pg-lock{border:0;margin:0;padding:0;min-width:0;display:block}
.pg-lock-note{margin:0;padding:9px 12px;border-left:3px solid var(--pg-gold);border-radius:0 8px 8px 0;background:color-mix(in srgb,var(--pg-gold) 8%,var(--pg-paper));color:var(--pg-gold);font-size:11px}
.pg-notice{margin:0;padding:9px 12px;border-left:3px solid var(--pg-accent);border-radius:0 8px 8px 0;background:color-mix(in srgb,var(--pg-accent) 7%,var(--pg-paper));font-size:11px;color:var(--pg-ink)}
.pg-notice[data-tone=error]{border-left-color:var(--pg-gold);background:color-mix(in srgb,var(--pg-gold) 9%,var(--pg-paper));color:var(--pg-gold)}
.pg-controls{display:flex;gap:7px;flex-wrap:wrap;align-items:center;padding:12px;border:1px dashed var(--pg-line);border-radius:11px;background:color-mix(in srgb,var(--pg-paper) 65%,transparent)}
.pg-controls-label{font-size:10px;color:var(--pg-muted);margin-right:2px}
.pg-btn{min-height:32px;padding:6px 10px;border:1px solid var(--pg-line);border-radius:8px;background:var(--pg-paper);color:var(--pg-muted);font-size:11px;cursor:pointer}
.pg-btn[aria-pressed=true]{border-color:var(--pg-accent);background:color-mix(in srgb,var(--pg-accent) 8%,var(--pg-paper));color:var(--pg-accent)}
.pg-btn:focus-visible{outline:2px solid var(--pg-accent);outline-offset:2px}
.pg-side{display:flex;flex-direction:column;gap:10px;min-width:0}
.pg-panel{border:1px solid var(--pg-line);border-radius:11px;background:var(--pg-paper);padding:12px;min-width:0}
.pg-panel h3{margin:0 0 8px;font-size:11px;letter-spacing:.04em;color:var(--pg-muted);font-weight:600}
.pg-state{display:grid;gap:5px;margin:0;font-size:11px}
.pg-state div{display:flex;justify-content:space-between;gap:10px}
.pg-state dt{color:var(--pg-muted)}
.pg-state dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}
.pg-json{margin:0;max-height:190px;overflow:auto;padding:9px 10px;border-radius:8px;background:#f7f8f5;color:#31473b;font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.pg-empty{margin:0;font-size:11px;color:var(--pg-muted)}
.pg-question{margin:0;font-size:11px;color:var(--pg-muted)}
.pg-question summary{cursor:pointer;font-weight:600;color:var(--pg-ink)}
.pg-question p{margin:7px 0 0;line-height:1.7}
.pg-events{list-style:none;margin:0;padding:0;display:grid;gap:6px;max-height:220px;overflow:auto}
.pg-events li{display:grid;gap:2px;padding:7px 8px;border:1px solid var(--pg-line);border-radius:8px;font-size:10px}
.pg-events b{font-size:11px;font-weight:600;color:var(--pg-accent)}
.pg-events span{color:var(--pg-muted)}

/* Minimal card tokens/base so QUIZ_CSS can stand alone without CARD_CSS. */
.la-card,.la-quiz{--la-ink:var(--dsw-alias-label-primary,#23342f);--la-muted:var(--dsw-alias-label-secondary,#64726b);--la-paper:var(--dsw-alias-bg-base,#fff);--la-line:var(--dsw-alias-border-l2,#e3e8e3);--la-accent:color-mix(in srgb,#338578 82%,var(--la-ink));--la-soft:color-mix(in srgb,var(--la-accent) 6%,var(--la-paper));--la-gold:color-mix(in srgb,#c49339 85%,var(--la-ink));--la-ease:cubic-bezier(.23,1,.32,1);container:learning/inline-size;box-sizing:border-box;min-width:0;border:1px solid var(--la-line);border-radius:18px;background:var(--la-paper);margin:0;overflow:hidden;color:var(--la-ink);font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.65;box-shadow:0 3px 14px #12251a05;overflow-wrap:anywhere}
.la-card{padding:22px;overflow:visible}
.la-card *,.la-quiz *{box-sizing:border-box}
.la-icon{width:20px;height:20px;flex:none;vertical-align:middle}
.la-emblem{display:grid;place-items:center;flex:none;width:40px;height:40px;flex:none;border:1px solid color-mix(in srgb,var(--la-accent) 16%,var(--la-line));border-radius:12px;color:var(--la-accent);background:var(--la-soft)}
.la-grow{flex:1;min-width:0}
.la-eyebrow{display:flex;align-items:center;gap:7px;margin:0 0 5px;color:var(--la-accent);font-size:11px;font-weight:600;letter-spacing:.08em}
.la-title{font-weight:650;font-size:17px;line-height:1.5;letter-spacing:-.02em;margin:0;text-wrap:pretty}
.la-sub{color:var(--la-muted);font-size:12px;margin:7px 0 0}
.la-muted{color:var(--la-muted,var(--dsw-alias-label-secondary))}
.la-row{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:26px}
.la-pre{white-space:pre-wrap;overflow-wrap:anywhere}
.la-sources{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 8px;margin-top:9px;font-size:10px;color:var(--la-muted);overflow-wrap:anywhere}
.la-sources code{font-size:10px;color:inherit}
.la-sources a{color:var(--la-accent);text-decoration:underline;text-underline-offset:3px}
.la-card button,.la-quiz button{font-family:inherit;touch-action:manipulation}
.la-card button:focus-visible,.la-card summary:focus-visible,.la-card a:focus-visible,.la-quiz button:focus-visible,.la-quiz input:focus-visible,.la-quiz textarea:focus-visible{outline:2px solid var(--la-accent);outline-offset:3px}
.la-card button:not(:disabled):active,.la-quiz button:not(:disabled):active{transform:scale(.98)}
.la-card button:disabled,.la-quiz button:disabled{cursor:default}
@keyframes pg-breathe{0%,100%{opacity:.35}50%{opacity:1}}
@media(max-width:820px){.pg-grid{grid-template-columns:minmax(0,1fr)}.pg-switch{grid-template-columns:repeat(2,minmax(0,1fr))}.pg-side{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}}
@media(max-width:480px){.pg-switch{grid-template-columns:minmax(0,1fr)}}
@media(prefers-reduced-motion:reduce){.pg-live[data-on=true]::before{animation:none}.la-card button:active,.la-quiz button:active{transform:none}}
`

const style = document.createElement('style')
style.dataset.learnAnythingPlayground = ''
style.textContent = `${QUIZ_CSS}\n${PLAYGROUND_CSS}`
document.head.append(style)

const EMPTY_RECORD = { answers: {}, confidence: null, status: {} }
const patch = (map, id, change) => {
  const next = new Map(map)
  const current = next.get(id) ?? EMPTY_RECORD
  next.set(id, typeof change === 'function' ? change(current) : { ...current, ...change })
  return next
}

function answerText(event) {
  const lines = (Array.isArray(event.answers) ? event.answers : [])
    .map(({ prompt, value }) => `${prompt}：${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .filter(Boolean)
  return lines.length ? lines.join('\n') : '（本次提交没有可读答案）'
}

function App() {
  const [activeId, setActiveId] = React.useState(examples[0]?.id)
  const [records, setRecords] = React.useState(() => new Map())
  const [logs, setLogs] = React.useState([])
  const [lastEvent, setLastEvent] = React.useState(null)
  const [isStreaming, setStreaming] = React.useState(false)
  const [readOnly, setReadOnly] = React.useState(false)
  const [failNext, setFailNext] = React.useState(false)
  const [notice, setNotice] = React.useState({ tone: 'info', text: '选一种玩法开始。作答、切换与失败重试都会保留答案。' })

  const entry = examples.find((item) => item.id === activeId) ?? examples[0]
  const record = records.get(entry?.id) ?? EMPTY_RECORD
  const baseStatus = record.status ?? {}
  const closed = baseStatus.closed ?? null
  const locked = isStreaming || readOnly || closed !== null
  const canSend = !locked
  const status = {
    ...baseStatus,
    readOnly,
    canSend,
    hints: baseStatus.hints ?? 0,
    blocked: isStreaming ? '演示：正在流式生成，题卡已锁定' : readOnly ? '演示：只读模式，不能作答' : baseStatus.blocked,
  }

  const remember = (id, event) => {
    setLastEvent(event)
    setLogs((previous) => [{ id: previous.length + 1, at: new Date().toLocaleTimeString('zh-CN', { hour12: false }), event }, ...previous].slice(0, 8))
  }

  const onAction = (event) => {
    const id = entry.id
    remember(id, event)
    if (event.type === 'submit') {
      if (failNext) {
        setFailNext(false)
        setRecords((previous) => patch(previous, id, (current) => ({
          ...current,
          status: { ...current.status, closed: null, pending: true, error: '模拟提交失败：答案已保留，可以重试。' },
        })))
        setNotice({ tone: 'error', text: '已模拟一次网络失败。作答仍保留，再点一次「重试提交」即可。' })
        return
      }
      setRecords((previous) => patch(previous, id, (current) => ({
        ...current,
        status: {
          closed: 'answered',
          pending: false,
          error: null,
          hints: current.status?.hints ?? 0,
          answerText: answerText(event),
        },
      })))
      setNotice({ tone: 'info', text: '已收到结构化 submit 事件。演示页不判对错，也不显示标准答案。' })
      return
    }
    if (event.type === 'hint') {
      setRecords((previous) => patch(previous, id, (current) => ({
        ...current,
        status: { ...current.status, error: null, hints: (current.status?.hints ?? 0) + 1 },
      })))
      setNotice({ tone: 'info', text: '已记录 hint 事件，题卡保持开放。' })
      return
    }
    if (event.type === 'help') {
      setNotice({ tone: 'info', text: `已收到 help 事件（${event.kind === 'term' ? '这个词不懂' : '不知道从哪开始'}）。原题和答案保留；演示页不生成补讲。` })
      return
    }
    if (event.type === 'easier' || event.type === 'harder' || event.type === 'break') {
      setRecords((previous) => patch(previous, id, (current) => ({
        ...current,
        status: { ...current.status, closed: event.type, pending: false },
      })))
      setNotice({ tone: 'info', text: `已记录 ${event.type} 事件，并按演示逻辑关闭这张题卡。` })
    }
  }

  const select = (id) => {
    setActiveId(id)
    setNotice({ tone: 'info', text: '已切换题卡；之前填写的答案仍保留。' })
  }

  const reset = () => {
    setRecords(new Map())
    setLogs([])
    setLastEvent(null)
    setStreaming(false)
    setReadOnly(false)
    setFailNext(false)
    setNotice({ tone: 'info', text: '已重置答案、事件记录和演示开关。' })
  }

  if (!entry) {
    return h('div', { className: 'pg', 'data-playground': '' }, h('p', { className: 'pg-empty' }, 'PLAY_EXAMPLES 里还没有可用的四玩法样例。'))
  }

  return h('div', { className: 'pg', 'data-playground': '' },
    h('nav', { className: 'pg-switch', 'aria-label': '四种玩法' }, examples.map((item) => h('button', {
      key: item.id,
      type: 'button',
      'data-play-type': item.id,
      'aria-pressed': item.id === entry.id,
      onClick: () => select(item.id),
    }, h('span', { className: 'pg-switch-label' }, item.label ?? item.id), h('span', { className: 'pg-switch-title' }, item.title ?? '')))),
    h('div', { className: 'pg-grid' },
      h('section', { className: 'pg-stage', 'data-play-stage': entry.id, 'aria-label': `${entry.label ?? entry.id}演示` },
        h('div', { className: 'pg-stage-head' },
          h('div', null,
            h('p', { className: 'pg-kicker' }, `独立 Exercise · ${entry.label ?? entry.id}`),
            h('h2', null, entry.title ?? entry.view?.question ?? '')),
          h('span', { className: 'pg-live', 'data-on': isStreaming }, isStreaming ? '流式生成中，题卡锁定' : '可交互')),
        locked ? h('p', { className: 'pg-lock-note', role: 'status' },
          isStreaming ? '当前模拟：流式生成锁定（isStreaming=true）。' : readOnly ? '当前模拟：只读模式（题卡控件全部禁用）。' : `当前模拟：${CLOSED_LABEL[closed] ?? closed}，题卡已关闭。`) : null,
        // No outer disabled fieldset: readOnly is part of Exercise's status, so the
        // demo verifies the component's own read-only semantics rather than masking them.
        h('div', { className: 'pg-lock', 'data-locked': locked, 'data-exercise-id': entry.view.id },
          h(Exercise, {
            key: entry.id,
            view: entry.view,
            answers: record.answers,
            onChange: (nextAnswers) => setRecords((previous) => patch(previous, entry.id, { answers: nextAnswers })),
            confidence: record.confidence,
            onConfidenceChange: (value) => setRecords((previous) => patch(previous, entry.id, { confidence: value })),
            status,
            onAction,
            isStreaming,
          })),
        h('p', { className: 'pg-notice', 'data-tone': notice.tone, 'data-notice': '', role: 'status', 'aria-live': 'polite' }, notice.text),
        h('div', { className: 'pg-controls', 'aria-label': '演示控制' },
          h('span', { className: 'pg-controls-label' }, '演示控制'),
          h('button', { type: 'button', className: 'pg-btn', 'data-fail-next': '', 'aria-pressed': failNext, onClick: () => { setFailNext(true); setNotice({ tone: 'info', text: '下一次提交会模拟网络失败；答案会保留。' }) } }, '模拟下次提交失败'),
          h('button', { type: 'button', className: 'pg-btn', 'data-readonly': '', 'aria-pressed': readOnly, onClick: () => { setReadOnly((value) => !value); setNotice({ tone: 'info', text: readOnly ? '已退出只读模式。' : '已进入只读模式，题卡控件禁用。' }) } }, readOnly ? '只读：开' : '只读：关'),
          h('button', { type: 'button', className: 'pg-btn', 'data-streaming': '', 'aria-pressed': isStreaming, onClick: () => { setStreaming((value) => !value); setNotice({ tone: 'info', text: isStreaming ? '已结束流式锁定。' : '已进入流式锁定，题卡暂时不可作答。' }) } }, isStreaming ? '流式锁定：开' : '流式锁定：关'),
          h('button', { type: 'button', className: 'pg-btn', 'data-reset': '', onClick: reset }, '重置演示')),
        h('details', { className: 'pg-question' }, h('summary', null, '查看 view.question 文字题面'), h('p', null, entry.view?.question ?? '（无）'))),
      h('aside', { className: 'pg-side' },
        h('section', { className: 'pg-panel', 'aria-label': '当前状态' },
          h('h3', null, '当前状态'),
          h('dl', { className: 'pg-state' },
            h('div', null, h('dt', null, '样例 ID'), h('dd', null, entry.id)),
            h('div', null, h('dt', null, '答案'), h('dd', null, Object.keys(record.answers).length ? '已保留' : '未作答')),
            h('div', null, h('dt', null, '把握'), h('dd', null, record.confidence ?? '未选')),
            h('div', null, h('dt', null, '题卡'), h('dd', null, closed ? (CLOSED_LABEL[closed] ?? closed) : '开放')),
            h('div', null, h('dt', null, '提示次数'), h('dd', null, status.hints)),
            h('div', null, h('dt', null, '可提交'), h('dd', null, canSend ? '是（仍以 Exercise 完整性为准）' : '否')))),
        h('section', { className: 'pg-panel', 'aria-label': '已保留答案' },
          h('h3', null, '已保留答案（answers）'),
          h('pre', { className: 'pg-json', 'data-answers': '' }, JSON.stringify(record.answers, null, 2))),
        h('section', { className: 'pg-panel', 'aria-label': '最近一次事件' },
          h('h3', null, '最近一次结构化事件'),
          h('pre', { className: 'pg-json', 'data-last-event': '' }, lastEvent ? JSON.stringify(lastEvent, null, 2) : '尚未提交或触发控制事件')),
        h('section', { className: 'pg-panel', 'aria-label': '事件记录' },
          h('h3', null, '事件记录（最新在前）'),
          logs.length
            ? h('ul', { className: 'pg-events' }, logs.map((log) => h('li', { key: log.id },
              h('b', null, log.event.type),
              h('span', null, log.at),
              h('span', null, log.event.type === 'submit'
                ? `${(log.event.answers ?? []).length} 项答案 · 把握 ${log.event.confidence ?? '未选'} · 标题 ${log.event.title ?? '（无）'}`
                : '已记录控制事件'))))
            : h('p', { className: 'pg-empty' }, '还没有事件。提交或点击提示/难度/暂停后会显示在这里。')))))
}

createRoot(document.getElementById('playground')).render(h(App))
