import { createHash } from "node:crypto";
import {
  fields,
  text,
  classifyWithSchedule,
  summarizeBlocks,
  taskClock,
} from "./task-service.mjs";
import {
  fail,
  zone,
  instant,
  dayAt,
  dayStart,
  Temporal,
} from "./date-values.mjs";
const PAGE_SIZE = 100;
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
function cursorValue(cursor, filter) {
  if (cursor == null) return null;
  try {
    if (typeof cursor !== "string" || cursor.length > 4096) throw 0;
    const value = JSON.parse(Buffer.from(cursor, "base64url"));
    if (value.filter !== filter) throw 0;
    return value;
  } catch {
    throw fail("分页或筛选已改变，请刷新");
  }
}
function snapshot(db, operation) {
  db.exec("BEGIN");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
const metadataSql = `SELECT id,version,json_extract(data,'$.createdAt') createdAt,
 json_extract(data,'$.plannedDate') plannedDate,json_extract(data,'$.due') due,
 json_extract(data,'$.priority') priority,json_extract(data,'$.list') list FROM records`;
const blockSql = `SELECT json_extract(data,'$.taskId') taskId,json_extract(data,'$.allDay') allDay,
 json_extract(data,'$.start') start,json_extract(data,'$.end') end, 'active' status FROM records
 WHERE kind='event' AND json_extract(data,'$.status')='active' AND json_extract(data,'$.taskId') IS NOT NULL`;
function schedules(db, ids, timeZone, now, clock) {
  const wanted = new Set(ids),
    grouped = new Map();
  // One streamed metadata scan, never a scan for each task or a load of bodies.
  for (const block of db.prepare(blockSql).iterate())
    if (wanted.has(block.taskId)) {
      const blocks = grouped.get(block.taskId) ?? [];
      blocks.push(block);
      grouped.set(block.taskId, blocks);
    }
  return new Map(
    [...grouped].map(([id, blocks]) => [
      id,
      summarizeBlocks(blocks, timeZone, now, clock),
    ]),
  );
}
const emptySchedule = { scheduled: false, upcoming: false, future: null };
function classify(item, groups, timeZone, now, clock) {
  return {
    ...item,
    classification: classifyWithSchedule(
      item,
      groups.get(item.id) ?? emptySchedule,
      timeZone,
      now,
      clock,
    ),
  };
}
export function queryTasks(store, args = {}) {
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
  if (!["inbox", "today", "future", "all", "done", "cancelled"].includes(view))
    throw fail("任务视图无效");
  text(query, 256);
  text(list, 100);
  if (priority && !["normal", "high", "urgent"].includes(priority))
    throw fail("优先级无效");
  zone(timeZone);
  const now = instant(args.now ?? new Date().toISOString());
  const clock = taskClock(timeZone, now);
  const filter = hash({
      identity: store.identity,
      view,
      query,
      list,
      priority,
      timeZone,
      day: dayAt(now, timeZone),
    }),
    anchor = cursorValue(cursor, filter);
  const status = ["done", "cancelled"].includes(view) ? view : "open";
  const where = `kind='task' AND json_extract(data,'$.status')=?
 AND (?='' OR json_extract(data,'$.list')=?) AND (?='' OR json_extract(data,'$.priority')=?)
 AND (?='' OR instr(corilo_casefold(json_extract(data,'$.title') || char(10) || json_extract(data,'$.body')),corilo_casefold(?))>0)`;
  const params = [status, list, list, priority, priority, query, query];
  return snapshot(store.db, () => {
    if (["all", "done", "cancelled"].includes(view)) {
      if (
        anchor &&
        (typeof anchor.at !== "string" ||
          typeof anchor.id !== "string" ||
          anchor.mode !== "keyset")
      )
        throw fail("分页游标无效");
      const total = store.db
        .prepare(`SELECT count(*) n FROM records WHERE ${where}`)
        .get(...params).n;
      const rows = store.db
        .prepare(
          `SELECT data FROM records WHERE ${where}
       AND (? IS NULL OR json_extract(data,'$.createdAt')<? OR (json_extract(data,'$.createdAt')=? AND id>?))
       ORDER BY json_extract(data,'$.createdAt') DESC,id ASC LIMIT ?`,
        )
        .all(
          ...params,
          anchor?.at ?? null,
          anchor?.at ?? null,
          anchor?.at ?? null,
          anchor?.id ?? null,
          PAGE_SIZE + 1,
        );
      const page = rows.slice(0, PAGE_SIZE).map((r) => JSON.parse(r.data));
      const groups = schedules(
          store.db,
          page.map((t) => t.id),
          timeZone,
          now,
          clock,
        ),
        last = page.at(-1);
      return {
        items: page.map((t) => classify(t, groups, timeZone, now, clock)),
        total,
        counts: {},
        nextCursor:
          rows.length > PAGE_SIZE
            ? encode({
                filter,
                mode: "keyset",
                at: last.createdAt,
                id: last.id,
              })
            : null,
      };
    }
    // Derived date views need per-task timezone semantics. Keep only projection
    // fields in JS and fetch full JSON for the resulting page, at most 100 rows.
    const candidates = store.db
      .prepare(`${metadataSql} WHERE ${where}`)
      .all(...params)
      .map((t) => ({ ...t, due: t.due ? JSON.parse(t.due) : null }));
    const groups = schedules(
      store.db,
      candidates.map((t) => t.id),
      timeZone,
      now,
      clock,
    );
    const items = candidates
      .map((t) => classify(t, groups, timeZone, now, clock))
      .filter((t) =>
        view === "inbox"
          ? t.classification.inbox
          : view === "today"
            ? t.classification.group
            : t.classification.future,
      );
    const rank = { 逾期截止: 0, 今日安排: 1, 此前计划未完成: 2 },
      priorities = { urgent: 0, high: 1, normal: 2 };
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
            ) || priorities[a.priority] - priorities[b.priority]
          : 0) ||
        b.createdAt.localeCompare(a.createdAt) ||
        a.id.localeCompare(b.id),
    );
    // Include schedule-derived ordering so event edits cannot silently corrupt a
    // cursor even when the corresponding task version did not change.
    const revision = hash(
      items.map((t) => [t.id, t.version, t.classification]),
    );
    let offset = 0;
    if (anchor) {
      if (
        anchor.mode !== "derived" ||
        anchor.revision !== revision ||
        !Number.isSafeInteger(anchor.offset) ||
        anchor.offset < 0
      )
        throw fail("列表已改变，请刷新");
      offset = anchor.offset;
    }
    const counts = {};
    for (const t of items)
      if (t.classification.group)
        counts[t.classification.group] =
          (counts[t.classification.group] ?? 0) + 1;
    const read = store.db.prepare(
      "SELECT data FROM records WHERE kind='task' AND id=?",
    );
    return {
      items: items.slice(offset, offset + PAGE_SIZE).map((t) => ({
        ...JSON.parse(read.get(t.id).data),
        classification: t.classification,
      })),
      total: items.length,
      counts,
      nextCursor:
        offset + PAGE_SIZE < items.length
          ? encode({
              filter,
              mode: "derived",
              revision,
              offset: offset + PAGE_SIZE,
            })
          : null,
    };
  });
}
// Sidebar counts: open tasks per smart view (same rules as the views) and per
// named list. Read-only; computed from the same queries the views use.
export function queryTaskSummary(store, args = {}) {
  fields(args, ["timeZone", "now"]);
  const timeZone = args.timeZone ?? "UTC";
  zone(timeZone);
  const base = { timeZone, ...(args.now ? { now: args.now } : {}) };
  const views = {};
  for (const view of ["inbox", "today", "future", "all"])
    views[view] = queryTasks(store, { ...base, view }).total;
  const lists = store.db
    .prepare(
      `SELECT json_extract(data,'$.list') name, count(*) count FROM records
 WHERE kind='task' AND json_extract(data,'$.status')='open' AND json_extract(data,'$.list')<>''
 GROUP BY name ORDER BY name`,
    )
    .all()
    .map((r) => ({ name: r.name, count: r.count }));
  return { views, lists };
}
export function queryCalendar(store, args) {
  fields(args, ["start", "end", "timeZone"]);
  zone(args.timeZone);
  const start = instant(args.start),
    end = instant(args.end);
  const startMs = Temporal.Instant.from(start).epochMilliseconds,
    endMs = Temporal.Instant.from(end).epochMilliseconds;
  if (endMs <= startMs || endMs - startMs > 367 * 86400000)
    throw fail("日历查询范围需在一年以内");
  return snapshot(store.db, () => {
    const rows = store.db
      .prepare(
        `SELECT data FROM records WHERE kind='event' AND json_extract(data,'$.status')='active'
    AND (CASE WHEN json_extract(data,'$.allDay') THEN corilo_day_start(json_extract(data,'$.end'),json_extract(data,'$.timeZone')) ELSE corilo_instant(json_extract(data,'$.end')) END)>?
    AND (CASE WHEN json_extract(data,'$.allDay') THEN corilo_day_start(json_extract(data,'$.start'),json_extract(data,'$.timeZone')) ELSE corilo_instant(json_extract(data,'$.start')) END)<? LIMIT 2001`,
      )
      .all(startMs, endMs);
    if (rows.length > 2000) throw fail("日程过多，请缩小查询范围", 413);
    const tasks = store.db
      .prepare(
        `SELECT data FROM records WHERE kind='task' AND json_extract(data,'$.status')='open' AND json_extract(data,'$.due') IS NOT NULL
    AND (CASE WHEN json_extract(data,'$.due.kind')='date' THEN corilo_day_start(json_extract(data,'$.due.date'),?) ELSE corilo_instant(json_extract(data,'$.due.at')) END)>=?
    AND (CASE WHEN json_extract(data,'$.due.kind')='date' THEN corilo_day_start(json_extract(data,'$.due.date'),?) ELSE corilo_instant(json_extract(data,'$.due.at')) END)<? LIMIT ?`,
      )
      .all(args.timeZone, startMs, args.timeZone, endMs, 2001 - rows.length);
    if (rows.length + tasks.length > 2000)
      throw fail("日程及截止过多，请缩小查询范围", 413);
    return {
      items: rows.map((r) => JSON.parse(r.data)),
      tasks: tasks.map((r) => JSON.parse(r.data)),
    };
  });
}
export function installQueryFunctions(db) {
  db.function("corilo_casefold", { deterministic: true }, (value) =>
    String(value ?? "").toLowerCase(),
  );
  db.function(
    "corilo_instant",
    { deterministic: true },
    (value) => Temporal.Instant.from(value).epochMilliseconds,
  );
  db.function(
    "corilo_day_start",
    { deterministic: true },
    (value, timeZone) =>
      Temporal.Instant.from(dayStart(value, timeZone)).epochMilliseconds,
  );
}
