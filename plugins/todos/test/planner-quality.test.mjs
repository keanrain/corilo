import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { ScheduleService } from "../schedule-service.mjs";
import { scanReminders, notifications } from "../reminders.mjs";
async function fixture(t) {
  const root = await mkdtemp("/tmp/corilo-quality-");
  const store = await ScheduleService.open(root);
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true });
  });
  return store;
}
const create = (s, value, kind = "task") =>
  s.mutate(kind, { requestId: randomUUID(), value });
const update = (s, item, patch, kind = "task") =>
  s.mutate(kind, {
    requestId: randomUUID(),
    id: item.id,
    expected: item.version,
    patch,
  });
const start = Date.parse("2026-11-15T00:00:00Z");
test("ordinary edit after due but before scan retains reminder, revision and receipt", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: start });
  const s = await fixture(t);
  const task = await create(s, {
    title: "task",
    reminderAt: "2026-11-15T00:01:00Z",
  });
  const job = s.db.prepare("SELECT id FROM reminders").get().id;
  t.mock.timers.setTime(start + 61000);
  const next = await update(s, task, { body: "still remind me" });
  await scanReminders(s);
  const page = await notifications(s);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].id, job);
  assert.equal(page.items[0].source.version, next.version);
  await update(s, next, { title: "another edit" });
  await scanReminders(s);
  assert.equal((await notifications(s)).items.length, 1);
});
test("ordinary parent edit preserves overdue linked reminder; explicit cancellation suppresses it", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: start });
  const s = await fixture(t);
  let task = await create(s, { title: "task" });
  const event = {
    title: "block",
    taskId: task.id,
    allDay: true,
    start: "2026-11-15",
    end: "2026-11-16",
    timeZone: "UTC",
    reminderAt: "2026-11-15T00:01:00Z",
  };
  await create(s, event, "event");
  t.mock.timers.setTime(start + 61000);
  task = await update(s, task, { title: "renamed" });
  await scanReminders(s);
  assert.equal((await notifications(s)).items.length, 1);
  t.mock.timers.setTime(start);
  await create(s, { ...event, title: "cancelled block" }, "event");
  t.mock.timers.setTime(start + 61000);
  task = await update(s, task, { status: "done" });
  await scanReminders(s);
  assert.equal((await notifications(s)).items.length, 1);
  await update(s, task, { status: "open" });
  await scanReminders(s);
  assert.equal((await notifications(s)).items.length, 1);
});
test("rescheduling replaces pending reminder and never delivers the superseded time", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: start });
  const s = await fixture(t);
  const task = await create(s, {
    title: "task",
    reminderAt: "2026-11-15T00:01:00Z",
  });
  await update(s, task, { reminderAt: "2026-11-15T00:02:00Z" });
  await scanReminders(s, "2026-11-15T00:01:30Z");
  assert.equal((await notifications(s)).items.length, 0);
  await scanReminders(s, "2026-11-15T00:02:30Z");
  assert.equal((await notifications(s)).items.length, 1);
});
test("ongoing all-day blocks appear today and tomorrow; exclusive ends do not", async (t) => {
  const s = await fixture(t);
  const task = await create(s, { title: "multi day" });
  await create(
    s,
    {
      title: "block",
      taskId: task.id,
      allDay: true,
      start: "2026-11-14",
      end: "2026-11-17",
      timeZone: "Asia/Taipei",
    },
    "event",
  );
  const q = { timeZone: "Asia/Taipei", now: "2026-11-15T04:00:00Z" };
  assert.equal((await s.tasks({ ...q, view: "today" })).items[0]?.id, task.id);
  assert.equal(
    (await s.tasks({ ...q, view: "future" })).items[0]?.classification.future,
    "2026-11-16",
  );
  assert.equal(
    (await s.tasks({ ...q, view: "today", now: "2026-11-17T04:00:00Z" })).total,
    0,
  );
});
test("timed overlap uses local midnight and exclusive ends across DST", async (t) => {
  const s = await fixture(t);
  const task = await create(s, { title: "overnight" });
  await create(
    s,
    {
      title: "block",
      taskId: task.id,
      allDay: false,
      start: "2026-11-01T03:00:00Z",
      end: "2026-11-01T07:00:00Z",
      timeZone: "America/New_York",
    },
    "event",
  );
  assert.equal(
    (
      await s.tasks({
        view: "today",
        timeZone: "America/New_York",
        now: "2026-11-01T12:00:00Z",
      })
    ).total,
    1,
  );
  assert.equal(
    (
      await s.tasks({
        view: "today",
        timeZone: "Asia/Taipei",
        now: "2026-11-02T00:00:00Z",
      })
    ).total,
    0,
  );
  const boundary = await create(s, { title: "ends midnight" });
  await create(
    s,
    {
      title: "block",
      taskId: boundary.id,
      allDay: false,
      start: "2026-10-31T23:00:00Z",
      end: "2026-11-01T04:00:00Z",
      timeZone: "America/New_York",
    },
    "event",
  );
  assert.equal(
    (
      await s.tasks({
        view: "today",
        timeZone: "America/New_York",
        now: "2026-11-01T12:00:00Z",
      })
    ).items.some((x) => x.id === boundary.id),
    false,
  );
});

