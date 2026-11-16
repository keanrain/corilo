import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { TaskDemo, TASK_DEMO_SCENE, TASK_DEMO_CSS } from '../../src/client/task-demo.js'

const h = React.createElement
const style = document.createElement('style')
style.textContent = TASK_DEMO_CSS + `
body{margin:0;background:#f2f5ef;color:#24382d;font:14px/1.7 system-ui,sans-serif}main{max-width:760px;margin:40px auto;padding:0 20px}h1{font-size:23px;letter-spacing:-.03em;margin:0 0 8px}.demo-lead{color:#63786b;font-size:12px}.demo-card{margin:24px 0;padding:24px;border:1px solid #d4dfd6;border-radius:18px;background:white;box-shadow:0 6px 30px #223f2c08}.demo-toolbar{display:flex;gap:12px;align-items:center;font-size:12px}.demo-toolbar button{font:inherit;border:1px solid #cfdad1;border-radius:8px;background:white;padding:8px 12px;cursor:pointer}.demo-log{font:11px/1.7 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;color:#63786b}.demo-back{font-size:12px;color:#34674e}button:focus-visible,a:focus-visible{outline:2px solid #34674e;outline-offset:3px}
`
document.head.append(style)
const models = {
  thermostat: {
    kind: 'state-machine', title: '温控观察', scope: '固定阈值，不模拟热惯性', initial: 'off',
    inputs: [{ id: 'temperature', label: '温度', type: 'number', min: 0, max: 40, step: 1, initial: 22 }],
    states: [{ id: 'off', label: '关闭', output: '不加热' }, { id: 'on', label: '开启', output: '加热中' }],
    transitions: [
      { from: 'off', to: 'on', label: '低于20度', when: [{ input: 'temperature', op: 'lt', value: 20 }] },
      { from: 'on', to: 'off', label: '达到20度', when: [{ input: 'temperature', op: 'gte', value: 20 }] },
    ],
  },
  gate: {
    kind: 'state-machine', title: '逻辑与门', scope: '两个开关都闭合才导通', initial: 'closed',
    inputs: [{ id: 'first', label: '开关一', type: 'toggle', initial: false }, { id: 'second', label: '开关二', type: 'toggle', initial: false }],
    states: [{ id: 'closed', label: '截止', output: '无信号' }, { id: 'open', label: '导通', output: '有信号' }],
    transitions: [{ from: 'closed', to: 'open', label: '全部闭合', when: [{ input: 'first', op: 'eq', value: true }, { input: 'second', op: 'eq', value: true }] }],
  },
}
const model = models[new URLSearchParams(location.search).get('model')] ?? TASK_DEMO_SCENE
function App() {
  const [disabled, setDisabled] = React.useState(false)
  const [events, setEvents] = React.useState([])
  return h('main', null,
    h('h1', null, '先把执行和等待分清'),
    h('p', { className: 'demo-lead' }, '切换状态，放入任务，再点区域看看。这里是操作练习，不判分。'),
    h('div', { className: 'demo-toolbar' },
      h('button', { type: 'button', 'aria-pressed': disabled, onClick: () => setDisabled((value) => !value) }, disabled ? '只读：开' : '只读：关'),
      h('a', { className: 'demo-back', href: '/playground' }, '回到题卡演示')),
    h('div', { className: 'demo-card' }, h(TaskDemo, { config: model, disabled, onAction: (event) => setEvents((previous) => [event, ...previous].slice(0, 8)) })),
    h('p', { role: 'status' }, events[0]?.type === 'return' ? '已记录返回操作。独立页没有原题，可用上方链接回到题卡演示。' : ''),
    h('details', null, h('summary', null, '查看操作事件'), h('pre', { className: 'demo-log', 'aria-label': '操作事件' }, JSON.stringify(events, null, 2))))
}
createRoot(document.getElementById('demo')).render(h(App))
