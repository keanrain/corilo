/**
 * Daily「今日复习 N 项」reminder over dsh-schedule. One reminder per workspace: its
 * Session binding is kept in the selected `.learn/` store, so learning in several Sessions
 * does not stack reminders. Without the Schedule service none of this is mounted.
 * @module learn-anything/reminder
 */
import * as store from './store.js'
import { resolve } from 'node:path'

export const REMINDER_TITLE = '今日复习'
export const REMINDER_PROMPT =
  '每日复习提醒：调用 review_due，只用一两句话告诉学习者「今日复习 N 项」（N 为到期项数；没有到期项就说今天没有要复习的），' +
  '并问是否现在开始。提到某一项是什么时候学的，只用 review_due 给出的上次答题时间（如「12 分钟前」「昨天」），' +
  '不要自己推测。不要开始新内容，全程用中文，不要描述你的推理。'

/** `HH:MM` or `HH:MM:SS` → the `HH:MM:SS` dsh-schedule expects. */
export function dailyAt(time, timeZone) {
  if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(time)) throw new Error(`time must be HH:MM, got ${JSON.stringify(time)}`)
  return { time: time.length === 5 ? `${time}:00` : time, time_zone: timeZone }
}

/**
 * @param schedule - the dsh-schedule service (`create`, `catalog`, `edit`)
 * @param defaults - `{ time, timeZone }` for a reminder created implicitly
 */
export function createReminders(schedule, defaults) {
  // This queue guards native service side effects, outside learner transaction
  // contexts. Timers created by the host must not inherit a completed snapshot.
  const pending = new Map()
  const queue = (cwd, operation) => {
    const key = resolve(cwd)
    const result = (pending.get(key) ?? Promise.resolve()).then(operation)
    const tail = result.then(() => {}, () => {})
    pending.set(key, tail)
    void tail.then(() => { if (pending.get(key) === tail) pending.delete(key) })
    return result
  }
  return {
    /**
     * Create the workspace's first reminder automatically. An explicit time sets or
     * restores it; automatic checks respect tasks paused, ended, or deleted by the user.
     */
    ensure(cwd, sessionId, time) {
      return queue(cwd, async () => {
        const saved = await store.withWorkspaceRead(cwd, () => store.readJson(store.paths(cwd).reminder, null))
        const existing = saved ? (await schedule.catalog()).find((e) => e.id === saved.id) : null
        if (!time && saved) return existing ?? null
        if (!existing) {
          const record = await schedule.create({ title: REMINDER_TITLE, prompt: REMINDER_PROMPT,
            timing: { kind: 'daily', daily: dailyAt(time ?? defaults.time, defaults.timeZone) },
            target: { kind: 'session', sessionId } }, sessionId)
          await store.withWorkspaceWrite(cwd, () => store.writeJson(store.paths(cwd).reminder, { sessionId, id: record.id }))
          return record
        }
        const record = await schedule.edit({ id: existing.id, action: 'update', expectedUpdatedAt: existing.updatedAt ?? null,
          patch: { timing: { kind: 'daily', daily: dailyAt(time, existing.timeZone) }, active: true } }, sessionId)
        if ('code' in record) throw new Error(record.code)
        return record
      })
    },
  }
}