test("query pages load only selected records and keyset survives a new earlier item", async (t) => {
  const s = await fixture(t);
  const seeded = [];
  for (let i = 0; i < 105; i++)
    seeded.push(
      await create(s, {
        title: `task ${i}`,
        body: "preserved body",
        priority: i % 2 ? "high" : "normal",
      }),
    );
  s.all = () => {
    throw Error("query must not load the whole record collection");
  };
  const first = await s.tasks({ view: "all" });
  assert.equal(first.items.length, 100);
  await create(s, { title: "inserted while paging" });
  const second = await s.tasks({ view: "all", cursor: first.nextCursor });
  assert.equal(second.items.length, 5);
  assert.equal(
    new Set([...first.items, ...second.items].map((x) => x.id)).size,
    105,
  );
  const filtered = await s.tasks({
    view: "all",
    priority: "high",
    query: "task",
  });
  assert.equal(filtered.total, 52);
  const calendar = await s.calendar({
    start: "2026-11-01T00:00:00Z",
    end: "2026-12-01T00:00:00Z",
    timeZone: "UTC",
  });
  assert.equal(calendar.items.length, 0);
});
test("derived pagination detects schedule edits without a task version change", async (t) => {
  const s = await fixture(t);
  for (let i = 0; i < 101; i++)
    await create(s, { title: `today ${i}`, plannedDate: "2026-11-15" });
  const task = await create(s, { title: "only via event" });
  const event = await create(
    s,
    {
      title: "block",
      taskId: task.id,
      allDay: true,
      start: "2026-11-15",
      end: "2026-11-16",
      timeZone: "UTC",
    },
    "event",
  );
  const args = { view: "today", timeZone: "UTC", now: "2026-11-15T12:00:00Z" };
  const first = await s.tasks(args);
  assert.ok(first.nextCursor);
  await update(s, event, { start: "2026-11-20", end: "2026-11-21" }, "event");
  await assert.rejects(
    s.tasks({ ...args, cursor: first.nextCursor }),
    (e) => e.status === 400,
  );
});
test("calendar returns range-bounded events and deadlines, including date and offset edges", async (t) => {
  const s = await fixture(t);
  await create(
    s,
    {
      title: "in",
      allDay: false,
      start: "2026-11-15T01:00:00Z",
      end: "2026-11-15T02:00:00Z",
      timeZone: "UTC",
    },
    "event",
  );
  await create(
    s,
    {
      title: "ends at lower bound",
      allDay: false,
      start: "2026-11-14T23:00:00Z",
      end: "2026-11-15T00:00:00Z",
      timeZone: "UTC",
    },
    "event",
  );
  await create(s, {
    title: "deadline in",
    due: { kind: "instant", at: "2026-11-15T03:00:00Z", timeZone: "UTC" },
  });
  await create(s, {
    title: "deadline out",
    due: { kind: "date", date: "2026-11-16", timeZone: "UTC" },
  });
  const result = await s.calendar({
    start: "2026-11-15T00:00:00Z",
    end: "2026-11-16T00:00:00Z",
    timeZone: "UTC",
  });
  assert.deepEqual(
    result.items.map((x) => x.title),
    ["in"],
  );
  assert.deepEqual(
    result.tasks.map((x) => x.title),
    ["deadline in"],
  );
});
