import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Context } from "@deepseek-ai/cordis";
import Tools from "@deepseek-ai/dsh-tools";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import { ToolExecutionPipeline } from "@deepseek-ai/dsh-tools/pipeline";
import * as plugin from "../index.mjs";
test("real Cordis planner tools create task, calendar block, cancel and recover receipts", async (t) => {
  const root = await mkdtemp("/tmp/corilo-planner-tools-");
  const ctx = new Context();
  t.after(async () => {
    await ctx.fiber.dispose();
    await rm(root, { recursive: true });
  });
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(Tools);
  await ctx.plugin(plugin, { root, planner: true });
  const pipeline = new ToolExecutionPipeline(ctx);
  let sequence = 0;
  async function call(name, args) {
    const p = await pipeline.prepare({
      callId: String(++sequence),
      name,
      arguments: args,
      signal: new AbortController().signal,
    });
    const r = await pipeline.complete(
      p.exec,
      p.kind === "dispatch" ? await pipeline.dispatch(p.exec) : p,
    );
    assert.equal(r.isError, false, JSON.stringify(r));
    return r.value;
  }
  const task = await call("corilo_todos_create", {
    requestId: randomUUID(),
    title: "planner task",
    plannedDate: "2026-11-20",
    priority: "high",
  });
  const requestId = randomUUID();
  const event = await call("corilo_calendar_create", {
    requestId,
    title: "focus",
    allDay: true,
    start: "2026-11-20",
    end: "2026-11-21",
    timeZone: "UTC",
    taskId: task.id,
  });
  assert.equal(event.taskId, task.id);
  assert.deepEqual(
    (await call("corilo_calendar_request", { requestId })).value,
    event,
  );
  const cancelled = await call("corilo_todos_update", {
    requestId: randomUUID(),
    id: task.id,
    expected: task.version,
    patch: { status: "cancelled" },
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(
    (await call("corilo_todos_list", { view: "cancelled", timeZone: "UTC" }))
      .items.length,
    1,
  );
});
