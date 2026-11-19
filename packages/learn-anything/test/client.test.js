// Exercise the shipped client through the same slots and view events as dsh.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import * as react from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { marker } from '../src/host/render.js'
import { formatQuizAnswer, parseQuizAction, quizAnswerDisplay, quizHistory } from '../src/quiz/answer.js'
import { playAnswerComplete } from '../src/quiz/play.js'

const require = createRequire(import.meta.url)
const bundle = readFileSync(new URL('../src/client/index.js', import.meta.url), 'utf8')

function client(reactRuntime = react) {
  let plugin, seq = 0
  const original = { options: { key: 'assistant-step' }, component: (props) => react.createElement('native-answer', props) }
  const definitions = [], contexts = new Map(), viewNodes = new Map(), slots = new Map()
  const turn = { turn: 1, status: 'open', data: new Map() }
  const nodes = []
  const snapshot = { views: new Map([['chat', { timeline: { turns: new Map([[1, turn]]) }, legacy: { nodes } }]]) }
  const inputActions = { setDraft() {}, submit() {} }
  let input = { phase: 'plain', draft: '', attachmentIds: [] }
  const useInput = (select) => select(input)
  const useConversation = (select) => select(snapshot)
  const storage = new Map(), opened = []
  let expanded = false, openTabs = []
  const sidebarRight = {
    mounted: { getSnapshot: () => 'session-1' }, openTabs: { getSnapshot: () => openTabs },
    isExpanded: () => expanded,
    focus: (id) => opened.push(['focus', id]),
    openTab: (kind, options) => { expanded = true; openTabs = [{ sessionId: 'session-1', tabId: 'learning-tab', kind }]; opened.push([kind, options]) },
  }
  const runtime = { ...reactRuntime, useSyncExternalStore: (_subscribe, snapshot) => snapshot(), useEffect: () => {},
    useMemo: reactRuntime.useMemo === react.useMemo ? (fn) => fn() : reactRuntime.useMemo,
    useState: reactRuntime.useState === react.useState ? (initial) => [typeof initial === 'function' ? initial() : initial, () => {}] : reactRuntime.useState }
  runInNewContext(bundle, {
    window: { __ModuleLoader__: { load: ({ factory }) => { plugin = factory((name) => name === 'react' ? runtime : require(name)) } } },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  })
  let injected
  const ctx = {
    inject(names, fn) { if (names.includes('sidebarRight')) fn(ctx) },
    effect: (fn) => fn(), sidebarRight, sidebarRightTabs: { register() {} },
    uiConversation: { events: { register: (value) => definitions.push(value) } },
    slots: { entries: () => [original], inject: (_name, fn) => fn(), register: ({ name, key = '', inject }, component) => { if (inject) injected = inject(); slots.set(`${name}:${key}`, component) } },
  }
  plugin.apply(ctx)
  const props = { useConversation, useInput, inputActions, useSession: (select) => select({ sessionId: 'session-1' }) }
  const emit = (type, data = {}) => {
    const event = { type, seq: ++seq, time: Date.now(), surfaceOp: 'append', data: { turn: 1, ...data } }
    if (type === 'turn/end') { turn.end = event; turn.status = 'closed' }
    if (type === 'user/message') nodes.push({ kind: 'user', seq: event.seq, ...data })
    for (const definition of definitions) {
      const match = definition.match(event)
      if (!match) continue
      const key = `${definition.kind}:${match.id}`
      let context = contexts.get(key)
      if (!context && match.role !== 'start') continue
      const full = { ...match, event, location: { kind: 'turn', turn } }
      if (!context) { context = { key, id: match.id, start: full, matches: [], state: undefined, current: new Map() }; context.state = definition.start(context, full); contexts.set(key, context) }
      else context.state = definition.update(context, full)
      context.matches.push(full)
      const value = definition.buildLocationData?.(context, 'turn', null)
      if (value) turn.data.set(value.key, value.value)
      const node = definition.buildViewNode?.(context)
      if (definition.buildViewNode && context.current.get('chat') && !node) throw new Error('materialized chat target must become hidden, not be withdrawn')
      if (node) context.current.set('chat', node)
      if (node) viewNodes.set(key, node)
      else viewNodes.delete(key)
    }
    return event
  }
  const inline = (callId) => {
    const node = viewNodes.get(`learn-anything-card:${callId}`)
    return node && node.visibility !== 'hidden' ? slots.get('conversation.chat.node:learn-anything-card')({ ...props, ...injected, node }) : null
  }
  const workspace = (id, extra = {}) => slots.get('sidebar.right.pane.tab:@corilo/learn-anything/learning')({ ...props, ...extra,
    useTabInfo: () => ({ tab: { navigation: { revision: 1, params: id ? { id } : {} } } }) })
  const answer = (text, overrides = {}) => slots.get('conversation.chat.node:assistant-step')({ ...props,
    node: { kind: 'assistant-step', location: { kind: 'turn', turn }, data: { step: 3, status: 'settled', blocks: [{ kind: 'text', text }] } },
    useTurnData: (key) => turn.data.get(key), turnProcess: { spec: { answerStep: 3 } }, ...overrides })
  emit('turn/start')
  return {
    emit, inputActions, useInput, storage, opened, inline, answer, workspace, viewNodes, slots, snapshot,
    sidebar: (value) => { expanded = value },
    setInput: (next) => { input = { ...input, ...next } },
    row: (name, block) => slots.get(`tool.call.toolview:${name}`)({ ...props, callId: block.callId, block }),
    result(name, view, { isError = false, text = view ? marker(view) : '已更新' } = {}) {
      const callId = `call-${seq}`
      emit('tool/call', { name, callId })
      const message = { source: { callId }, content: [{ type: 'text', text }], isError }
      emit('tool/result', { message })
      const read = () => view?.view === 'quiz' || view?.view === 'flashcard' ? inline(callId) && workspace(view.id) : answer(`[卡片](learn-card:${encodeURIComponent(callId)})`)
      read.callId = callId
      return read
    },
    tail: () => null,
  }
}

