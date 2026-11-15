/**
 * Learner data under `<workspace>/.learn/`. Plain JSON / JSONL files so the
 * learner can read, back up, and diff them; every write is atomic (tmp + rename).
 * @module learn-anything/store
 */
import { mkdir, readFile, rename, writeFile, appendFile, readdir } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

export const DIR = '.learn'

const workspaceWrites = new Map()

/** Serialize a workspace's read-modify-write operations across sessions in this host. */
export function withWorkspaceWrite(cwd, operation) {
  const key = resolve(cwd)
  const result = (workspaceWrites.get(key) ?? Promise.resolve()).then(operation)
  // Keep the queue usable after a rejected operation, while returning its error to its caller.
  const tail = result.then(() => {}, () => {})
  workspaceWrites.set(key, tail)
  void tail.then(() => {
    if (workspaceWrites.get(key) === tail) workspaceWrites.delete(key)
  })
  return result
}

/** Paths of one workspace's learner store. */
export function paths(cwd) {
  const root = join(cwd, DIR)
  return {
    root,
    course: join(root, 'course.json'),
    kpDir: join(root, 'kp'),
    kp: (id) => join(root, 'kp', `${safeId(id)}.json`),
    verifications: join(root, 'verifications.jsonl'),
    diagnoses: join(root, 'diagnoses.jsonl'),
    reviews: join(root, 'reviews.json'),
    reminder: join(root, 'reminder.json'),
    materialsDir: join(root, 'materials'),
    material: (id) => join(root, 'materials', safeId(id)),
  }
}

/** Reject ids that could escape the store directory. */
export function safeId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(id) || id.startsWith('.')) {
    throw new Error(`invalid id ${JSON.stringify(id)}: use letters, digits, '.', '_' or '-'`)
  }
  return id
}

export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${randomBytes(2).toString('hex')}`
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw new Error(`cannot read ${file}: ${error.message}`)
  }
}

export async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  await rename(tmp, file)
}

export async function appendJsonl(file, value) {
  await mkdir(dirname(file), { recursive: true })
  await appendFile(file, JSON.stringify(value) + '\n', 'utf8')
}

export async function readJsonl(file) {
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  return text.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line))
}

export async function listKps(cwd) {
  const p = paths(cwd)
  let names
  try {
    names = await readdir(p.kpDir)
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const kps = []
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    kps.push(await readJson(join(p.kpDir, name)))
  }
  return kps
}

/** Load the course or fail with a message that tells the model what to do next. */
export async function requireCourse(cwd) {
  const course = await readJson(paths(cwd).course, null)
  if (!course) throw new Error('no course in this workspace yet: plan one and save it with course_save first')
  return course
}

export async function requireKp(cwd, kpId) {
  const kp = await readJson(paths(cwd).kp(kpId), null)
  if (!kp) throw new Error(`unknown knowledge point ${JSON.stringify(kpId)}: check course_get for valid ids`)
  return kp
}

export function findModel(kp, modelId) {
  const model = kp.models.find((m) => m.id === modelId)
  if (!model) {
    const ids = kp.models.map((m) => m.id).join(', ') || '(none — define them with kp_define_models)'
    throw new Error(`knowledge point ${kp.id} has no model ${JSON.stringify(modelId)}; models: ${ids}`)
  }
  return model
}
