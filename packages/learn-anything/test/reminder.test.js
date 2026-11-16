import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createReminders, dailyAt, REMINDER_TITLE } from '../src/host/reminder.js'
import * as store from '../src/host/store.js'

/** In-memory stand-in for the dsh-schedule service, daily tasks only. */
function fakeSchedule() {
  const rows = []
  let n = 0
  return {
    rows,
    async create(req, sessionId) {
      assert.equal(req.timing.kind, 'daily')
      assert.deepEqual(req.target, { kind: 'session', sessionId })
      const r = { id: `s${++n}`, kind: 'daily', title: req.title, prompt: req.prompt, time: `${req.timing.daily.time}.000`, timeZone: req.timing.daily.time_zone, scheduledAt: '2026-10-21T12:00:00.000Z', target: req.target, status: 'active', updatedAt: '2026-10-20T00:00:00.000Z' }
      rows.push(r)
      return r
    },
    async catalog() { return rows.map((r) => ({ ...r })) },
    async edit({ id, action, expectedUpdatedAt, patch }, actorSessionId) {
      const row = rows.find((r) => r.id === id)
      if (!row) return { id, code: 'schedule_not_found' }
      assert.ok(actorSessionId)
      assert.equal(action, 'update')
      assert.equal(expectedUpdatedAt, row.updatedAt)
      row.time = `${patch.timing.daily.time}.000`
      row.status = patch.active ? 'active' : 'paused'
      return { ...row }
    },
  }
}

test('dailyAt validates and pads the time', () => {
  assert.deepEqual(dailyAt('07:30', 'Asia/Shanghai'), { time: '07:30:00', time_zone: 'Asia/Shanghai' })
  assert.throws(() => dailyAt('7:30', 'UTC'), /HH:MM/)
  assert.throws(() => dailyAt('24:00', 'UTC'), /HH:MM/)
})

test('one reminder per workspace, movable from any session through the Host task API', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'learn-'))
  try {
    const schedule = fakeSchedule()
    const reminders = createReminders(schedule, { time: '20:00', timeZone: 'Asia/Shanghai' })
    const first = await reminders.ensure(cwd, 'sess-a')
    assert.equal(first.title, REMINDER_TITLE)
    assert.equal(first.time, '20:00:00.000')
    await reminders.ensure(cwd, 'sess-a')
    await reminders.ensure(cwd, 'sess-b')
    assert.equal(schedule.rows.length, 1, 'learning in another session does not stack reminders')

    const moved = await reminders.ensure(cwd, 'sess-b', '07:30')
    assert.equal(moved.time, '07:30:00.000')
    assert.equal(schedule.rows[0].target.sessionId, 'sess-a', 'editing keeps the delivery destination')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('automatic checks preserve paused, ended, and deleted reminders; an explicit time can restore them', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'learn-'))
  try {
    const schedule = fakeSchedule()
    const reminders = createReminders(schedule, { time: '20:00', timeZone: 'Asia/Shanghai' })
    const first = await reminders.ensure(cwd, 'sess-a')
    for (const status of ['paused', 'ended']) {
      schedule.rows[0].status = status
      const retained = await reminders.ensure(cwd, 'sess-b')
      assert.equal(retained.status, status)
      assert.equal(schedule.rows.length, 1)
      const restored = await reminders.ensure(cwd, 'sess-b', '07:30')
      assert.equal(restored.id, first.id)
      assert.equal(restored.status, 'active')
    }
    schedule.rows.length = 0
    assert.equal(await reminders.ensure(cwd, 'sess-b'), null, 'a deleted reminder is not recreated after an answer')
    assert.equal(schedule.rows.length, 0)
    const replacement = await reminders.ensure(cwd, 'sess-b', '08:00')
    assert.notEqual(replacement.id, first.id)
    assert.equal(replacement.target.sessionId, 'sess-b')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('a concurrent reminder edit fails without overwriting the task', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'learn-'))
  try {
    const schedule = fakeSchedule()
    const reminders = createReminders(schedule, { time: '20:00', timeZone: 'UTC' })
    await reminders.ensure(cwd, 'sess-a')
    schedule.edit = async () => ({ code: 'schedule_conflict' })
    await assert.rejects(reminders.ensure(cwd, 'sess-b', '07:30'), /schedule_conflict/)
    assert.equal(schedule.rows[0].time, '20:00:00.000')
  } finally { await rm(cwd, { recursive: true, force: true }) }
})