function cards(element) {
  if (!element || typeof element !== 'object') return []
  if (Array.isArray(element)) return element.flatMap(cards)
  return element.props?.view ? [element] : cards(element.props?.children)
}

function elements(element) {
  if (!element || typeof element !== 'object') return []
  if (Array.isArray(element)) return element.flatMap(elements)
  return [element, ...elements(element.props?.children)]
}

test('progress review respects composer state and sends the existing review prompt', () => {
  const app = client()
  const row = app.result('progress_get', { view: 'progress', goal: 'Java', due: 3, total: 8, counts: { proficient: 2, expert: 1 } })
  const card = cards(row())[0]
  const actions = []
  const inputActions = { setDraft: (text) => actions.push(text), submit: () => actions.push('submit') }
  const render = (input, overrides = {}) => elements(card.type({ ...card.props, useInput: (select) => select(input), inputActions, ...overrides }))
  const plain = { phase: 'plain', draft: '', attachmentIds: [] }
  const ready = render(plain)
  assert.equal(ready.find((element) => element.props.role === 'img').props['aria-label'], '已掌握 38%，3/8 个知识点')
  const button = ready.find((element) => element.type === 'button')
  assert.equal(button.props.disabled, false)
  button.props.onClick()
  assert.deepEqual(actions, ['开始今日复习', 'submit'])
  for (const input of [{ ...plain, draft: '不要覆盖' }, { ...plain, attachmentIds: ['file-1'] }, { ...plain, phase: 'busy' }]) {
    assert.equal(render(input).find((element) => element.type === 'button').props.disabled, true)
  }
  assert.equal(render(plain, { inputActions: undefined }).find((element) => element.type === 'button').props.disabled, true)
  assert.equal(render(plain, { view: { ...card.props.view, due: 0 } }).some((element) => element.type === 'button'), false)
})

const cases = [
  ['course_save', { view: 'outline', goal: '学习路线', status: 'planning', chapters: [] }],
  ['course_get', { view: 'outline', goal: '学习路线', status: 'planning', chapters: [] }],
  ['kp_get', { view: 'target-map', kp: { id: 'kp-1' }, models: [] }],
  ['target_map_update', { view: 'target-map', kp: { id: 'kp-1' }, models: [] }],
  ['progress_get', { view: 'progress', goal: '学习进度' }],
  ['flashcard_show', { view: 'flashcard', id: 'flash-1', kp: { id: 'kp-1', title: '概念' }, fact: { id: 'fact-1', prompt: '回忆概念', answer: '概念内容' }, sources: [] }],
  ['quiz_show', { view: 'quiz', id: 'quiz-1', ui: 'root = Quiz("题目", "scenario", [Reason("为什么？")])' }],
  ['verification_record', { view: 'feedback', id: 'answer-1', verdict: 'correct' }],
]

for (const [tool, view] of cases) {
  test(`${tool}: read-only cards render in the final answer while tasks use the sidebar`, () => {
    const app = client()
    const read = app.result(tool, view)
    const task = view.view === 'quiz' || view.view === 'flashcard'
    assert.equal(cards(app.inline(read.callId)).length, 0)
    if (task) {
      assert.equal(app.inline(read.callId).type, 'button')
      assert.equal(app.viewNodes.get(`learn-anything-card:${read.callId}`).groupTree, 'turn')
    }
    assert.equal(cards(read()).length, 1)
    app.emit('turn/end')
    assert.equal(cards(app.inline(read.callId)).length, 0)
    assert.equal(cards(read()).length, 1)
    assert.equal(app.tail(), null)
    assert.equal(app.slots.has('conversation.chat.turnTail:'), false)
  })
}

test('read-only tool results stay out of the execution process', () => {
  const app = client()
  const read = app.result('course_get', { view: 'outline', goal: '路线', chapters: [] })
  assert.equal(app.inline(read.callId), null)
})

test('final response references determine card order, with native Markdown around them', () => {
  const app = client()
  const first = app.result('course_save', { view: 'outline', goal: '第一版' })
  const second = app.result('course_get', { view: 'outline', goal: '修订版' })
  app.emit('turn/end')
  assert.equal(app.viewNodes.size, 0, 'read-only views create no process nodes')
  const text = `先看修订版。\n\n[修订版](learn-card:${second.callId})\n\n然后对比原版。\n\n[原版](learn-card:${first.callId})\n\n最后继续说明。`
  const output = app.answer(text)
  assert.deepEqual(Array.from(cards(output), (card) => card.props.view.goal), ['修订版', '第一版'])
  const segments = output.props.children
  assert.equal(segments.length, 5)
  assert.match(segments[0].props.node.data.blocks[0].text, /先看修订版/)
  assert.match(segments[2].props.node.data.blocks[0].text, /然后对比原版/)
  assert.match(segments[4].props.node.data.blocks[0].text, /最后继续说明/)
  assert.equal(cards(app.answer(text, { groupPart: 'reasoning' })).length, 0)
  assert.equal(cards(app.answer(text, { turnProcess: { spec: { answerStep: 4 } } })).length, 0)
  assert.equal(cards(app.answer(text, { turnProcess: undefined })).length, 0)
  const streaming = app.answer(`[路线](learn-card:${first.callId})`, {
    node: { data: { step: 3, status: 'running', blocks: [{ kind: 'text', text: `[路线](learn-card:${first.callId})` }] } },
  })
  assert.equal(cards(streaming).length, 1, 'a confirmed card can appear before the final reply finishes streaming')
  assert.equal(streaming.props.children.length, 1, 'a trailing reference adds no empty paragraph')
})

