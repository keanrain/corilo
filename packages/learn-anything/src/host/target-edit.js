// Human-owned notes use authenticated UI actions, never model-authored tool arguments.
import { createHash } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import * as store from './store.js'
import { saveKp } from './tools/shared.js'
import { targetMapView, parseView } from './render.js'

const fail = (message, status = 400) => Object.assign(new Error(message), { status })
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export async function checkLearningPaths(cwd, kpId) {
  const p = store.paths(cwd)
  for (const path of [p.root, p.kpDir, ...(kpId ? [p.kp(kpId)] : [])]) {
    const stat = await lstat(path)
    if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1))) throw fail('Linked learning data cannot be edited', 400)
  }
}
export async function readTargetMap(cwd, kpId) {
  await checkLearningPaths(cwd, kpId)
  try {
    const stat = await lstat(store.paths(cwd).verifications)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw fail('Linked learning data cannot be edited')
  } catch (e) { if (e.code !== 'ENOENT') throw e }
  const kp = await store.requireKp(cwd, kpId)
  return { revision: hash(kp), view: parseView(targetMapView(kp, await store.readJsonl(store.paths(cwd).verifications))) }
}
function text(value, max = 10000) {
  if (typeof value !== 'string' || value.length > max) throw fail('Invalid note text')
  return value
}
export async function saveTargetMap(cwd, args, now = () => new Date()) {
  await checkLearningPaths(cwd, args.kpId)
  const kp = await store.requireKp(cwd, args.kpId)
  if (typeof args.expected !== 'string' || args.expected !== hash(kp)) throw fail('Notes changed. Reopen the editor to load the latest version; your draft is retained.', 409)
  if (!Array.isArray(args.models) || args.models.length !== kp.models.length) throw fail('Invalid models')
  const seen = new Set()
  for (const edit of args.models) {
    if (!edit || Object.keys(edit).some((key) => !['id', 'statement', 'annotation', 'examples'].includes(key)) || seen.has(edit.id)) throw fail('Invalid model edit')
    seen.add(edit.id)
    const model = store.findModel(kp, edit.id)
    const statement = text(edit.statement)
    const annotation = text(edit.annotation)
    if (!Array.isArray(edit.examples) || edit.examples.length > 100) throw fail('Too many examples')
    // Only personal, unverified examples are editable. All evidence stays untouched.
    const examples = edit.examples.map((e) => {
      if (!e || Object.keys(e).some((key) => !['input', 'output', 'polarity'].includes(key)) || !['pos', 'neg', undefined].includes(e.polarity)) throw fail('Invalid personal example')
      return { id: store.newId('personal'), input: text(e.input), output: text(e.output), polarity: e.polarity, tag: 'e', origin: 'user', checked: false, at: now().toISOString() }
    })
    const prev = model.targetMap.statement
    if (statement !== (prev?.text ?? '')) model.targetMap.statement = {
      text: statement, source: 'user', verified: true, entry: 'direct-edit', at: now().toISOString(),
      history: prev ? [...(prev.history ?? []), { text: prev.text, at: prev.at }] : [],
    }
    model.targetMap.annotation = annotation
    model.targetMap.examples = [...model.targetMap.examples.filter((e) => e.origin !== 'user' || e.tag === 'v' || e.checked), ...examples]
  }
  await saveKp({ cwd, now }, kp)
  return readTargetMap(cwd, kp.id)
}
