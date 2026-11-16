import * as react from 'react'
import { useUiLocale } from './locale.js'

const h = react.createElement
const copy = {
  edit: ['编辑路线', 'Edit route'], save: ['保存草稿', 'Save draft'], lock: ['确认并锁定', 'Confirm and lock'],
  cancel: ['取消', 'Cancel'], chapter: ['章节', 'Chapter'], point: ['知识点', 'Knowledge point'],
  addChapter: ['添加章节', 'Add chapter'], addPoint: ['添加知识点', 'Add knowledge point'],
  remove: ['移除', 'Remove'], up: ['上移', 'Move up'], down: ['下移', 'Move down'],
  skip: ['跳过（不代表掌握）', 'Skip (does not grant mastery)'], knowledge: ['知识', 'Knowledge'], information: ['信息', 'Information'],
  prerequisites: ['前置 ID（逗号分隔）', 'Prerequisite IDs (comma separated)'], minutes: ['预计分钟', 'Estimated minutes'],
  busy: ['正在保存…', 'Saving…'], saved: ['已保存', 'Saved'], failed: ['保存失败，草稿已保留', 'Save failed; draft retained'],
  loadFailed: ['读取失败，请重试', 'Could not load; try again'],
}

export function moveOutlineItem(items, from, to) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= items.length || to >= items.length) return items
  const next = [...items]
  next.splice(to, 0, next.splice(from, 1)[0])
  return next
}

// Transport uses the host's authenticated same-origin route. No model round trip.
export async function outlineRequest(sessionId, operation, data = {}) {
  const response = await fetch(`/api/learn-anything/outline/${operation}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, ...data }),
  })
  const result = await response.json()
  if (!response.ok || result.ok === false) throw new Error(result.error?.message ?? result.error ?? `HTTP ${response.status}`)
  return result.value ?? result
}

export function OutlineEditor({ sessionId, view, request = outlineRequest, onSaved }) {
  const language = useUiLocale()
  const label = (key) => copy[key][language === 'zh' ? 0 : 1]
  const [draft, setDraft] = react.useState(null)
  const [busy, setBusy] = react.useState(false)
  const [message, setMessage] = react.useState('')
  const [locked, setLocked] = react.useState(false)
  const drag = react.useRef(null)
  const update = (fn) => setDraft((prev) => ({ ...prev, view: { ...prev.view, chapters: fn(prev.view.chapters) } }))
  const chapter = (ci, fn) => update((chapters) => chapters.map((ch, i) => i === ci ? fn(ch) : ch))
  const point = (ci, pi, patch) => chapter(ci, (ch) => ({ ...ch, kps: ch.kps.map((kp, i) => i === pi ? { ...kp, ...patch } : kp) }))
  async function open() {
    setBusy(true); setMessage('')
    try { setDraft(await request(sessionId, 'read')) } catch (e) { setMessage(`${label('loadFailed')}: ${e.message}`) }
    finally { setBusy(false) }
  }
  async function save(status) {
    setBusy(true); setMessage('')
    try {
      const next = await request(sessionId, 'save', { expected: draft.revision, chapters: draft.view.chapters, status })
      onSaved?.(next.view)
      setDraft(status === 'active' ? null : next); setLocked(status === 'active'); setMessage(label('saved'))
    } catch (e) { setMessage(`${label('failed')}: ${e.message}`) }
    finally { setBusy(false) }
  }
  const button = (key, onClick, disabled = false) => h('button', { type: 'button', className: 'la-action', disabled: busy || disabled, onClick }, label(key))
  const reorder = (items, index, replace) => h('span', null,
    button('up', () => replace(moveOutlineItem(items, index, index - 1)), index === 0),
    button('down', () => replace(moveOutlineItem(items, index, index + 1)), index === items.length - 1))
  if (view.status !== 'planning' || locked || !sessionId) return message ? h('p', { role: 'status' }, message) : null
  return h('div', { className: 'la-outline-editor' },
    !draft ? button('edit', open) : h('fieldset', { disabled: busy },
      draft.view.chapters.map((ch, ci) => h('section', { key: ci, 'aria-label': `${label('chapter')} ${ci + 1}` },
        h('label', null, label('chapter'), h('input', { value: ch.title, onChange: (e) => chapter(ci, (c) => ({ ...c, title: e.target.value })) })),
        reorder(draft.view.chapters, ci, (value) => update(() => value)),
        button('remove', () => update((chapters) => chapters.filter((_, i) => i !== ci))),
        ch.kps.map((kp, pi) => h('div', { key: kp.id, draggable: !busy,
          onDragStart: (e) => { drag.current = { ci, pi }; e.dataTransfer?.setData('text/plain', kp.id) },
          onDragOver: (e) => e.preventDefault(),
          onDrop: (e) => { e.preventDefault(); const source = drag.current; if (source?.ci === ci) chapter(ci, (c) => ({ ...c, kps: moveOutlineItem(c.kps, source.pi, pi) })); drag.current = null },
        },
        h('label', null, label('point'), h('input', { value: kp.title, onChange: (e) => point(ci, pi, { title: e.target.value }) })),
        h('small', null, kp.id),
        h('select', { value: kp.kind, 'aria-label': label('point'), onChange: (e) => point(ci, pi, { kind: e.target.value }) }, ['knowledge', 'information'].map((kind) => h('option', { key: kind, value: kind }, label(kind)))),
        h('label', null, h('input', { type: 'checkbox', checked: Boolean(kp.skipped), onChange: (e) => point(ci, pi, { skipped: e.target.checked }) }), label('skip')),
        h('label', null, label('prerequisites'), h('input', { value: (kp.prerequisites ?? []).join(', '), onChange: (e) => point(ci, pi, { prerequisites: e.target.value.split(/[,，]/u).map((s) => s.trim()).filter(Boolean) }) })),
        h('label', null, label('minutes'), h('input', { type: 'number', min: 1, max: 10000, value: kp.estMinutes ?? '', onChange: (e) => point(ci, pi, { estMinutes: e.target.value ? Number(e.target.value) : undefined }) })),
        reorder(ch.kps, pi, (value) => chapter(ci, (c) => ({ ...c, kps: value }))),
        button('remove', () => chapter(ci, (c) => ({ ...c, kps: c.kps.filter((_, i) => i !== pi) }))))),
        button('addPoint', () => chapter(ci, (c) => ({ ...c, kps: [...c.kps, { id: `kp-${globalThis.crypto.randomUUID()}`, title: '', kind: 'knowledge', prerequisites: [], sources: [], skipped: false }] }))))),
      button('addChapter', () => update((chapters) => [...chapters, { title: '', kps: [] }])),
      button('save', () => save('planning')), button('lock', () => save('active')),
      button('cancel', () => { setDraft(null); setMessage('') })),
    h('p', { role: 'status', 'aria-live': 'polite' }, busy ? label('busy') : message))
}
