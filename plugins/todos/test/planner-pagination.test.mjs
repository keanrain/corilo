import test from "node:test";
import assert from "node:assert/strict";
import { loadPlannerTasks } from "../client/planner-queries.mjs";
test("calendar offers subsequent task pages and polling retains loaded tasks", async () => {
  const records = Array.from({ length: 205 }, (_, id) => ({ id: String(id) }));
  let calls = [];
  const call = async (method, args) => {
    assert.equal(method, "tasks/list");
    calls.push(args);
    const offset = Number(args.cursor ?? 0);
    return {
      items: records.slice(offset, offset + 100),
      nextCursor: offset + 100 < records.length ? String(offset + 100) : null,
      total: records.length,
      counts: {},
    };
  };
  let model = { view: "calendar", zone: "UTC", items: [], cursor: null };
  model = { ...model, ...(await loadPlannerTasks(call, model)) };
  assert.equal(model.items.length, 100);
  model = { ...model, ...(await loadPlannerTasks(call, model, true)) };
  assert.equal(model.items.length, 200);
  model = { ...model, ...(await loadPlannerTasks(call, model, true)) };
  assert.equal(model.items.length, 205);
  const refreshed = await loadPlannerTasks(call, model);
  assert.deepEqual(refreshed.items, records);
  const switched = await loadPlannerTasks(call, {
    ...model,
    view: "all",
    query: "",
    list: "",
    priority: "",
  });
  assert.equal(switched.items.length, 100);
  assert.equal(calls[1].cursor, "100");
  assert.equal(calls[2].cursor, "200");
});