test('streaming quiz stays in the sidebar until validated and never duplicates in chat', () => {
  const app = client()
  const callId = 'quiz-live'
  app.emit('assistant/live-chunk', { chunk: { type: 'tool-call-delta', id: callId, name: 'quiz_show', argumentsDelta: '{"ui":"root = Quiz(\\"排队' } })
  assert.equal(cards(app.inline(callId)).length, 0)
  let card = cards(app.workspace())[0]
  assert.equal(card.props.isStreaming, true)
  assert.equal(card.props.view.ui, 'root = Quiz("排队')
  const firstKey = card.key
  app.emit('assistant/live-chunk', { chunk: { type: 'tool-call-delta', id: callId, argumentsDelta: '问题' } })
  card = cards(app.workspace())[0]
  assert.equal(card.key, firstKey)
  assert.match(card.props.view.ui, /排队问题$/)
  app.emit('turn/end')
  assert.equal(app.inline(callId), null)
  assert.equal(cards(app.workspace()).length, 0)
})

test('a reply waiting for a user question renders its read-only references in the response', () => {
  const app = client()
  const target = app.result('kp_get', { view: 'target-map', kp: { id: 'pool' }, models: [] })
  const progress = app.result('progress_get', { view: 'progress', goal: '课程' })
  const text = `现在的状态：\n\n[知识靶图](learn-card:${target.callId})\n\n[学习进度](learn-card:${progress.callId})\n\n接下来先做哪个？`
  const question = { kind: 'tool-call', name: 'ask_user_question', callId: 'ask-1' }
  const node = { data: { step: 3, status: 'settled', blocks: [{ kind: 'text', text }, question] } }
  const props = { node, groupPart: 'response', turnProcess: { spec: { answerStep: null } } }
  const response = app.answer(text, props)
  assert.deepEqual(Array.from(cards(response), (card) => card.props.view.view), ['target-map', 'progress'])
  assert.equal(response.props.children.at(-1).props.node.data.blocks.at(-1), question, 'native question rendering is preserved')
  assert.equal(cards(app.answer(text, { ...props, groupPart: 'reasoning' })).length, 0)
  for (const calls of [[{ ...question, name: 'kp_get' }], [question, { ...question, name: 'progress_get' }]]) {
    assert.equal(cards(app.answer(text, { ...props, node: { data: { ...node.data, blocks: [{ kind: 'text', text }, ...calls] } } })).length, 0, 'ordinary tool execution remains outside the answer renderer')
  }
})

test('outline tool arguments never render process cards; only confirmed results can be referenced', () => {
  const app = client()
  const callId = 'outline-live'
  app.emit('assistant/live-chunk', { chunk: { type: 'tool-call-delta', id: callId, name: 'course_save', argumentsDelta: '{"goal":"Java","chapters":[{"title":"线程' } })
  assert.equal(app.inline(callId), null)
  const ref = `[路线](learn-card:${callId})`
  assert.equal(cards(app.answer(ref)).length, 0)
  app.emit('tool/call', { name: 'course_save', callId, arguments: '{"goal":"Java","chapters":[]}' })
  app.emit('tool/result', { message: { source: { callId }, isError: true, content: [{ type: 'text', text: 'invalid' }] } })
  assert.equal(cards(app.answer(ref)).length, 0)
  assert.equal(cards(app.workspace()).length, 0)
  const read = app.result('course_save', { view: 'outline', goal: '完整路线', chapters: [], status: 'planning' })
  assert.equal(cards(read())[0].props.view.goal, '完整路线')
})

test('the sidebar streaming preview keeps the actual OpenUI renderer locked', () => {
  const app = client({ ...react, useMemo: (fn) => fn(), useCallback: (fn) => fn,
    useRef: (current) => ({ current }), useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}] })
  app.emit('tool/call', { name: 'quiz_show', callId: 'readonly', arguments: JSON.stringify({ ui: 'root = Quiz("生' }) })
  const card = cards(app.workspace())[0]
  const exercise = card.type(card.props)
  const provider = exercise.type(exercise.props).props.children
  assert.equal(provider.props.value.locked, true)
  assert.equal(provider.props.value.canSend, false)
  const renderer = provider.props.children.find((child) => child?.props?.response)
  assert.equal(renderer.props.isStreaming, true)
  renderer.props.onParseResult({ root: null })
})

test('task entries reopen the one learning tab without overwriting composer contents', () => {
  const app = client()
  const read = app.result('quiz_show', cases.find(([name]) => name === 'quiz_show')[1])
  app.setInput({ draft: '我的追问' })
  const entry = app.inline(read.callId)
  entry.props.onClick()
  entry.props.onClick()
  assert.deepEqual(JSON.parse(JSON.stringify(app.opened)), [
    ['learn-anything', { params: { id: 'quiz-1' } }], ['focus', 'learning-tab'], ['learn-anything', { params: { id: 'quiz-1' } }],
  ])
  assert.equal(cards(app.workspace())[0].props.useInput((input) => input.draft), '我的追问')
})

test('loading an older Turn after the current one does not replace the sidebar task', () => {
  const app = client()
  app.result('quiz_show', { view: 'quiz', id: 'newest', ui: 'root = Quiz("当前题", "predict", [Reason("为什么？")])' })
  app.snapshot.views.get('chat').timeline.turns.set(0, { end: { seq: 0 }, data: new Map([['learn-anything', { views: [{ seq: 0, view: { view: 'quiz', id: 'older' } }] }]]) })
  assert.equal(cards(app.workspace())[0].props.view.id, 'newest')
})

