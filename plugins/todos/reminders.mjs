import { instant, Temporal, fail } from "./date-values.mjs";
export async function scanReminders(store, now = new Date().toISOString()) {
  now = instant(now);
  await store.check();
  return store.transaction(() => {
    let count = 0;
    for (const job of store.db
      .prepare(
        "SELECT * FROM reminders WHERE state='pending' AND julianday(due_at)<=julianday(?) ORDER BY due_at",
      )
      .all(now)) {
      const snapshot = JSON.parse(job.snapshot);
      const owner = store.row(snapshot.kind, job.owner_id);
      const valid =
        owner.version === job.revision &&
        ["open", "active"].includes(owner.status) &&
        !(
          snapshot.kind === "event" &&
          owner.taskId &&
          store.row("task", owner.taskId).status !== "open"
        );
      if (valid) {
        const late =
          Temporal.Instant.from(now).epochMilliseconds -
          Temporal.Instant.from(job.due_at).epochMilliseconds;
        store.db
          .prepare(
            "INSERT OR IGNORE INTO notifications VALUES (?,?,NULL,?,?,?)",
          )
          .run(
            job.id,
            now,
            late > 86400000 ? now : null,
            late > 60000 ? 1 : 0,
            job.snapshot,
          );
        count++;
      }
      store.db
        .prepare("UPDATE reminders SET state=? WHERE id=?")
        .run(valid ? "delivered" : "cancelled", job.id);
    }
    return { count };
  });
}
export async function notifications(
  store,
  { offset = 0, unread = false } = {},
) {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    typeof unread !== "boolean"
  )
    throw fail("提醒查询无效");
  await scanReminders(store);
  const rows = store.db
    .prepare(
      "SELECT * FROM notifications WHERE (?=0 OR read_at IS NULL) ORDER BY created_at DESC,id LIMIT 101 OFFSET ?",
    )
    .all(unread ? 1 : 0, offset);
  return {
    items: rows
      .slice(0, 100)
      .map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        readAt: r.read_at,
        missed: Boolean(r.missed),
        source: JSON.parse(r.snapshot),
      })),
    nextOffset: rows.length > 100 ? offset + 100 : null,
  };
}
export async function readNotification(store, id) {
  if (typeof id !== "string" || id.length > 40) throw fail("提醒标识无效");
  await store.check();
  return store.transaction(() => {
    const result = store.db
      .prepare(
        "UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=?",
      )
      .run(new Date().toISOString(), id);
    if (!result.changes) throw fail("提醒不存在", 404);
    return { id };
  });
}
export async function claimNotifications(store) {
  await scanReminders(store);
  return store.transaction(() => {
    const rows = store.db
      .prepare(
        "SELECT * FROM notifications WHERE claimed_at IS NULL AND read_at IS NULL ORDER BY created_at,id LIMIT 100",
      )
      .all();
    for (const r of rows)
      store.db
        .prepare("UPDATE notifications SET claimed_at=? WHERE id=?")
        .run(new Date().toISOString(), r.id);
    // A claim is at-most-once delivery attempt; a closed/crashed tab is not retried.
    return {
      items: rows.map((r) => ({ id: r.id, source: JSON.parse(r.snapshot) })),
      hasMore: rows.length === 100,
    };
  });
}
export function startReminders(store, onError = () => {}) {
  const scan = () => scanReminders(store).catch(onError);
  void scan();
  const timer = setInterval(scan, 30000);
  timer.unref?.();
  return () => clearInterval(timer);
}
