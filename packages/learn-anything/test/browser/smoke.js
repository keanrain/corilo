import * as React from 'react'
import * as jsx from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import { createRoot } from 'react-dom/client'
import { PLAY_EXAMPLES } from '../../src/quiz/examples.js'
import { quizAnswerDisplay } from '../../src/quiz/answer.js'
const h = React.createElement
let plugin
window.__ModuleLoader__ = { load: ({ factory }) => { plugin = factory(name => ({ react: React, 'react/jsx-runtime': jsx, 'react-dom': ReactDOM })[name]) } }
await import('../../src/client/index.js')
const slots = new Map()
const original = { options: { key: 'assistant-step' }, component: ({ node }) => h('div', { style: { whiteSpace: 'pre-wrap' } }, node.data.blocks.filter(b => b.kind === 'text').map(b => b.text).join('\n')) }
const ctx = { inject(names, fn) { if (names.includes('sidebarRight')) fn(ctx) }, effect: fn => fn(), sidebarRightTabs: { register() {} }, uiConversation: { events: { register() {} } }, slots: { entries: () => [original], inject: (_, fn) => fn(), register: ({ name, key = '' }, component) => slots.set(`${name}:${key}`, component) } }; plugin.apply(ctx)
const sources = ['m-smoke#1', 'm-smoke#2']
const sessionKey = 'learn-anything:smoke-session-v2'
const modes = [['base', '原有五类卡片'], ['flash', '翻面闪卡'], ['spot', '找茬修复'], ['order', '步骤排序'], ['retry', '错题重赛'], ...PLAY_EXAMPLES.map(item => [item.id, item.title])]
let saved
try { saved = JSON.parse(sessionStorage.getItem(sessionKey)) } catch {}
let seq = 10, revision = 0, fail = false, enqueue = false, transport = '', input = { phase: 'plain', draft: '', attachmentIds: [], queue: [] }
let mode = saved?.mode ?? 'base'
let selectedId = null, navigationRevision = 0, learningOpen = true
const openLearning = (_sessionId, id) => { selectedId = id; navigationRevision++; learningOpen = true; publish() }
const listeners = new Set()
const oldQuestion = '小型 API 服务的核心线程都忙，队列还有空位，新请求会先排队还是扩容？'
const oldAnswer = '立即扩容，因为核心线程都忙了。'
const newQuestion = '图片处理服务的 2 个核心线程都在工作，等待队列已经满了，但线程数尚未达到上限。又来一张图片，系统会怎样处理？'
const quiz = (id, title, kind = 'base') => {
 const body = kind === 'spot'
  ? 'Scene("某服务的线程池：核心线程都忙，队列尚未满。下面是同事写的任务流转说明。"), SpotError("找出一处关键错误，并修正", ["新任务到达线程池。", "核心线程都忙时，无论队列状态如何都立即扩容。", "任务完成后，工作线程可以继续处理后续任务。"], "用你自己的话改正这行说明")'
  : kind === 'order'
   ? 'Scene("线程池已确定采用一个新线程处理刚收到的任务。只考虑题面列出的处理步骤。"), OrderSteps("按这个任务实际经过的先后顺序排列", ["执行任务代码", "接收任务", "任务执行结束", "启动处理该任务的线程"]), Reason("为什么这样排？")'
   : kind === 'retry'
    ? `Scene(${JSON.stringify(newQuestion)}), Choice("新图片任务去哪里？", ["创建额外线程处理", "继续进入已满队列", "一定立即拒绝"]), Reason("这次你会检查哪些条件？")`
    : 'Scene("4 个核心线程都忙，队列还有空位，新任务来了。"), Choice("任务去向", ["进入队列", "立即扩容"]), Reason("你的判断依据")'
 return { view: 'quiz', id, title, question: kind === 'retry' ? newQuestion : title, sources, helpDemo: 'execution-waiting', ui: `root = Quiz(${JSON.stringify(title)}, "${kind === 'spot' ? 'scenario' : 'predict'}", [${body}], 2)`, ...(kind === 'retry' ? { retry: { id: 'v-smoke-old', question: oldQuestion, answer: oldAnswer, kpId: 'pool', modelId: 'map' } } : {}) }
}
const flashcard = id => ({ view: 'flashcard', id, kp: { id: 'http-status', title: 'HTTP 状态码' }, fact: { id: 'fact-404', prompt: 'HTTP 404 状态码表示什么？', answer: '服务器找不到所请求的资源。' }, sources: [sources[0]] })
const originalViews = [
 { view: 'outline', goal: '理解线程池任务流转', status: 'active', chapters: [{ id: 'concurrency', title: '并发基础', kps: [{ id: 'pool', title: '线程池', kind: 'knowledge', phase: 'verify', mastery: 'novice', prerequisites: [] }] }], resources: [] },
 { view: 'target-map', kp: { id: 'pool', title: '线程池任务流转', kind: 'knowledge', phase: 'verify' }, sources, models: [{ id: 'map', type: 'associative', phase: 'verify', mastery: 'novice', input: '核心线程忙，队列未满', output: '任务进入队列', statement: '先排队；队列满了再考虑扩容。', examples: [{ id: 'e1', tag: 'e', input: '4 个核心线程都忙，队列还有空位', output: '进入队列等待', origin: 'material', checked: true, sources: [sources[0]] }], verifications: [] }] },
 { view: 'progress', goal: '理解线程池任务流转', total: 3, due: 0, counts: { none: 1, novice: 1, proficient: 1 }, weak: [] },
 quiz('q-smoke-1', '任务流转挑战'),
 { view: 'feedback', id: 'feedback-demo', kp: { title: '线程池' }, verdict: 'correct', level: { from: 'none', to: 'novice' }, explainedRule: true, sources },
]
const entries = saved?.entries ?? originalViews.map((view, i) => ({ seq: i + 1, callId: `demo-${i + 1}`, view, mode: 'base' }))
for (const entry of entries) entry.callId ??= `demo-${entry.seq}`
const turn = { end: { seq: 10 }, data: new Map([['learn-anything', { views: entries }]]) }
const nodes = saved?.nodes ?? []
seq = Math.max(seq, ...nodes.map(n => n.seq), ...entries.map(v => v.seq)) + 1
turn.end.seq = seq
const snapshot = { views: new Map([['chat', { timeline: { turns: new Map([[1, turn]]) }, legacy: { nodes } }]]) }
const save = () => sessionStorage.setItem(sessionKey, JSON.stringify({ entries, nodes, mode }))
const publish = () => { revision++; listeners.forEach(fn => fn()) }
const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }
const useInput = select => { React.useSyncExternalStore(subscribe, () => revision); return select(input) }
const useConversation = select => { React.useSyncExternalStore(subscribe, () => revision); return select(snapshot) }
const addView = view => { entries.push({ seq: ++seq, callId: `demo-${seq}`, view, mode }); turn.end.seq = ++seq }
const addChallenge = () => {
 const example = PLAY_EXAMPLES.find(item => item.id === mode)
 if (example) return addView({ ...example.view, id: `q-smoke-${mode}-${seq}`, sources })
 return addView(mode === 'flash' ? flashcard(`f-smoke-${seq}`) : quiz(`q-smoke-${seq}`, { base: '下一道挑战', spot: '检查同事的任务流转说明', order: '排列任务生命周期', retry: '换个场景，再试一次' }[mode], mode))
}
const clearDrafts = () => {
 for (const key of Object.keys(localStorage)) if (key.startsWith('learn-anything:quiz:q-smoke') || key.startsWith('learn-anything:flashcard:f-smoke')) localStorage.removeItem(key)
}
function receive(text) {
  nodes.push({ kind: 'user', seq: ++seq, content: [{ type: 'text', text }] })
  if (mode === 'retry' && text.startsWith('【作答】')) addView({ view: 'feedback', id: `feedback-smoke-${seq}`, kp: { title: '线程池' }, verdict: 'correct', level: { from: 'none', to: 'novice' }, explainedRule: true, sources, retry: { id: 'v-smoke-old', question: oldQuestion, answer: oldAnswer, currentQuestion: newQuestion, currentAnswer: quizAnswerDisplay(text) } })
  input = { ...input, draft: '' }; transport = mode === 'retry' ? '测试消息已写入；下方为固定判定的对照演示，不调用模型。' : '实际用户消息已写入测试会话'; save(); publish()
}
const inputActions = {
 setDraft(text) { input = { ...input, draft: text }; publish() },
 submit() {
  if (fail) {
   fail = false; input = { ...input, phase: 'sending' }; publish()
   setTimeout(() => { input = { ...input, phase: 'plain' }; transport = '模拟异步发送失败：答案保留，可以再次提交。'; publish() }, 150)
   return
  }
  const text = input.draft
  if (enqueue) {
   enqueue = false; input = { ...input, draft: '', queue: [...input.queue, { id: `queued-${++seq}`, content: [{ type: 'text', text }] }] }
   transport = '宿主已接收，等待处理；尚未写入真实用户消息。'; publish(); return
  }
  receive(text)
 },
}
function App() {
 React.useSyncExternalStore(subscribe, () => revision)
 const Card = slots.get('conversation.chat.node:learn-anything-card')
 const Answer = slots.get('conversation.chat.node:assistant-step')
 const Learning = slots.get('sidebar.right.pane.tab:@corilo/learn-anything/learning')
 const sessionProps = { useInput, useConversation, inputActions, useSession: select => select({ sessionId: 'smoke' }) }
 return h(React.Fragment, null,
  h('nav', { 'aria-label': '卡片演示' }, modes.map(([key, label]) => h('button', { key, 'aria-pressed': mode === key, onClick() {
   mode = key; input = { ...input, draft: '' }; transport = ''; if (!entries.some(entry => entry.mode === mode)) addChallenge(); openLearning('smoke', entries.findLast(entry => entry.mode === mode && ['quiz', 'flashcard'].includes(entry.view.view))?.view.id); save(); publish()
  } }, label))),
  h('p', { className: 'demo-note' }, mode === 'flash' ? '先选把握再翻面；自评不增加掌握度。用「展示下一张闪卡」模拟稍后重现。' : mode === 'retry' ? '同一学习目标的新情境；提交后展示旧、新回答对照。此页的判定固定为答对，仅验证界面。' : '所有卡片使用真实插件组件。可模拟断线、提交重试和清除缓存后的历史恢复。'),
  h('nav', { 'aria-label': '测试控制' },
   h('button', { onClick() { fail = true; transport = '下一次提交将模拟断线'; publish() } }, '模拟下次发送失败'),
   h('button', { onClick() { enqueue = true; transport = '下一次提交将停留在宿主队列'; publish() } }, '模拟下次排队'),
   h('button', { disabled: !input.queue.length, onClick() { const queue = input.queue; input = { ...input, queue: [] }; for (const item of queue) receive(item.content[0].text) } }, '处理队列'),
   h('button', { disabled: !input.queue.length, onClick() { input = { ...input, queue: [] }; transport = '已撤销排队消息，题卡仍可作答。'; publish() } }, '撤销队列'),
   h('button', { onClick() { addChallenge(); save(); publish() } }, mode === 'flash' ? '展示下一张闪卡' : '展示下一题'),
   h('button', { onClick() { clearDrafts(); location.reload() } }, '清除卡片缓存并重载'),
   h('button', { onClick() { sessionStorage.removeItem(sessionKey); clearDrafts(); location.reload() } }, '重置测试')),
  h('p', { id: 'transport', role: 'status' }, transport),
  h('label', null, '测试输入框', h('textarea', {
   'aria-label': '测试输入框', value: input.draft,
   onChange(event) { input = { ...input, draft: event.target.value }; publish() },
  })),
  h('nav', { 'aria-label': '输入状态模拟' },
   h('button', { onClick() { input = { ...input, attachmentIds: input.attachmentIds.length ? [] : ['test-attachment'] }; publish() } }, input.attachmentIds.length ? '移除测试附件' : '添加测试附件'),
   h('button', { onClick() { input = { ...input, phase: input.phase === 'plain' ? 'submitting' : 'plain' }; publish() } }, input.phase === 'plain' ? '模拟发送中' : '结束发送模拟')),
  h('div', { className: 'smoke-layout' },
   h('section', { 'aria-label': '最终回答与练习入口' },
    h(Answer, { ...sessionProps, useTurnData: key => turn.data.get(key), turnProcess: { spec: { answerStep: 1 } },
     node: { data: { step: 1, status: 'settled', blocks: [{ kind: 'text', text: entries.filter(entry => entry.mode === mode && !['quiz', 'flashcard'].includes(entry.view.view)).map(entry => `讲解段落 · ${entry.seq}\n\n[卡片](learn-card:${entry.callId ?? `demo-${entry.seq}`})`).join('\n\n') + '\n\n继续结合上面的卡片理解。' }] } } }),
    entries.filter(entry => entry.mode === mode && ['quiz', 'flashcard'].includes(entry.view.view)).map(entry =>
     h(Card, { key: entry.seq, ...sessionProps, node: { data: { view: entry.view, isStreaming: false } }, openLearning, autoOpenLearning() {} }))),
   h('aside', { 'aria-label': '持续练习' },
    h('button', { onClick() { learningOpen = !learningOpen; publish() } }, learningOpen ? '收起学习区' : '继续练习'),
    learningOpen ? h(Learning, { ...sessionProps, useTabInfo: () => ({ tab: { navigation: { revision: navigationRevision, params: selectedId ? { id: selectedId } : {} } } }) }) : null)),
  h('details', null, h('summary', null, '查看已发送测试消息'), h('pre', { 'aria-label': '已发送消息' }, nodes.map(n => n.content[0].text).join('\n\n'))))
}
createRoot(document.getElementById('root')).render(h(App))