test('the reminder prompt points the tutor at review_due\'s real timing', async () => {
  const { REMINDER_PROMPT } = await import('../src/host/reminder.js')
  assert.match(REMINDER_PROMPT, /review_due/)
  assert.match(REMINDER_PROMPT, /上次答题时间/)
})

const deferred = () => {
  let resolve
  const promise = new Promise((yes) => { resolve = yes })
  return { promise, resolve }
}
const nextTurn = () => new Promise((resolve) => setImmediate(resolve))
const defaults = { time: '20:00', timeZone: 'UTC' }
async function sqlWorkspace(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'learn-reminder-queue-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  await store.writeJson(store.paths(cwd).course, { goal: 'reminder queue', chapters: [] })
  return cwd
}

test('separate agent helpers share a workspace queue even with distinct service wrappers', async (t) => {
  const cwd = await sqlWorkspace(t)
  const schedule = fakeSchedule(), entered = deferred(), release = deferred()
  const create = schedule.create.bind(schedule)
  let creates = 0
  schedule.create = async (...args) => { creates++; entered.resolve(); await release.promise; return create(...args) }
  const first = createReminders({ ...schedule }, defaults).ensure(cwd, 'session-a')
  await entered.promise
  // Harness may expose a different scoped service object to each Agent.
  const second = createReminders({ ...schedule }, defaults).ensure(join(cwd, '.'), 'session-b')
  await nextTurn()
  const createsBeforeRelease = creates
  release.resolve()
  const [a, b] = await Promise.all([first, second])
  assert.equal(createsBeforeRelease, 1, 'the second helper must wait until the first binding is stored')
  assert.equal(schedule.rows.length, 1)
  assert.equal(a.id, b.id)
  assert.deepEqual(await store.readJson(store.paths(cwd).reminder, null), { sessionId: 'session-a', id: a.id })
})

test('a failed helper operation releases the shared queue for another agent', async (t) => {
  const cwd = await sqlWorkspace(t)
  const schedule = fakeSchedule(), entered = deferred(), release = deferred()
  const create = schedule.create.bind(schedule)
  let creates = 0
  schedule.create = async (...args) => {
    if (++creates === 1) { entered.resolve(); await release.promise; throw new Error('native schedule unavailable') }
    return create(...args)
  }
  const failed = createReminders(schedule, defaults).ensure(cwd, 'session-a')
  const rejected = assert.rejects(failed, /native schedule unavailable/)
  await entered.promise
  const after = createReminders({ ...schedule }, defaults).ensure(cwd, 'session-b')
  release.resolve()
  await rejected
  const record = await after
  assert.equal(creates, 2)
  assert.equal(schedule.rows.length, 1)
  assert.deepEqual(await store.readJson(store.paths(cwd).reminder, null), { sessionId: 'session-b', id: record.id })
})

test('a blocked workspace does not block reminder creation for another workspace', async (t) => {
  const firstWorkspace = await sqlWorkspace(t), secondWorkspace = await sqlWorkspace(t)
  const firstSchedule = fakeSchedule(), entered = deferred(), release = deferred()
  const create = firstSchedule.create.bind(firstSchedule)
  firstSchedule.create = async (...args) => { entered.resolve(); await release.promise; return create(...args) }
  const first = createReminders(firstSchedule, defaults).ensure(firstWorkspace, 'session-a')
  await entered.promise
  const secondSchedule = fakeSchedule()
  const second = createReminders(secondSchedule, defaults).ensure(secondWorkspace, 'session-b')
  let timeout
  try {
    const record = await Promise.race([
      second,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('another workspace waited behind the blocked workspace')), 2000) }),
    ])
    assert.equal(secondSchedule.rows.length, 1)
    assert.equal(record.target.sessionId, 'session-b')
    assert.equal(firstSchedule.rows.length, 0, 'first workspace remains held while the second completes')
  } finally { clearTimeout(timeout); release.resolve(); await Promise.allSettled([first, second]) }
})
