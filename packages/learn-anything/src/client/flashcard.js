import { t, useUiLocale } from './locale.js'
import * as react from 'react'
import { Icon } from './icons.js'
import { Sources } from './sources.js'
import { FLASHCARD_CONFIDENCE, FLASHCARD_RESULT, formatFlashcardReview, flashcardHistory } from '../quiz/flashcard.js'

const h = react.createElement
const key = (id) => `learn-anything:flashcard:${id}`
function load(id) { try { return JSON.parse(localStorage.getItem(key(id)) ?? '{}') } catch { return {} } }
function save(id, value) { try { localStorage.setItem(key(id), JSON.stringify(value)) } catch {} }

export const FLASHCARD_CSS = `
.la-flash{border:1px solid var(--la-line);border-radius:16px;background:var(--la-paper);overflow:hidden}
.la-flash-head{display:flex;align-items:center;gap:12px;padding:19px 22px;border-bottom:1px solid var(--la-line)}
.la-flash-head h3{margin:3px 0 0;font-size:16px;font-weight:550}.la-flash-head .la-icon{width:21px;height:21px;color:var(--la-accent)}
.la-flash-tag{margin-left:auto;font-size:10px;color:var(--la-muted);white-space:nowrap}.la-flash-body{padding:22px}
.la-flash-question{margin:0 0 22px;white-space:pre-wrap;font-size:19px;line-height:1.65;letter-spacing:-.02em}
.la-flash-choices{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0 18px}.la-flash-choice{font:inherit;font-size:11px;min-height:36px;padding:7px 11px;border:1px solid var(--la-line);border-radius:8px;background:var(--la-paper);color:var(--la-muted);cursor:pointer}
.la-flash-choice[aria-pressed=true]{border-color:var(--la-accent);color:var(--la-accent);background:var(--la-soft)}
.la-flash-note{font-size:11px;color:var(--la-muted);line-height:1.7;margin:0}.la-flash-answer{border-left:2px solid var(--la-accent);background:var(--la-soft);padding:16px 18px;margin:17px 0;animation:la-flash-reveal 180ms ease-out}
.la-flash-answer p{white-space:pre-wrap;line-height:1.7;margin:6px 0 0;font-size:14px}.la-flash-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:17px}.la-flash-status{margin-top:14px;font-size:11px;color:var(--la-muted)}
.la-flash button:focus-visible{outline:2px solid var(--la-accent);outline-offset:3px}.la-flash button:disabled{cursor:default;opacity:.6}
@keyframes la-flash-reveal{from{opacity:0;transform:rotateX(-7deg) translateY(4px)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.la-flash-answer{animation:none}}
@container learning (max-width:420px){.la-flash-head,.la-flash-body{padding:17px}.la-flash-question{font-size:17px}.la-flash-tag{display:none}}
@media(hover:hover) and (pointer:fine){.la-flash-choice:hover:not(:disabled){border-color:var(--la-accent);color:var(--la-accent)}}
`

export function FlashcardCard({ view, useInput, useConversation, inputActions }) {
  useUiLocale()
  const [draft, setDraft] = react.useState(() => load(view.id))
  const [error, setError] = react.useState(null)
  const [sending, setSending] = react.useState(false)
  const [keyboardReveal, setKeyboardReveal] = react.useState(false)
  const historyJson = useConversation ? useConversation(({ views }) => JSON.stringify(flashcardHistory(views.get('chat'), view.id))) : '{}'
  const history = JSON.parse(historyJson)
  const input = useInput ? useInput((s) => s) : null
  const closed = Boolean(history.closed)
  const revealed = Boolean(draft.revealed || history.result)
  const busy = sending || Boolean(input && input.phase !== 'plain')
  const available = input && !busy && !input.attachmentIds.length && (!input.draft.trim() || input.draft === draft.pending)
  const patch = (value) => { const next = { ...draft, ...value }; save(view.id, next); setDraft(next) }
  const send = async (result) => {
    if (closed || !revealed || !draft.confidence || !available || !inputActions) return
    const text = formatFlashcardReview(view, draft.confidence, result)
    patch({ pending: text, result })
    setError(null)
    setSending(true)
    try { inputActions.setDraft(text); await inputActions.submit() }
    catch { setError('发送失败，自评已保留，可以重试') }
    finally { setSending(false) }
  }
  const status = history.result ? t('已告诉导师：{result}', { result: t(history.result) })
    : closed ? t('本卡已结束，请继续最新练习')
    : t(error) || (busy ? t('正在发送…') : draft.pending ? t('尚未确认发送，可以重试')
      : !revealed ? t('先回忆，再揭晓。') : !inputActions ? t('这里不能发送自评')
      : !available ? t('输入框里有内容，先处理后再发送自评') : t('核对后，告诉导师下一步怎么练。'))
  return h('section', { className: 'la-flash', 'data-flashcard': view.id, 'aria-label': t('回忆闪卡') },
    h('header', { className: 'la-flash-head' }, h(Icon, { name: 'book' }),
      h('div', { className: 'la-grow' }, h('p', { className: 'la-eyebrow' }, t('回忆 · 核对 · 再练')), h('h3', null, view.kp.title)),
      h('span', { className: 'la-flash-tag' }, t('自测练习'))),
    h('div', { className: 'la-flash-body' },
      h('p', { className: 'la-flash-question' }, view.fact.prompt),
      !revealed && !closed ? h(react.Fragment, null,
        h('p', { className: 'la-flash-note' }, t('先在心里回忆，再选一个最接近的感受。')),
        h('div', { className: 'la-flash-choices', role: 'group', 'aria-label': t('翻面前的把握') }, Object.entries(FLASHCARD_CONFIDENCE).map(([value, label]) => h('button', {
          key: value, type: 'button', className: 'la-flash-choice', 'aria-pressed': draft.confidence === value,
          onClick: () => patch({ confidence: value }),
        }, t(label)))),
        h('button', { type: 'button', className: 'la-submit', disabled: !draft.confidence, onClick: (event) => { setKeyboardReveal(event.detail === 0); patch({ revealed: true }) } }, t('翻面核对'), h(Icon, { name: 'arrow' }))) : null,
      revealed ? h('div', { className: 'la-flash-answer', style: keyboardReveal ? { animation: 'none' } : undefined },
        h('span', { className: 'la-eyebrow' }, t('参考答案')), h('p', null, view.fact.answer), h(Sources, { sources: view.sources, label: t('教材依据') })) : null,
      h('p', { className: 'la-flash-note' }, t('翻面和自评不会增加掌握度，后续独立回忆才算验证。')),
      revealed && !closed ? h('div', { className: 'la-flash-actions' }, Object.entries(FLASHCARD_RESULT).map(([value, label]) => h('button', {
        key: value, type: 'button', className: value === 'remembered' ? 'la-submit' : 'la-flash-choice', disabled: !available || !inputActions,
        onClick: () => send(value),
      }, draft.pending && draft.result === value ? t('重试：{label}', { label: t(label) }) : t(label)))) : null,
      h('div', { className: 'la-flash-status', role: 'status' }, status)))
}
