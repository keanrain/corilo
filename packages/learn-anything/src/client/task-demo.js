import * as React from 'react'

const h = React.createElement

export const TASK_DEMO_SCENE = {
  id: 'execution-waiting',
  title: '认清执行与等待',
  task: '新任务',
  execution: '执行区',
  waiting: '等待区',
  executionNote: '执行位正在处理任务。任务占着执行位，才是正在执行。',
  waitingNote: '等待区只存放尚未开始处理的任务。排在这里，不等于已经在执行。',
  scope: '这个小例子预设等待区有空位，只观察执行与等待。扩容、拒绝和交接机制，以实际题面为准。',
}

/** A local observation exercise. No messages, persistence, quiz answers or grading. */
export function TaskDemo({ config, disabled = false, onAction }) {
  const scene = { ...TASK_DEMO_SCENE, ...config }
  const [mode, setMode] = React.useState('available')
  const [placed, setPlaced] = React.useState(false)
  const [area, setArea] = React.useState('execution')
  const destination = placed ? mode === 'available' ? 'execution' : 'waiting' : null
  const emit = (event) => onAction?.(event)
  const changeMode = (next) => {
    if (disabled || next === mode) return
    setMode(next)
    setPlaced(false)
    emit({ type: 'mode', mode: next })
  }
  const inspect = (next) => {
    if (disabled) return
    setArea(next)
    emit({ type: 'inspect', area: next })
  }
  const place = () => {
    if (disabled || placed) return
    setPlaced(true)
    const target = mode === 'available' ? 'execution' : 'waiting'
    setArea(target)
    emit({ type: 'place', mode, destination: target })
  }
  const token = (text, fresh = false) => h('span', { className: 'la-demo-token', 'data-new': fresh }, text)
  return h('section', { className: 'la-task-demo', 'aria-label': scene.title, 'data-demo': scene.id },
    h('div', { className: 'la-demo-head' },
      h('span', { className: 'la-demo-tag' }, '动手补给'),
      h('h4', null, scene.title)),
    h('p', { className: 'la-demo-scope' }, scene.scope),
    h('div', { className: 'la-demo-modes', role: 'group', 'aria-label': '执行位状态' },
      h('button', { type: 'button', 'aria-pressed': mode === 'available', disabled, onClick: () => changeMode('available') }, '有空闲执行位'),
      h('button', { type: 'button', 'aria-pressed': mode === 'busy', disabled, onClick: () => changeMode('busy') }, '执行位全部在忙')),
    h('div', { className: 'la-demo-board' },
      h('div', { className: 'la-demo-entry' },
        h('span', null, '任务入口'),
        h('div', { className: 'la-demo-incoming' }, placed ? h('span', { className: 'la-demo-empty' }, '已放入 →') : token(scene.task, true))),
      h('div', { className: 'la-demo-zones' },
        h('button', { type: 'button', className: 'la-demo-zone', 'aria-label': scene.execution, 'aria-pressed': area === 'execution', 'data-received': destination === 'execution', disabled, onClick: () => inspect('execution') },
          h('span', { className: 'la-demo-zone-title' }, scene.execution, h('small', null, '正在处理')),
          h('span', { className: 'la-demo-slots' }, token('任务 A'), destination === 'execution' ? token(scene.task, true) : mode === 'busy' ? token('任务 B') : h('span', { className: 'la-demo-slot' }, '空闲'))),
        h('button', { type: 'button', className: 'la-demo-zone', 'aria-label': scene.waiting, 'aria-pressed': area === 'waiting', 'data-received': destination === 'waiting', disabled, onClick: () => inspect('waiting') },
          h('span', { className: 'la-demo-zone-title' }, scene.waiting, h('small', null, '尚未开始')),
          h('span', { className: 'la-demo-slots' }, destination === 'waiting' ? token(scene.task, true) : h('span', { className: 'la-demo-slot' }, '空位'), h('span', { className: 'la-demo-slot' }, '空位'))))),
    h('p', { className: 'la-demo-explain' }, area === 'execution' ? scene.executionNote : scene.waitingNote),
    h('p', { className: 'la-demo-result', role: 'status', 'aria-live': 'polite' },
      destination === 'execution' ? `${scene.task}进入${scene.execution}，正在处理。`
        : destination === 'waiting' ? `${scene.task}进入${scene.waiting}，还没有开始处理。`
          : '切换上方状态，再放入一个任务。点区域可以看解释。'),
    h('div', { className: 'la-demo-actions' },
      h('button', { type: 'button', className: 'la-demo-primary', disabled: disabled || placed, onClick: place }, placed ? '任务已放入' : '放入一个任务'),
      h('button', { type: 'button', disabled: disabled || !placed, onClick: () => {
        if (disabled || !placed) return
        setPlaced(false)
        emit({ type: 'reset', mode })
      } }, '重新试一次'),
      h('button', { type: 'button', onClick: () => emit({ type: 'return' }) }, '回到题目')))
}

