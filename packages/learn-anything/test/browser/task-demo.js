import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { TaskDemo, TASK_DEMO_SCENE, TASK_DEMO_CSS } from '../../src/client/task-demo.js'

const h = React.createElement
const style = document.createElement('style')
style.textContent = TASK_DEMO_CSS + `
body{margin:0;background:#f2f5ef;color:#24382d;font:14px/1.7 system-ui,sans-serif}main{max-width:760px;margin:40px auto;padding:0 20px}h1{font-size:23px;letter-spacing:-.03em;margin:0 0 8px}.demo-lead{color:#63786b;font-size:12px}.demo-card{margin:24px 0;padding:24px;border:1px solid #d4dfd6;border-radius:18px;background:white;box-shadow:0 6px 30px #223f2c08}.demo-toolbar{display:flex;gap:12px;align-items:center;font-size:12px}.demo-toolbar button{font:inherit;border:1px solid #cfdad1;border-radius:8px;background:white;padding:8px 12px;cursor:pointer}.demo-log{font:11px/1.7 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;color:#63786b}.demo-back{font-size:12px;color:#34674e}button:focus-visible,a:focus-visible{outline:2px solid #34674e;outline-offset:3px}
`
document.head.append(style)
function App() {
  const [disabled, setDisabled] = React.useState(false)
  const [events, setEvents] = React.useState([])
  return h('main', null,
    h('h1', null, '先把执行和等待分清'),
    h('p', { className: 'demo-lead' }, '切换状态，放入任务，再点区域看看。这里是操作练习，不判分。'),
    h('div', { className: 'demo-toolbar' },
      h('button', { type: 'button', 'aria-pressed': disabled, onClick: () => setDisabled((value) => !value) }, disabled ? '只读：开' : '只读：关'),
      h('a', { className: 'demo-back', href: '/playground' }, '回到题卡演示')),
    h('div', { className: 'demo-card' }, h(TaskDemo, { config: TASK_DEMO_SCENE, disabled, onAction: (event) => setEvents((previous) => [event, ...previous].slice(0, 8)) })),
    h('p', { role: 'status' }, events[0]?.type === 'return' ? '已记录返回操作。独立页没有原题，可用上方链接回到题卡演示。' : ''),
    h('details', null, h('summary', null, '查看操作事件'), h('pre', { className: 'demo-log', 'aria-label': '操作事件' }, JSON.stringify(events, null, 2))))
}
createRoot(document.getElementById('demo')).render(h(App))
