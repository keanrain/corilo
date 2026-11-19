import {
  installQueryFunctions,
  queryTasks,
  queryTaskSummary,
  queryCalendar,
} from "./schedule-queries.mjs";
import { randomUUID, createHash } from "node:crypto";
import { TodoStore } from "./storage.mjs";
import { scheduleSchema } from "./schedule-schema.mjs";
import { fields, text, taskValue } from "./task-service.mjs";
import { fail, range, instant, Temporal } from "./date-values.mjs";
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
  static async open(root, options = {}) {
    const store = await TodoStore.open(root, {
      ...options,
      schemaDefinition: scheduleSchema,
      format: 2,
      StoreClass: ScheduleService,
    });
    installQueryFunctions(store.db);
    return store;
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
          this.scheduleReminder(next, kind, now, old);
          if (kind === "task" && old?.status !== next.status)
            for (const { data } of this.db
              .prepare(
                "SELECT data FROM records WHERE kind='event' AND json_extract(data, '$.taskId')=?",
              )
              .all(next.id))
              this.scheduleReminder(JSON.parse(data), "event", now);
          return next;
        }),
      args.signal,
    );
  }
  scheduleReminder(item, kind, now, old = null) {
    const enabled =
      item.reminderAt &&
      ["open", "active"].includes(item.status) &&
      !(
        kind === "event" &&
        item.taskId &&
        this.row("task", item.taskId).status !== "open"
      );
    const pending = this.db
      .prepare(
        "SELECT id, due_at FROM reminders WHERE owner_id=? AND state='pending'",
      )
      .all(item.id);
    // An ordinary edit must retain even an already-due job until the scanner
    // delivers it. Refresh its version/snapshot in the same business transaction.
    const retained = enabled
      ? pending.find(
          (job) => Temporal.Instant.compare(job.due_at, item.reminderAt) === 0,
        )
      : null;
    for (const job of pending) {
      if (job.id !== retained?.id)
        this.db
          .prepare("UPDATE reminders SET state='cancelled' WHERE id=?")
          .run(job.id);
    }
    if (retained) {
      this.db
        .prepare("UPDATE reminders SET revision=?, snapshot=? WHERE id=?")
        .run(item.version, JSON.stringify({ kind, ...item }), retained.id);
      return;
    }
    if (!enabled || Temporal.Instant.compare(item.reminderAt, now) <= 0) return;
    // Do not replay a previously delivered reminder on unrelated edits,
    // including when the machine clock moves backwards.
    if (old?.reminderAt === item.reminderAt && old.status === item.status)
      return;
    this.db
      .prepare("INSERT INTO reminders VALUES (?,?,?,?,'pending',?)")
      .run(
        randomUUID(),
        item.id,
        item.version,
        item.reminderAt,
        JSON.stringify({ kind, ...item }),
      );
  }
  async tasks(args = {}) {
    await this.check();
    return queryTasks(this, args);
  }
  async taskSummary(args) {
    await this.check();
    return queryTaskSummary(this, args);
  }
  async calendar(args) {
    await this.check();
    return queryCalendar(this, args);
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
