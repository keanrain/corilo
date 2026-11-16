// Human-owned notes use authenticated UI actions, never model-authored tool arguments.
import { createHash } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import * as store from './store.js'
import { saveKp } from './tools/shared.js'
import { targetMapView, parseView } from './render.js'

const fail = (message, status = 400) => Object.assign(new Error(message), { status })
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export async function checkLearningPaths(cwd, kpId) {
  await store.validateStorePaths(cwd)
  const p = store.paths(cwd)
  if (kpId) store.safeId(kpId)
  if (await store.backend(cwd) !== 'legacy') return
  for (const path of [p.root, p.kpDir]) {
    const stat = await lstat(path)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('Linked learning data cannot be edited')
  }
  if (kpId) {
    const stat = await lstat(p.kp(kpId))
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw fail('Linked learning data cannot be edited')
  }
  // Both reading and saving return the evidence-backed map. Reject an unsafe
  // log before a save can write notes and then fail while preparing its receipt.
  try {
    const stat = await lstat(p.verifications)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw fail('Linked learning data cannot be edited')
  } catch (e) { if (e.code !== 'ENOENT') throw e }
}
export function readTargetMap(cwd, kpId) {
  return store.withWorkspaceRead(cwd, () => readTargetMapSnapshot(cwd, kpId))
}
async function readTargetMapSnapshot(cwd, kpId) {
  await checkLearningPaths(cwd, kpId)
  const kp = await store.requireKp(cwd, kpId)
  return { revision: hash(kp), view: parseView(targetMapView(kp, await store.readJsonl(store.paths(cwd).verifications))) }
}
function text(value, max = 10000) {
  if (typeof value !== 'string' || value.length > max) throw fail('Invalid note text')
  return value
}
export function saveTargetMap(cwd, args, now = () => new Date()) {
  return store.withWorkspaceWrite(cwd, () => saveTargetMapSnapshot(cwd, args, now))
}
async function saveTargetMapSnapshot(cwd, args, now) {
  await checkLearningPaths(cwd, args.kpId)
  const kp = await store.requireKp(cwd, args.kpId)
  if (typeof args.expected !== 'string' || args.expected !== hash(kp)) throw fail('Notes changed. Reopen the editor to load the latest version; your draft is retained.', 409)
  if (!Array.isArray(args.models) || args.models.length !== kp.models.length) throw fail('Invalid models')
  const verifications = await store.readJsonl(store.paths(cwd).verifications)
  const seen = new Set()
  for (const edit of args.models) {
    if (!edit || Object.keys(edit).some((key) => !['id', 'statement', 'annotation', 'examples'].includes(key)) || seen.has(edit.id)) throw fail('Invalid model edit')
    seen.add(edit.id)
    const model = store.findModel(kp, edit.id)
    const statement = text(edit.statement)
    const annotation = text(edit.annotation)
    if (!Array.isArray(edit.examples) || edit.examples.length > 100) throw fail('Too many examples')
    // Preserve existing example identity and metadata on an unrelated note edit.
    // IDs are accepted only for this model's editable personal examples; a
    // submitted ID can never replace a verified/material/other-model example.
    const personal = new Map(model.targetMap.examples.filter((e) => e.origin === 'user' && e.tag !== 'v' && !e.checked).map((e) => [e.id, e]))
    const used = new Set()
    const examples = edit.examples.map((e) => {
      if (!e || Object.keys(e).some((key) => !['id', 'input', 'output', 'polarity'].includes(key)) || !['pos', 'neg', undefined].includes(e.polarity)) throw fail('Invalid personal example')
      const input = text(e.input), output = text(e.output)
      let previous
      if (e.id !== undefined) {
        if (typeof e.id !== 'string' || used.has(e.id) || !personal.has(e.id)) throw fail('Invalid personal example id')
        used.add(e.id)
        previous = personal.get(e.id)
      }
      if (previous && input === previous.input && output === previous.output && e.polarity === previous.polarity) return previous
      const next = { ...(previous ?? {}), id: previous?.id ?? store.newId('personal'), input, output, polarity: e.polarity, tag: previous?.tag ?? 'e', origin: 'user', checked: false, at: now().toISOString() }
      // Changed text no longer carries an old explanation/citation as support.
      delete next.reasoning; delete next.source; delete next.sources
      return next
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
  return { revision: hash(kp), view: parseView(targetMapView(kp, verifications)) }
}
