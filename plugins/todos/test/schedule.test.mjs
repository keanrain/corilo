import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { ScheduleService } from "../schedule-service.mjs";
import { TodoStore } from "../storage.mjs";
import { date, localInstant, shiftStart, dueInstant } from "../date-values.mjs";
import {
  scanReminders,
  notifications,
  claimNotifications,
} from "../reminders.mjs";
async function fixture(t) {
  const root = await mkdtemp("/tmp/corilo-planner-");
  const store = await ScheduleService.open(root);
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true });
  });
  return { root, store };
}
const create = (store, value, kind = "task") =>
  store.mutate(kind, { requestId: randomUUID(), value });
const update = (store, item, patch, kind = "task") =>
  store.mutate(kind, {
    requestId: randomUUID(),
    id: item.id,
    expected: item.version,
    patch,
  });
test("date validation rejects invalid dates and DST gaps/ambiguity; date deadline ends next local day", () => {
  assert.throws(() => date("2026-02-30"));
  assert.throws(() => localInstant("2026-03-08T02:30", "America/New_York"));
  assert.throws(() => localInstant("2026-11-01T01:30", "America/New_York"));
  assert.equal(
    dueInstant({
      kind: "date",
      date: "2026-03-08",
      timeZone: "America/New_York",
    }),
    "2026-03-09T04:00:00Z",
  );
});
test("start changes retain timed duration and all-day day count", () => {
  assert.equal(
    shiftStart(
      {
        allDay: false,
        start: "2026-11-20T10:00Z",
        end: "2026-11-20T11:00Z",
        timeZone: "UTC",
      },
      "2026-11-21T12:00Z",
    ).end,
    "2026-11-21T13:00:00Z",
  );
  assert.equal(
    shiftStart(
      {
        allDay: true,
        start: "2026-03-07",
        end: "2026-03-10",
        timeZone: "America/New_York",
      },
      "2026-11-01",
    ).end,
    "2026-11-04",
  );
});
test("v2 rejects old database without changing its bytes", async (t) => {
  const root = await mkdtemp("/tmp/corilo-v1-");
  t.after(() => rm(root, { recursive: true }));
  const old = await TodoStore.open(root);
  await old.create({ requestId: randomUUID(), title: "old" });
  old.close();
  const before = await readFile(root + "/todos.sqlite");
  await assert.rejects(ScheduleService.open(root), /格式未知/);
  assert.deepEqual(await readFile(root + "/todos.sqlite"), before);
});
test("task fields persist, stale versions conflict, same receipt survives restart", async (t) => {
  const { root, store } = await fixture(t);
  const args = {
    requestId: randomUUID(),
    value: {
      title: "task",
      plannedDate: "2026-11-15",
      priority: "high",
      list: "work",
      due: { kind: "date", date: "2026-11-16", timeZone: "Asia/Taipei" },
    },
  };
  const item = await store.mutate("task", args);
  assert.deepEqual(await store.mutate("task", args), item);
  await assert.rejects(
    store.mutate("task", { ...args, value: { title: "other" } }),
    (e) => e.status === 409,
  );
  const done = await update(store, item, { status: "done" });
  assert.ok(done.completedAt);
  await assert.rejects(
    update(store, item, { title: "stale" }),
    (e) => e.status === 409,
  );
  const other = await ScheduleService.open(root);
  try {
    assert.deepEqual(await other.request(args.requestId), {
      found: true,
      value: item,
    });
    assert.equal((await other.read("task", item.id)).status, "done");
  } finally {
    other.close();
  }
});
test("today includes overdue and earlier uncompleted plans; done/cancelled separate", async (t) => {
  const { store } = await fixture(t);
  const a = await create(store, {
    title: "earlier",
    plannedDate: "2026-11-10",
  });
  await create(store, {
    title: "late",
    due: { kind: "instant", at: "2026-11-14T00:00Z", timeZone: "UTC" },
  });
  const q = { view: "today", timeZone: "UTC", now: "2026-11-15T12:00Z" };
  assert.deepEqual((await store.tasks(q)).counts, {
    逾期截止: 1,
    此前计划未完成: 1,
  });
  await update(store, a, { status: "cancelled" });
  assert.equal((await store.tasks(q)).total, 1);
  assert.equal((await store.tasks({ view: "cancelled" })).total, 1);
});
test("task pagination filters are bound to cursor", async (t) => {
  const { store } = await fixture(t);
  for (let i = 0; i < 105; i++) await create(store, { title: `task ${i}` });
  const p = await store.tasks();
  assert.equal(p.items.length, 100);
  assert.equal((await store.tasks({ cursor: p.nextCursor })).items.length, 5);
  await assert.rejects(
    store.tasks({ cursor: p.nextCursor, query: "different" }),
    (e) => e.status === 400,
  );
});
test("event links require existing tasks; changing time blocks never changes task deadline", async (t) => {
  const { store } = await fixture(t);
  const task = await create(store, {
    title: "task",
    due: { kind: "date", date: "2026-11-20", timeZone: "UTC" },
  });
  const value = {
    title: "block",
    allDay: true,
    start: "2026-11-18",
    end: "2026-11-19",
    timeZone: "UTC",
    taskId: task.id,
  };
  const e = await create(store, value, "event");
  await update(store, e, { start: "2026-11-19", end: "2026-11-20" }, "event");
  assert.deepEqual(await store.read("task", task.id), task);
  await assert.rejects(
    create(store, { ...value, taskId: randomUUID() }, "event"),
    (e) => e.status === 404,
  );
  await assert.rejects(
    create(store, { ...value, end: value.start }, "event"),
    (e) => e.status === 400,
  );
});
test("reminder restart scan is durable and cross-process claims do not duplicate over 100 notifications", async (t) => {
  const { root, store } = await fixture(t);
  const at = new Date(Date.now() + 3600000).toISOString();
  for (let i = 0; i < 105; i++)
    await create(store, { title: `reminder ${i}`, reminderAt: at });
  const other = await ScheduleService.open(root);
  try {
    await scanReminders(other, new Date(Date.now() + 3601000).toISOString());
    assert.equal((await notifications(store)).items.length, 100);
    const a = await claimNotifications(store),
      b = await claimNotifications(other);
    assert.equal(a.items.length, 100);
    assert.equal(b.items.length, 5);
    assert.equal(new Set([...a.items, ...b.items].map((x) => x.id)).size, 105);
    assert.equal((await claimNotifications(store)).items.length, 0);
  } finally {
    other.close();
  }
});
test("completing cancels pending linked reminders and restoring regenerates future ones", async (t) => {
  const { store } = await fixture(t);
  let task = await create(store, { title: "task" });
  const at = new Date(Date.now() + 3600000).toISOString();
  await create(
    store,
    {
      title: "block",
      allDay: false,
      start: at,
      end: new Date(Date.now() + 7200000).toISOString(),
      timeZone: "UTC",
      taskId: task.id,
      reminderAt: at,
    },
    "event",
  );
  task = await update(store, task, { status: "done" });
  assert.equal(
    store.db
      .prepare("SELECT count(*) n FROM reminders WHERE state='pending'")
      .get().n,
    0,
  );
  await update(store, task, { status: "open" });
  assert.equal(
    store.db
      .prepare("SELECT count(*) n FROM reminders WHERE state='pending'")
      .get().n,
    1,
  );
});

test("task summary counts open tasks per smart view and per named list", async (t) => {
  const { store } = await fixture(t);
  const now = "2026-11-18T04:00:00Z";
  await create(store, { title: "今天的事", plannedDate: "2026-11-18", list: "工作" });
  await create(store, { title: "明天的事", plannedDate: "2026-11-19", list: "工作" });
  await create(store, { title: "随手记下" });
  await create(store, { title: "康复训练", list: "康复" });
  const done = await create(store, { title: "做完了", list: "康复" });
  await update(store, done, { status: "done" });
  const summary = await store.taskSummary({ timeZone: "Asia/Shanghai", now });
  assert.deepEqual(summary.views, { inbox: 1, today: 1, future: 1, all: 4 });
  assert.deepEqual(summary.lists, [
    { name: "工作", count: 2 },
    { name: "康复", count: 1 },
  ]);
  for (const view of ["inbox", "today", "future", "all"])
    assert.equal(
      (await store.tasks({ view, timeZone: "Asia/Shanghai", now })).total,
      summary.views[view],
    );
});