test('errors, malformed views and updates without show do not create artifacts', () => {
  const app = client()
  assert.equal(cards(app.result('course_save', cases[0][1], { isError: true })()).length, 0)
  assert.equal(cards(app.result('course_get', null, { text: '<!-- learn-anything:view {broken} -->' })()).length, 0)
  assert.equal(cards(app.result('target_map_update', null)()).length, 0)
  app.emit('turn/end')
  assert.equal(app.viewNodes.size, 0)
})

test('a failed streaming quiz hides its materialized chat entry without withdrawing the native node', () => {
  const app = client()
  app.emit('tool/call', { name: 'quiz_show', callId: 'failed-preview', arguments: JSON.stringify({
    ui: 'root = Quiz("失败题", "predict", [Reason("为什么？")])',
  }) })
  const key = 'learn-anything-card:failed-preview'
  const previous = app.viewNodes.get(key)
  assert.equal(previous.visibility, 'visible')
  app.emit('tool/result', { message: { source: { callId: 'failed-preview' }, isError: true, content: [{ type: 'text', text: 'invalid quiz' }] } })
  assert.equal(app.viewNodes.get(key).key, previous.key)
  assert.equal(app.viewNodes.get(key).visibility, 'hidden')
  assert.equal(app.inline('failed-preview'), null)
  app.emit('turn/end')
  assert.equal(cards(app.workspace()).length, 0)
})

