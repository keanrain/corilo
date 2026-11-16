import { t, useUiLocale } from './locale.js'
// DSH adapter for the pure Exercise card (./exercise.js): restores drafts and the
// confirmed lifecycle from the Session, sends answers/controls through the composer,
// and keeps the old QuizCard + QUIZ_CSS exports. Answer formatting and control
// messages live here; rendering, completeness and read-only state live in Exercise.
import * as react from 'react'
import { Exercise, QUIZ_CSS } from './exercise.js'
import { validateDemo } from '../quiz/demo.js'
import { TASK_DEMO_SCENE } from './task-demo.js'
import { formatQuizAnswer, parseQuizAction, quizAnswerDisplay, quizHistory, HELP_PREFIX, PRACTICE_MARKER } from '../quiz/answer.js'

export { QUIZ_CSS }

const h = react.createElement
const HINT_PREFIX = '【求提示】'
const PACE_PREFIX = '【换题】'
const BREAK_PREFIX = '【歇一会儿】'
const STORE_PREFIX = 'learn-anything:quiz:'

/** Keep drafts and controls when the learning sidebar is reopened. */
function loadMeta(id) {
  try {
    return JSON.parse(localStorage.getItem(`${STORE_PREFIX}${id}:meta`) ?? '{}')
  } catch {
    return {}
  }
}

function saveMeta(id, meta) {
  try { localStorage.setItem(`${STORE_PREFIX}${id}:meta`, JSON.stringify({ ...loadMeta(id), ...meta })) } catch {}
}

function loadSubmitted(id) {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + id)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/**
 * One quiz view. `useInput` / `inputActions` are the Session's composer seats,
 * supplied by the learning sidebar; without them (no composer) the card is
 * read-only.
 */
export function QuizCard({ view, useInput, useConversation, inputActions, isStreaming = false }) {
  useUiLocale()
  let helpDemo = null
  try { helpDemo = view.helpDemo === 'execution-waiting' ? TASK_DEMO_SCENE : validateDemo(view.helpDemo) ?? null } catch {}
  const submitted = react.useMemo(() => loadSubmitted(view.id), [view.id])
  const saved = react.useMemo(() => loadMeta(view.id), [view.id])
  const [answers, setAnswers] = react.useState(() => submitted ?? saved.answers ?? {})
  // Local storage is a draft cache, never proof that a message reached the Session.
  const historyJson = useConversation ? useConversation(({ views }) => JSON.stringify(quizHistory(views.get('chat'), view.id))) : '{}'
  const history = react.useMemo(() => JSON.parse(historyJson), [historyJson])
  const closed = history.closed ?? null
  const hints = history.hints ?? 0
  const helpRequests = history.helpRequests ?? 0
  const [pendingAttempt, setPending] = react.useState(saved.pending ?? null)
  const pending = pendingAttempt && (history.lastSeq ?? 0) <= (pendingAttempt.afterSeq ?? 0) ? pendingAttempt : null
  const [error, setError] = react.useState(null)
  const [confidence, setConfidence] = react.useState(saved.confidence ?? null)
  const input = useInput ? useInput((state) => state) : null
  const busy = input && input.phase !== 'plain'
  // Host admission can clear the composer before the queued message enters history.
  const queued = input?.queue?.some((item) => parseQuizAction(item.content.filter((block) => block.type === 'text').map((block) => block.text).join(''))?.id === view.id)
  const canSend = !isStreaming && !closed && !queued && Boolean(inputActions) &&
    Boolean(input && !busy && input.attachmentIds.length === 0 && (input.draft.trim() === '' || input.draft === pending?.text))
  const blocked = !inputActions ? t('这里不能作答') : queued ? t('已接收，正在等待处理') : busy ? t('正在提交，请稍候') : t('输入框里有内容，先清空再提交')

  const send = (text, action) => {
    if (closed || isStreaming || queued || !inputActions) return
    if (!input || busy || input.attachmentIds.length || (input.draft.trim() && input.draft !== pending?.text)) return
    if (view.purpose === 'practice' && action !== 'answered') text = text.replace('（互动题 ', `\n${PRACTICE_MARKER}\n（互动题 `)
    const attempt = { text, action, afterSeq: history.lastSeq ?? 0 }
    saveMeta(view.id, { pending: attempt })
    setPending(attempt)
    setError(null)
    try {
      inputActions.setDraft(text)
      inputActions.submit()
    } catch {
      setError('提交失败，答案已保留，可以重试')
    }
  }

  const onAction = (event) => {
    if (!event) return
    if (event.type === 'submit') {
      send(formatQuizAnswer({
        id: view.id,
        title: event.title,
        answers: event.answers ?? [],
        confidence: event.confidence ?? confidence,
        sources: view.sources,
        hints: hints + helpRequests,
        retryOf: view.retry?.id,
        purpose: view.purpose,
      }), 'answered')
      return
    }
    if (event.type === 'hint') {
      send(`${HINT_PREFIX}${event.title}（互动题 ${view.id}，第 ${hints + 1} 次提示）`, 'hint')
      return
    }
    if (event.type === 'help') {
      const reason = { term: '这个词不懂', approach: '不知道从哪开始', demo: '动手演示' }[event.kind]
      if (event.kind === 'demo' && !helpDemo) return
      const request = event.kind === 'demo'
        ? '我先在卡片里操作这个小例子，请等我回到原题继续，保留已有作答。'
        : '请先补一小块必要概念或一个更简单的例子，保留原题和作答，补完我再继续。'
      if (reason) send(`${HELP_PREFIX}${reason}：${event.title}。${request}（互动题 ${view.id}）`, 'help')
      return
    }
    if (event.type === 'break') {
      send(`${BREAK_PREFIX}先到这里（互动题 ${view.id}）`, 'break')
      return
    }
    if (event.type === 'easier' || event.type === 'harder') {
      send(`${PACE_PREFIX}${event.type === 'harder' ? '太简单了，来一道难一点的' : '太难了，来一道简单点的'}：${event.title}（互动题 ${view.id}）`, event.type)
    }
  }

  const onChange = (next) => {
    saveMeta(view.id, { answers: next })
    setAnswers(next)
  }
  const onConfidenceChange = (value) => {
    saveMeta(view.id, { confidence: value })
    setConfidence(value)
  }

  return h(Exercise, {
    view,
    answers,
    onChange,
    confidence,
    onConfidenceChange,
    status: {
      closed,
      answerText: typeof history.answerText === 'string' && history.answerText ? quizAnswerDisplay(history.answerText) : null,
      hints,
      pending: Boolean(pending),
      sending: Boolean(pending && busy),
      error,
      canSend,
      readOnly: !inputActions || !useInput,
      demoReady: helpRequests > 0,
      blocked,
    },
    onAction,
    isStreaming,
    helpDemo,
  })
}