export const TASK_DEMO_CSS = `
.la-task-demo{font:13px/1.65 system-ui,sans-serif;color:var(--la-ink,#24382d);text-align:left}
.la-task-demo *{box-sizing:border-box}.la-demo-head{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.la-demo-head h4{margin:0;font-size:16px;letter-spacing:-.02em}.la-demo-tag{font-size:10px;color:var(--la-accent,#34674e);background:var(--la-paper,#fff);border:1px solid var(--la-line,#d4dfd6);border-radius:20px;padding:3px 9px}
.la-demo-scope{font-size:11px;color:var(--la-muted,#63786b);margin:9px 0 15px}.la-demo-modes,.la-demo-actions{display:flex;gap:8px;flex-wrap:wrap}.la-task-demo button{font:inherit;color:inherit;cursor:pointer;border:1px solid var(--la-line,#d4dfd6);background:var(--la-paper,#fff);border-radius:9px;padding:8px 12px;min-height:38px;touch-action:manipulation}.la-task-demo button:focus-visible{outline:2px solid var(--la-accent,#34674e);outline-offset:3px}.la-task-demo button:disabled{cursor:default;opacity:.55}.la-demo-modes button{font-size:11px}.la-demo-modes button[aria-pressed=true]{border-color:var(--la-accent,#34674e);background:var(--la-soft,#eff5ef);color:var(--la-accent,#34674e)}
.la-demo-board{display:grid;grid-template-columns:minmax(75px,.7fr) minmax(0,3fr);gap:16px;align-items:center;margin:16px 0}.la-demo-entry{text-align:center;color:var(--la-muted,#63786b);font-size:10px}.la-demo-incoming{display:grid;place-items:center;min-height:76px}.la-demo-zones{display:grid;gap:10px}.la-task-demo .la-demo-zone{text-align:left;padding:12px 14px;min-width:0;border-style:dashed}.la-task-demo .la-demo-zone[data-received=true]{border-style:solid;border-color:var(--la-accent,#34674e);background:var(--la-soft,#eff5ef)}.la-demo-zone-title{display:flex;justify-content:space-between;gap:8px;margin-bottom:8px;font-size:12px;font-weight:600}.la-demo-zone-title small{font-size:10px;font-weight:400;color:var(--la-muted,#63786b)}.la-demo-slots{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.la-demo-token,.la-demo-slot{display:grid;place-items:center;min-height:40px;padding:6px 9px;border-radius:8px;font-size:11px;overflow-wrap:anywhere}.la-demo-token{background:var(--la-line,#e1e8e2);border:1px solid transparent}.la-demo-token[data-new=true]{background:var(--la-accent,#34674e);color:var(--la-paper,#fff);box-shadow:0 3px 7px #162f1d12}.la-demo-slot{border:1px dashed var(--la-line,#cfdad1);color:var(--la-muted,#63786b)}.la-demo-empty{color:var(--la-muted,#63786b)}.la-demo-explain{margin:0;font-size:12px;line-height:1.8;min-height:44px}.la-demo-result{margin:12px 0 16px;padding:11px 13px;border-radius:9px;background:var(--la-paper,#fff);font-size:12px;color:var(--la-accent,#34674e)}.la-demo-actions{align-items:center}.la-demo-actions button{font-size:11px}.la-demo-actions .la-demo-primary{background:var(--la-accent,#34674e);color:var(--la-paper,#fff);border-color:transparent}
@media(hover:hover) and (pointer:fine){.la-task-demo button:hover:not(:disabled){border-color:var(--la-accent,#34674e)}}
@media(prefers-reduced-motion:no-preference){.la-task-demo button{transition:border-color 150ms ease,background-color 150ms ease}.la-task-demo button:active:not(:disabled){transform:scale(.98)}}
@container learning (max-width:420px){.la-demo-board{gap:9px;grid-template-columns:70px minmax(0,1fr)}.la-task-demo .la-demo-zone{padding:10px}.la-demo-slots{gap:5px}}
`