test('an unfinished sidebar quiz keeps answers, confidence and hints when remounted', () => {
  // Mount the actual QuizCard twice; hooks supply initial state, as on a fresh mount.
  const app = client({
    ...react,
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useRef: (current) => ({ current }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  })
  const row = app.result('quiz_show', { ...cases.find(([tool]) => tool === 'quiz_show')[1], sources: ['m-book#2'] })
  const controls = quizControls
  const inline = controls(cards(row())[0])
  inline.set('选择', '进入队列')
  inline.set('理由', '核心线程忙时先排队')
  inline.setConfidence('sure')
  let hint
  app.inputActions.setDraft = (text) => { hint = text }
  inline.hint('线程池')
  app.emit('user/message', { content: [{ type: 'text', text: hint }] })
  app.emit('turn/end')
  const tail = controls(cards(app.workspace())[0])
  assert.equal(tail.answers['选择'], '进入队列')
  assert.equal(tail.answers['理由'], '核心线程忙时先排队')
  assert.equal(tail.confidence, 'sure')
  assert.equal(tail.hints, 1)
  assert.equal(tail.locked, false, 'a saved draft is not a submitted answer')
  let sent
  app.inputActions.setDraft = (text) => { sent = text }
  tail.submit('线程池')
  assert.match(sent, /教材依据：m-book#2/, 'the examiner receives the same sources with the answer')
})

const quizHooks = {
  ...react,
  useMemo: (fn) => fn(), useCallback: (fn) => fn,
  useRef: (current) => ({ current }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
}
// Adapter tests drive the public Exercise callbacks; field completeness is checked
// separately by the real component interactions and pure play rules.
function quizControls(element) {
  const exercise = element.type(element.props)
  const context = exercise.type(exercise.props).props.children.props.value
  let answers = exercise.props.answers
  return {
    ...context,
    set(key, value) {
      answers = { ...answers, [key]: value }
      exercise.props.onChange(answers)
    },
    submit(title) {
      exercise.props.onAction({ type: 'submit', title,
        answers: Object.entries(answers).map(([prompt, value]) => ({ prompt, value })),
        confidence: exercise.props.confidence,
      })
    },
  }
}
const quizFixture = { view: 'quiz', id: 'retry-quiz', ui: 'root = Quiz("重试", "scenario", [Reason("理由")])' }

test('host-accepted queued quiz actions cannot be sent twice before their durable user message', () => {
  const app = client(quizHooks)
  const row = app.result('quiz_show', quizFixture)
  const mount = () => quizControls(cards(row())[0])
  mount().set('理由', '我自己的答案')
  let text, sends = 0
  app.inputActions.setDraft = (value) => { text = value }
  app.inputActions.submit = () => { sends++ }
  for (const action of ['answer', 'help']) {
    if (action === 'answer') mount().submit('重试')
    else mount().help('term', '重试')
    const before = sends
    app.setInput({ phase: 'sending', draft: text, queue: [] })
    assert.equal(mount().canSend, false)
    app.setInput({ phase: 'plain', draft: '', queue: [{ id: 'accepted', content: [{ type: 'text', text }] }] })
    const queued = mount()
    assert.equal(queued.canSend, false, 'host acceptance must prevent duplicate sends while queued')
    assert.equal(queued.closed, null, 'acceptance is not a durable learner answer')
    assert.equal(queued.locked, false, 'queued help must leave the answer editable')
    queued.submit('重试')
    queued.hint('重试')
    assert.equal(sends, before)
    app.storage.clear()
    assert.equal(mount().canSend, false, 'native queue also protects after cache removal')
    app.setInput({ queue: [] })
    assert.equal(mount().canSend, true, 'a removed queue item can be submitted again')
    assert.equal(mount().closed, null)
  }
  app.setInput({ queue: [{ id: 'unrelated', content: [{ type: 'text', text: '普通消息' }] }] })
  assert.equal(mount().canSend, true, 'other queued messages do not block the quiz')
})

test('learning help preserves drafts, waits for real delivery and marks later answers assisted', () => {
  const app = client(quizHooks)
  const row = app.result('quiz_show', quizFixture)
  const mount = () => quizControls(cards(row())[0])
  mount().set('理由', '尚未完成的思路')
  const sent = []
  app.inputActions.setDraft = (text) => { sent.push(text); app.setInput({ draft: text }) }
  app.inputActions.submit = () => { throw new Error('offline') }
  mount().help('term', '重试')
  assert.match(sent[0], /^【学习补给】这个词不懂：重试/)
  assert.equal(parseQuizAction(sent[0]).id, quizFixture.id)
  assert.ok(mount().pending)
  assert.equal(mount().answers['理由'], '尚未完成的思路')
  assert.equal(mount().hints, 0, 'failed delivery is not confirmed help')
  assert.equal(mount().closed, null)
  app.inputActions.submit = () => {}
  mount().help('term', '重试')
  app.emit('user/message', { content: [{ type: 'text', text: sent.at(-1) }] })
  app.setInput({ draft: '' })
  app.storage.clear() // Confirmed help survives cache removal and re-mounting.
  assert.equal(mount().closed, null)
  assert.equal(mount().pending, false)
  mount().hint('重试')
  assert.match(sent.at(-1), /第 1 次提示/, 'concept help must not consume the first hint')
  app.emit('user/message', { content: [{ type: 'text', text: sent.at(-1) }] })
  app.setInput({ draft: '' })
  mount().help('approach', '重试')
  assert.match(sent.at(-1), /^【学习补给】不知道从哪开始：/)
  app.emit('user/message', { content: [{ type: 'text', text: sent.at(-1) }] })
  app.setInput({ draft: '' })
  mount().set('理由', '补讲后我自己完成的答案')
  mount().submit('重试')
  assert.match(sent.at(-1), /提示：3 次/, 'two help requests and one hint count as three assists')
})

test('learning help obeys the same read-only, streaming and composer guards as other actions', () => {
  const app = client(quizHooks)
  const row = app.result('quiz_show', quizFixture)
  const element = cards(row())[0]
  const controls = (overrides = {}) => {
    const exercise = element.type({ ...element.props, ...overrides })
    return exercise.type(exercise.props).props.children.props.value
  }
  let sent = 0
  app.inputActions.setDraft = () => { sent++ }
  for (const input of [{ draft: '保留草稿' }, { draft: '', attachmentIds: ['file-1'] }, { draft: '', attachmentIds: [], phase: 'submitting' }]) {
    app.setInput({ phase: 'plain', attachmentIds: [], ...input })
    controls().help('term', '原题')
  }
  app.setInput({ phase: 'plain', draft: '', attachmentIds: [] })
  controls({ inputActions: undefined }).help('term', '原题')
  controls({ isStreaming: true }).help('term', '原题')
  controls().help('unknown', '原题')
  app.result('quiz_show', { ...quizFixture, id: 'next-question' })
  controls().help('term', '原题')
  assert.equal(sent, 0)
})

test('demo access is explicit, delivery-confirmed and assisted; local operations send no messages', () => {
  const app = client(quizHooks)
  const ordinary = app.result('quiz_show', quizFixture)
  assert.equal(quizControls(cards(ordinary())[0]).helpDemo, null)
  const row = app.result('quiz_show', { ...quizFixture, id: 'demo-quiz', helpDemo: 'execution-waiting' })
  const mount = () => quizControls(cards(row())[0])
  mount().set('理由', '我自己的原题草稿')
  const sent = []
  app.inputActions.setDraft = (text) => { sent.push(text); app.setInput({ draft: text }) }
  app.inputActions.submit = () => { throw new Error('offline') }
  mount().help('demo', '执行与等待')
  assert.match(sent.at(-1), /^【学习补给】动手演示/)
  assert.equal(mount().demoReady, false, 'a failed or unconfirmed send cannot expose help as unassisted work')
  assert.equal(mount().answers['理由'], '我自己的原题草稿')
  app.inputActions.submit = () => {}
  mount().help('demo', '执行与等待')
  assert.equal(mount().demoReady, false, 'void submit is not a delivery confirmation')
  app.emit('user/message', { content: [{ type: 'text', text: sent.at(-1) }] })
  app.setInput({ draft: '不要覆盖这段输入' })
  assert.equal(mount().demoReady, true)
  assert.equal(mount().closed, null)
  mount().demoAction('执行与等待', { type: 'place', mode: 'busy', destination: 'waiting' })
  assert.equal(sent.length, 2, 'local observation events do not touch the composer')
  app.storage.clear()
  assert.equal(mount().demoReady, true, 'history preserves assistance after clearing cache')
  app.setInput({ draft: '' })
  mount().set('理由', '演示后完成原题')
  mount().submit('原题')
  assert.match(sent.at(-1), /提示：1 次/)
})

test('configurable demo access uses confirmed assistance without changing drafts or sending observations', () => {
  const app = client(quizHooks)
  const config = { kind: 'state-machine', title: '阈值观察', scope: '仅观察输入阈值', initial: 'idle',
    inputs: [{ id: 'x', label: '输入', type: 'number', min: 0, max: 10, initial: 0 }],
    states: [{ id: 'idle', label: '等待', output: '尚未触发' }, { id: 'done', label: '完成', output: '已触发' }],
    transitions: [{ from: 'idle', to: 'done', label: '超过阈值', when: [{ input: 'x', op: 'gt', value: 5 }] }] }
  const row = app.result('quiz_show', { ...quizFixture, id: 'generic-demo', helpDemo: config })
  const mount = () => quizControls(cards(row())[0])
  assert.equal(mount().helpDemo.kind, 'state-machine')
  mount().set('理由', '保留原题思路')
  const sent = []
  app.inputActions.setDraft = (text) => { sent.push(text); app.setInput({ draft: text }) }
  app.inputActions.submit = () => {}
  mount().help('demo', '阈值观察')
  assert.equal(mount().demoReady, false)
  app.emit('user/message', { content: [{ type: 'text', text: sent.at(-1) }] })
  app.setInput({ draft: '' })
  assert.equal(mount().demoReady, true)
  assert.equal(mount().answers['理由'], '保留原题思路')
  mount().demoAction('阈值观察', { type: 'step', state: 'done' })
  assert.equal(sent.length, 1)
  mount().submit('原题')
  assert.match(sent.at(-1), /提示：1 次/)
})

test('failed or cancelled quiz sends preserve drafts and remain retryable until a real user message arrives', () => {
  const app = client(quizHooks)
  const row = app.result('quiz_show', quizFixture)
  const mount = () => quizControls(cards(row())[0])
  mount().set('理由', '我自己的答案')
  let sent
  app.inputActions.setDraft = (text) => { sent = text; app.setInput({ draft: text }) }
  app.inputActions.submit = () => { throw new Error('offline') }
  assert.doesNotThrow(() => mount().submit('重试'))
  let retry = mount()
  assert.equal(retry.closed, null)
  assert.equal(retry.locked, false)
  assert.equal(retry.answers['理由'], '我自己的答案')
  assert.equal(retry.canSend, true, 'the card may replace its own failed-send draft')
  assert.ok(retry.pending)
  app.setInput({ phase: 'submitting' })
  assert.equal(mount().canSend, false)
  assert.equal(mount().locked, true, 'an actual pending send still locks editing')
  app.setInput({ phase: 'plain' }) // Admission cancelled; no user/message was committed.
  for (const input of [{ draft: '不要覆盖我的草稿' }, { draft: '', attachmentIds: ['file-1'] }]) {
    app.setInput({ attachmentIds: [], ...input })
    retry = mount()
    assert.ok(retry.pending)
    assert.equal(retry.canSend, false)
    assert.equal(retry.locked, false, 'an occupied composer blocks sending, not editing')
    const exercise = cards(row())[0].type(cards(row())[0].props)
    const controls = exercise.type(exercise.props).props.children.props.value
    controls.set('理由', '修改后的答案')
    assert.equal(mount().answers['理由'], '修改后的答案')
    const before = sent
    controls.hint('重试')
    assert.equal(sent, before, 'blocked actions must not overwrite the composer')
  }
  app.setInput({ draft: sent, attachmentIds: [] })
  app.inputActions.submit = () => {}
  retry = mount()
  assert.equal(retry.canSend, true)
  retry.submit('重试')
  assert.equal(mount().closed, null, 'void submit returning is not a delivery acknowledgement')
  app.emit('user/message', { content: [{ type: 'text', text: sent }] })
  assert.equal(mount().closed, 'answered')
  assert.equal(mount().pending, false)
  app.storage.clear() // Another browser / cleared storage still sees the durable answer.
  assert.equal(mount().closed, 'answered')
  assert.equal(mount().answerText, quizAnswerDisplay(sent))
})

test('quiz replay recognises only explicit matching controls and closes older quizzes after a new successful card', () => {
  const app = client(quizHooks)
  const row = app.result('quiz_show', quizFixture)
  const mount = () => quizControls(cards(row())[0])
  for (const text of ['继续讲讲', '【作答】另一题\n（互动题 other-quiz）', '这是引用：（互动题 retry-quiz）']) {
    app.emit('user/message', { content: [{ type: 'text', text }] })
    assert.equal(mount().closed, null)
  }
  app.emit('user/message', { content: [{ type: 'text', text: '【求提示】重试（互动题 retry-quiz，第 1 次提示）' }] })
  assert.equal(mount().hints, 1)
  assert.equal(mount().closed, null)
  app.result('quiz_show', { ...quizFixture, id: 'rejected-quiz' }, { isError: true })
  assert.equal(mount().closed, null, 'a rejected preview cannot end the previous question')
  app.result('quiz_show', { ...quizFixture, id: 'next-quiz' })
  assert.equal(mount().closed, 'superseded')
  app.emit('user/message', { content: [{ type: 'text', text: '【歇一会儿】先到这里（互动题 next-quiz）' }] })
  assert.equal(quizHistory({ legacy: { nodes: [{ kind: 'user', seq: 1, content: [{ type: 'text', text: '【换题】太难了，来一道简单点的：题（互动题 old）' }] }] } }, 'old').closed, 'easier')
})

test('the shared quiz answer format preserves sources, calibration, hints and explicit quiz identity', () => {
  const text = formatQuizAnswer({ id: 'q-1', title: '判断', answers: [{ prompt: '理由', value: '因为边界条件' }], sources: ['m-book#2'], confidence: 'sure', hints: 2 })
  assert.match(text, /· 理由 → 因为边界条件/)
  assert.match(text, /把握：稳\n教材依据：m-book#2\n提示：2 次\n（互动题 q-1）$/)
  assert.equal(parseQuizAction(text).id, 'q-1')
  assert.equal(parseQuizAction(text).action, 'answered')
  assert.equal(parseQuizAction('普通消息（互动题 q-1）'), null)
})

test('practice submissions and controls preserve the purpose when sent from the sidebar', () => {
  const app = client(quizHooks)
  const row = app.result('quiz_show', { ...cases.find(([name]) => name === 'quiz_show')[1], purpose: 'practice' })
  const card = cards(row())[0]
  const exercise = card.type(card.props)
  let sent
  app.inputActions.setDraft = (text) => { sent = text }
  exercise.props.onAction({ type: 'submit', title: '观察', answers: [{ prompt: '依据', value: '单路清晰' }] })
  assert.match(sent, /用途：理解练习（不计掌握度）/)
  assert.equal(parseQuizAction(sent).id, card.props.view.id)
  for (const event of [{ type: 'hint', title: '观察' }, { type: 'help', title: '观察', kind: 'term' }, { type: 'easier', title: '观察' }, { type: 'break', title: '观察' }]) {
    exercise.props.onAction(event)
    assert.match(sent, /\n用途：理解练习（不计掌握度）\n（互动题 /)
    assert.equal(parseQuizAction(sent).id, card.props.view.id)
  }
})

test('submitted answers hide the message envelope while preserving multiline reasoning and calibration', () => {
  const text = formatQuizAnswer({ id: 'q-1', title: '题目标题', answers: [{ prompt: '理由', value: '第一行解释\n第二行解释' }], sources: ['m-book#2'], confidence: 'unsure', hints: 1 })
  assert.equal(quizAnswerDisplay(text), '· 理由 → 第一行解释\n第二行解释\n把握：有点把握\n提示：1 次')
  assert.equal(quizAnswerDisplay('【作答】题目\n自由文本第一行\n自由文本第二行\n（互动题 q-old）'), '自由文本第一行\n自由文本第二行')
})

function quizComponentHarness(view = quizFixture) {
  let context
  const app = client({ ...quizHooks, useEffect: () => {}, useContext: () => context })
  const row = app.result('quiz_show', view)
  const exercise = cards(row())[0].type(cards(row())[0].props)
  const provider = exercise.type(exercise.props).props.children
  const renderer = provider.props.children.find((child) => child?.props?.response)
  context = { answers: {}, locked: false, closed: null, actionable: true, register() {}, label() {}, set(key, value) { this.answers[key] = value } }
  return {
    app, provider,
    context,
    render(name, props) { return elements(renderer.props.library.components[name].component({ props, renderNode: () => null })) },
    submitDisabled(prompt, complete) {
      Object.assign(context, { fields: [{ key: prompt, complete }], canSend: true })
      const root = renderer.props.library.components.Quiz.component({ props: { title: '测试' }, renderNode: () => null })
      const footer = elements(root).find((node) => node.props.quiz === context)
      return elements(footer.type(footer.props)).find((node) => node.type === 'button' && node.props.className === 'la-submit').props.disabled
    },
  }
}

test('SpotError requires both a selected line and a correction', () => {
  const fixture = quizComponentHarness()
  const props = { prompt: '找出并修正', lines: ['先校验输入', '跳过所有权限检查', '保存数据'] }
  let nodes = fixture.render('SpotError', props)
  const line = nodes.filter((node) => node.type === 'button')[1]
  assert.equal(line.props['aria-pressed'], false)
  line.props.onClick()
  assert.deepEqual(Array.from(fixture.context.answers[props.prompt]), [2, ''])
  assert.equal(fixture.submitDisabled(props.prompt), true)
  nodes = fixture.render('SpotError', props)
  nodes.find((node) => node.type === 'textarea').props.onChange({ target: { value: '先检查当前用户权限' } })
  assert.deepEqual(Array.from(fixture.context.answers[props.prompt]), [2, '先检查当前用户权限'])
  assert.equal(fixture.submitDisabled(props.prompt), false)
  fixture.context.locked = true
  nodes = fixture.render('SpotError', props)
  assert.ok(nodes.filter((node) => node.type === 'button').every((node) => node.props.disabled))
  assert.equal(nodes.find((node) => node.type === 'textarea').props.readOnly, true)
  assert.doesNotThrow(() => fixture.render('SpotError', {}), 'partial streaming props render safely')
})

test('OrderSteps fills the path incrementally with nulls, supports undo/reset and prevents duplicate selections', () => {
  const fixture = quizComponentHarness()
  const props = { prompt: '排顺序', items: ['返回响应', '接收请求', '处理业务'] }
  const buttons = () => fixture.render('OrderSteps', props).filter((node) => node.type === 'button')
  buttons()[1].props.onClick()
  assert.deepEqual(Array.from(fixture.context.answers[props.prompt]), [1, null, null])
  assert.equal(fixture.submitDisabled(props.prompt), true)
  assert.equal(buttons()[1].props.disabled, true)
  buttons()[2].props.onClick()
  assert.deepEqual(Array.from(fixture.context.answers[props.prompt]), [1, 2, null])
  buttons()[3].props.onClick() // Undo the last selection.
  assert.deepEqual(Array.from(fixture.context.answers[props.prompt]), [1, null, null])
  buttons()[2].props.onClick()
  buttons()[0].props.onClick()
  assert.deepEqual(Array.from(fixture.context.answers[props.prompt]), [1, 2, 0])
  assert.equal(fixture.submitDisabled(props.prompt), false)
  buttons()[4].props.onClick() // Reset to an unfinished path.
  assert.deepEqual(Array.from(fixture.context.answers[props.prompt]), [null, null, null])
  fixture.context.locked = true
  assert.ok(buttons().every((node) => node.props.disabled))
  assert.doesNotThrow(() => fixture.render('OrderSteps', {}))
})

test('counterexample and minimal change collect a selection plus the learner explanation', () => {
  for (const [type, props, values] of [
    ['Counterexample', { prompt: '找反例', claim: '命中就是最新', cases: ['副本已过期', '刚刚刷新'] }, ['副本没有刷新']],
    ['MinimalChange', { prompt: '只改一条', goal: '让新任务能排队', conditions: ['队列容量为 2', '两个任务正在等候'] }, ['队列容量改为 3', '留出一个等待位置']],
  ]) {
    const fixture = quizComponentHarness()
    const render = () => fixture.render(type, props)
    const complete = (value) => playAnswerComplete(type, props, value)
    assert.equal(fixture.submitDisabled(props.prompt, complete), true)
    render().find((node) => node.type === 'button').props.onClick()
    assert.equal(fixture.context.answers[props.prompt][0], 0)
    assert.equal(fixture.submitDisabled(props.prompt, complete), true)
    values.forEach((value, index) => render().filter((node) => node.type === 'textarea')[index].props.onChange({ target: { value } }))
    assert.equal(fixture.submitDisabled(props.prompt, complete), false)
    fixture.context.locked = true
    assert.ok(render().filter((node) => node.type === 'button').every((node) => node.props.disabled))
    assert.ok(render().filter((node) => node.type === 'textarea').every((node) => node.props.readOnly))
    assert.doesNotThrow(() => fixture.render(type, {}), `${type} tolerates incomplete streaming props`)
  }
})

test('dual prediction needs both predictions and a reason; transfer needs a plan and an applicability reason', () => {
  const dual = quizComponentHarness()
  const props = { prompt: '比较两局', before: '队列未满', after: '队列已满', options: ['排队', '扩容'] }
  const render = () => dual.render('DualPredict', props)
  const complete = (value) => playAnswerComplete('DualPredict', props, value)
  render().filter((node) => node.type === 'button')[0].props.onClick()
  assert.equal(dual.submitDisabled(props.prompt, complete), true)
  render().filter((node) => node.type === 'button')[3].props.onClick()
  assert.equal(dual.submitDisabled(props.prompt, complete), true)
  render().find((node) => node.type === 'textarea').props.onChange({ target: { value: '只有队列满时才考虑扩容' } })
  assert.deepEqual(Array.from(dual.context.answers[props.prompt]), [0, 1, '只有队列满时才考虑扩容'])
  assert.equal(dual.submitDisabled(props.prompt, complete), false)
  assert.doesNotThrow(() => dual.render('DualPredict', {}))

  const transfer = quizComponentHarness()
  const task = { prompt: '新领域任务', situation: '三个工序的处理速度不同', goal: '提高整条流程产出', constraints: ['只能改善一处'] }
  const renderTask = () => transfer.render('TransferTask', task)
  const taskComplete = (value) => playAnswerComplete('TransferTask', task, value)
  renderTask().filter((node) => node.type === 'textarea')[0].props.onChange({ target: { value: '先改善最慢的工序' } })
  assert.equal(transfer.submitDisabled(task.prompt, taskComplete), true)
  renderTask().filter((node) => node.type === 'textarea')[1].props.onChange({ target: { value: '其它工序更快只会增加积压' } })
  assert.equal(transfer.submitDisabled(task.prompt, taskComplete), false)
  transfer.context.locked = true
  assert.ok(renderTask().filter((node) => node.type === 'textarea').every((node) => node.props.readOnly))
  assert.doesNotThrow(() => transfer.render('TransferTask', {}))
})

test('retry quiz context carries its source record but leaves fresh answers empty', () => {
  const retry = { id: 'old-verification', question: '旧题', answer: '旧错误答案', kpId: 'kp-1' }
  const fixture = quizComponentHarness({ ...quizFixture, retry })
  assert.equal(fixture.provider.props.value.retry.id, retry.id)
  assert.equal(Object.keys(fixture.provider.props.value.answers).length, 0)
  fixture.context.retry = retry
  const nodes = fixture.render('Quiz', { title: '新情境', type: 'scenario' })
  assert.ok(nodes.some((node) => node.props.children === '错题重赛'))
  assert.ok(nodes.some((node) => node.props.className === 'la-retry-note'))
})


test('feedback shows previous and current reasoning side by side for a retry', () => {
  const app = client()
  const row = app.result('verification_record', { view: 'feedback', id: 'v-new', verdict: 'correct', kp: { id: 'kp-1', title: '队列' }, sources: [], retry: {
    id: 'v-old', question: '上次情境', answer: '上次错误推理', currentQuestion: '这次新情境', currentAnswer: '这次完整推理',
  } })
  const card = cards(row())[0]
  const nodes = elements(card.type(card.props))
  assert.ok(nodes.some((node) => node.props['aria-label'] === '重赛前后对照'))
  for (const text of ['上次情境', '上次错误推理', '这次新情境', '这次完整推理']) assert.ok(nodes.some((node) => node.props.children === text), text)
})

test('the learning tab shows the overview until an exercise exists, then keeps the exercise', () => {
  const app = client()
  const stats = { goal: 'Java', due: 1, total: 3, mastered: 1, percent: 33, current: { id: 'k', title: '继承', phase: 'build' } }
  const markup = (element) => renderToStaticMarkup(element)
  assert.match(markup(app.workspace(undefined, { useProjection: () => null })), /开始练习后/, 'no course: the old empty state')
  assert.match(markup(app.workspace()), /开始练习后/, 'no projection hook: the old empty state')
  const overview = app.workspace(undefined, { useProjection: (key) => key === 'learn-anything/stats' ? stats : undefined })
  const out = markup(overview)
  for (const text of ['Java', '继承', '用自己的话总结', '开始复习']) assert.ok(out.includes(text), text)
  const sent = []
  app.inputActions.setDraft = (text) => sent.push(text)
  app.inputActions.submit = () => sent.push('submit')
  const panel = overview.props.onStart
  panel()
  assert.deepEqual(sent, ['开始今日复习', 'submit'], 'the same prompt as the composer chip')
  assert.equal(overview.props.canStart, true)
  app.setInput({ draft: '正在输入' })
  assert.equal(app.workspace(undefined, { useProjection: () => stats }).props.canStart, false)
  assert.match(markup(app.workspace(undefined, { useProjection: () => ({ goal: 'Java', due: 0, total: 3, mastered: 1, percent: 33 }) })), /今天没有到期的复习/, 'old-shape stats')
  app.result('quiz_show', { view: 'quiz', id: 'q1', kp: { id: 'k', title: '继承' }, question: '题目？', options: [] })()
  assert.doesNotMatch(markup(app.workspace('q1', { useProjection: () => stats })), /la-overview/, 'an active exercise keeps today\'s behaviour')
})
