import * as react from 'react'
import { t, useUiLocale } from './locale.js'
const h = react.createElement
export const personal = (model) => (model.examples ?? []).filter((e) => e.origin === 'user' && e.tag !== 'v' && !e.checked)
export const editModels = (view) => view.models.map((m) => ({ id: m.id, statement: m.statement ?? '', annotation: m.annotation ?? '', examples: personal(m).map(({ input, output, polarity }) => ({ input, output, polarity })) }))
export async function targetRequest(action, sessionId, args) {
  const response = await fetch(`/api/learn-anything/target/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, ...args }) })
  const result = await response.json()
  if (!response.ok || !result.ok) throw new Error(result.error?.message ?? t('保存失败，草稿已保留。'))
  return result.value
}
export function TargetEditor({ view, sessionId, onSaved }) {
  useUiLocale()
  const [draft, setDraft] = react.useState(null)
  const [revision, setRevision] = react.useState(null)
  const [busy, setBusy] = react.useState(false)
  const [error, setError] = react.useState('')
  const change = (id, patch) => setDraft(draft.map((m) => m.id === id ? { ...m, ...patch } : m))
  const open = async () => {
    setBusy(true); setError('')
    try { const current = await targetRequest('read', sessionId, { kpId: view.kp.id }); setRevision(current.revision); setDraft(editModels(current.view)) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const save = async () => {
    setBusy(true); setError('')
    try {
      const current = await targetRequest('save', sessionId, { kpId: view.kp.id, expected: revision, models: draft })
      onSaved(current.view); setDraft(null)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  if (!sessionId) return null
  return h('div', { className: 'la-note-editor' },
    !draft ? h('button', { type: 'button', className: 'la-action', disabled: busy, onClick: open }, t('编辑靶图')) : h('div', null,
      h('p', null, t('直接写下你的理解。已验证的例子和成绩会保留。')),
      draft.map((m, i) => h('fieldset', { key: m.id, disabled: busy }, h('legend', null, view.models[i]?.concept ?? `${view.models[i]?.input} → ${view.models[i]?.output}`),
        h('label', null, t('你的解释'), h('textarea', { value: m.statement, maxLength: 10000, onChange: (e) => change(m.id, { statement: e.target.value }) })),
        h('label', null, t('个人批注'), h('textarea', { value: m.annotation, maxLength: 10000, onChange: (e) => change(m.id, { annotation: e.target.value }) })),
        m.examples.map((e, n) => h('div', { key: n },
          ...['input', 'output'].map((key) => h('label', { key }, t(key === 'input' ? '例子输入' : '例子输出'), h('textarea', { value: e[key], maxLength: 10000, onChange: (event) => change(m.id, { examples: m.examples.map((x, j) => j === n ? { ...x, [key]: event.target.value } : x) }) }))),
          h('select', { 'aria-label': t('例子类型'), value: e.polarity ?? '', onChange: (event) => change(m.id, { examples: m.examples.map((x, j) => j === n ? { ...x, polarity: event.target.value || undefined } : x) }) }, h('option', { value: '' }, t('未分类')), h('option', { value: 'pos' }, t('正例')), h('option', { value: 'neg' }, t('反例'))),
          h('button', { type: 'button', onClick: () => change(m.id, { examples: m.examples.filter((_, j) => j !== n) }) }, t('删除个人例子')))),
        h('button', { type: 'button', disabled: m.examples.length >= 100, onClick: () => change(m.id, { examples: [...m.examples, { input: '', output: '' }] }) }, t('添加个人例子')))),
      h('button', { type: 'button', className: 'la-action', disabled: busy, onClick: save }, t('保存笔记')),
      h('button', { type: 'button', disabled: busy, onClick: () => { setDraft(null); setError('') } }, t('取消编辑'))),
    error ? h('p', { role: 'alert' }, error) : null)
}
