import { randomUUID, createHash } from "node:crypto";
import { TodoStore } from "./storage.mjs";
import { scheduleSchema } from "./schedule-schema.mjs";
import { fields, text, taskValue, classify } from "./task-service.mjs";
import {
  fail,
  range,
  zone,
  instant,
  dayStart,
  dayAt,
  Temporal,
} from "./date-values.mjs";
const uuid = (value) => {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw fail("标识必须为 UUID v4");
  return value.toLowerCase();
};
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const digest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
const clean = (item) =>
  Object.fromEntries(
    Object.entries(item).filter(
      ([k]) =>
        ![
          "id",
          "version",
          "createdAt",
          "updatedAt",
          "completedAt",
          "cancelledAt",
          "classification",
        ].includes(k),
    ),
  );
function eventValue(value) {
  fields(value, [
    "title",
    "body",
    "status",
    "allDay",
    "start",
    "end",
    "timeZone",
    "taskId",
    "location",
    "reminderAt",
  ]);
  const status = value.status ?? "active";
  if (!["active", "cancelled"].includes(status)) throw fail("日程状态无效");
  return {
    title: text(value.title, 200, true),
    body: text(value.body ?? "", 20000),
    status,
    ...range(value),
    taskId: value.taskId == null ? null : uuid(value.taskId),
    location: text(value.location ?? "", 200),
    reminderAt: value.reminderAt == null ? null : instant(value.reminderAt),
  };
}
export class ScheduleService extends TodoStore {
  static open(root, options = {}) {
    return TodoStore.open(root, {
      ...options,
      schemaDefinition: scheduleSchema,
      format: 2,
      StoreClass: ScheduleService,
    });
  }
  row(kind, id) {
    const row = this.db
      .prepare("SELECT data FROM records WHERE id=? AND kind=?")
      .get(uuid(id), kind);
    if (!row) throw fail("记录不存在", 404);
    return JSON.parse(row.data);
  }
  all(kind) {
    return this.db
      .prepare("SELECT data FROM records WHERE kind=? ORDER BY id")
      .all(kind)
      .map((r) => JSON.parse(r.data));
  }
  async read(kind, id) {
    await this.check();
    return this.row(kind, id);
  }
  async request(id) {
    await this.check();
    const row = this.db
      .prepare("SELECT result FROM receipts WHERE request_id=?")
      .get(uuid(id));
    return row
      ? { found: true, value: JSON.parse(row.result) }
      : { found: false };
  }
  async mutate(kind, args) {
    fields(args, ["requestId", "id", "expected", "patch", "value", "signal"]);
    if (!["task", "event"].includes(kind)) throw fail("记录类型无效");
    const updating = args.id !== undefined;
    if (
      updating
        ? args.value !== undefined ||
          !Number.isSafeInteger(args.expected) ||
          args.expected < 1 ||
          !args.patch ||
          !Object.keys(args.patch).length
        : args.patch !== undefined || args.expected !== undefined || !args.value
    )
      throw fail("写入格式无效");
    const request = uuid(args.requestId),
      hash = digest({
        kind,
        id: args.id ?? null,
        expected: args.expected ?? null,
        value: args.value ?? args.patch,
      });
    await this.check();
    return this.transaction(
      () =>
        this.receipt(request, hash, () => {
          const old = updating ? this.row(kind, args.id) : null;
          if (old && old.version !== args.expected)
            throw fail("记录已有更新，请核对最新版本；输入已保留", 409);
          const value = (kind === "task" ? taskValue : eventValue)({
            ...(old ? clean(old) : {}),
            ...(args.value ?? args.patch),
          });
          if (kind === "event" && value.taskId) this.row("task", value.taskId);
          const now = new Date().toISOString();
          const next = {
            ...value,
            id: old?.id ?? randomUUID(),
            version: (old?.version ?? 0) + 1,
            createdAt: old?.createdAt ?? now,
            updatedAt: now,
          };
          if (kind === "task") {
            next.completedAt =
              value.status === "done"
                ? old?.status === "done"
                  ? old.completedAt
                  : now
                : null;
            next.cancelledAt =
              value.status === "cancelled"
                ? old?.status === "cancelled"
                  ? old.cancelledAt
                  : now
                : null;
          }
          this.db
            .prepare(
              "INSERT INTO records VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,data=excluded.data",
            )
            .run(next.id, kind, next.version, JSON.stringify(next));
          this.scheduleReminder(next, kind, now);
          if (kind === "task")
            for (const e of this.all("event").filter(
              (e) => e.taskId === next.id,
            ))
              this.scheduleReminder(e, "event", now);
          return next;
        }),
      args.signal,
    );
  }
  scheduleReminder(item, kind, now) {
    this.db
      .prepare(
        "UPDATE reminders SET state='cancelled' WHERE owner_id=? AND state='pending'",
      )
      .run(item.id);
    if (
      !item.reminderAt ||
      !["open", "active"].includes(item.status) ||
      (kind === "event" &&
        item.taskId &&
        this.row("task", item.taskId).status !== "open")
    )
      return;
    // A change/restoration schedules only future reminders, never replays history.
    if (Temporal.Instant.compare(item.reminderAt, now) <= 0) return;
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO reminders VALUES (?,?,?,?,'pending',?)")
      .run(
        id,
        item.id,
        item.version,
        item.reminderAt,
        JSON.stringify({ kind, ...item }),
      );
  }
  async tasks(args = {}) {
    fields(args, [
      "view",
      "query",
      "list",
      "priority",
      "cursor",
      "timeZone",
      "now",
    ]);
    const {
      view = "all",
      query = "",
      list = "",
      priority = "",
      cursor = null,
      timeZone = "UTC",
    } = args;
    if (
      !["inbox", "today", "future", "all", "done", "cancelled"].includes(view)
    )
      throw fail("任务视图无效");
    text(query, 256);
    text(list, 100);
    if (priority && !["normal", "high", "urgent"].includes(priority))
      throw fail("优先级无效");
    zone(timeZone);
    const now = instant(args.now ?? new Date().toISOString());
    await this.check();
    const events = this.all("event");
    let items = this.all("task")
      .map((t) => ({
        ...t,
        classification: classify(t, events, timeZone, now),
      }))
      .filter(
        (t) =>
          (["done", "cancelled"].includes(view)
            ? t.status === view
            : t.status === "open") &&
          (!list || t.list === list) &&
          (!priority || t.priority === priority) &&
          (t.title + "\n" + t.body)
            .toLowerCase()
            .includes(query.toLowerCase()) &&
          (view === "inbox"
            ? t.classification.inbox
            : view === "today"
              ? t.classification.group
              : view === "future"
                ? t.classification.future
                : true),
      );
    const rank = { 逾期截止: 0, 今日安排: 1, 此前计划未完成: 2 };
    items.sort(
      (a, b) =>
        (view === "today"
          ? rank[a.classification.group] - rank[b.classification.group]
          : view === "future"
            ? a.classification.future.localeCompare(b.classification.future)
            : 0) ||
        (view === "today"
          ? (a.due?.kind === "instant" ? a.due.at : "~").localeCompare(
              b.due?.kind === "instant" ? b.due.at : "~",
            ) ||
            { urgent: 0, high: 1, normal: 2 }[a.priority] -
              { urgent: 0, high: 1, normal: 2 }[b.priority]
          : 0) ||
        b.createdAt.localeCompare(a.createdAt) ||
        a.id.localeCompare(b.id),
    );
    const filter = digest({
      identity: this.identity,
      view,
      query,
      list,
      priority,
      timeZone,
      day: dayAt(now, timeZone),
      snapshot: items.map((item) => [item.id, item.version]),
    });
    let offset = 0;
    if (cursor !== null) {
      try {
        if (typeof cursor !== "string" || cursor.length > 1024) throw 0;
        const c = JSON.parse(Buffer.from(cursor, "base64url"));
        if (
          c.filter !== filter ||
          !Number.isSafeInteger(c.offset) ||
          c.offset < 0
        )
          throw 0;
        offset = c.offset;
      } catch {
        throw fail("分页或筛选已改变，请刷新");
      }
    }
    const total = items.length,
      counts = {};
    for (const t of items) {
      const g = t.classification.group;
      if (g) counts[g] = (counts[g] ?? 0) + 1;
    }
    return {
      items: items.slice(offset, offset + 100),
      total,
      counts,
      nextCursor:
        offset + 100 < total
          ? Buffer.from(
              JSON.stringify({ filter, offset: offset + 100 }),
            ).toString("base64url")
          : null,
    };
  }
  async calendar(args) {
    fields(args, ["start", "end", "timeZone"]);
    zone(args.timeZone);
    const start = instant(args.start),
      end = instant(args.end);
    const duration =
      Temporal.Instant.from(end).epochMilliseconds -
      Temporal.Instant.from(start).epochMilliseconds;
    if (duration <= 0 || duration > 367 * 86400000)
      throw fail("日历查询范围需在一年以内");
    await this.check();
    const items = this.all("event").filter(
      (e) =>
        e.status === "active" &&
        Temporal.Instant.compare(
          e.allDay ? dayStart(e.end, e.timeZone) : e.end,
          start,
        ) > 0 &&
        Temporal.Instant.compare(
          e.allDay ? dayStart(e.start, e.timeZone) : e.start,
          end,
        ) < 0,
    );
    if (items.length > 2000) throw fail("日程过多，请缩小查询范围", 413);
    const tasks = this.all("task").filter((t) => {
      if (t.status !== "open" || !t.due) return false;
      const at =
        t.due.kind === "date" ? dayStart(t.due.date, args.timeZone) : t.due.at;
      return (
        Temporal.Instant.compare(at, start) >= 0 &&
        Temporal.Instant.compare(at, end) < 0
      );
    });
    if (items.length + tasks.length > 2000)
      throw fail("日程及截止过多，请缩小查询范围", 413);
    return { items, tasks };
  }
  async export() {
    await this.check();
    const value = {
      format: "corilo-schedule-v2",
      exportedAt: new Date().toISOString(),
      tasks: this.all("task"),
      events: this.all("event"),
    };
    if (Buffer.byteLength(JSON.stringify(value)) > 8 * 1024 * 1024)
      throw fail("导出超过 8 MiB", 413);
    return value;
  }
}
