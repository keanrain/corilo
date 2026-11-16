import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { TargetEditor } from '../../src/client/target-editor.js'
const h = React.createElement
const view = { kp: { id: 'demo' }, models: [{ id: 'map', concept: 'Demo', statement: 'Original', annotation: '', examples: [] }] }
let saved = view
let revision = 'one'
// Transport fixture exercises rendering and failure recovery, not Harness authentication.
window.fetch = async (_url, options) => {
  const args = JSON.parse(options.body)
  if (_url.endsWith('/save')) {
    if (window.failSave) return { ok: false, json: async () => ({ ok: false, error: { message: 'Version conflict; draft retained' } }) }
    saved = { ...view, models: args.models.map((m) => ({ ...view.models.find((v) => v.id === m.id), ...m, examples: m.examples.map((e) => ({ ...e, origin: 'user', tag: 'e', checked: false })) })) }; revision = 'two'
  }
  return { ok: true, json: async () => ({ ok: true, value: { view: saved, revision } }) }
}
function Demo() {
  const [view, setView] = React.useState(saved)
  return h('main', null, h(TargetEditor, { view, sessionId: 'test', onSaved: setView }), h('pre', { id: 'saved' }, JSON.stringify(view)))
}
createRoot(document.getElementById('root')).render(h(Demo))
