// Explicit synthetic benchmark, not a timing assertion in the test suite.
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import os from "node:os";
import { ScheduleService } from "../schedule-service.mjs";
const root = await mkdtemp("/tmp/corilo-query-benchmark-");
const store = await ScheduleService.open(root);
try {
  const ids = Array.from({ length: 10000 }, () => randomUUID());
  const insert = store.db.prepare("INSERT INTO records VALUES (?,?,?,?)");
  store.transaction(() => {
    for (let i = 0; i < ids.length; i++)
      insert.run(
        ids[i],
        "task",
        1,
        JSON.stringify({
          id: ids[i],
          title: `Synthetic ${i}`,
          body: "x".repeat(1024),
          status: "open",
          plannedDate: i % 2 ? "2026-11-15" : null,
          due: null,
          priority: "normal",
          list: "",
          reminderAt: null,
          version: 1,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
          updatedAt: "2026-11-15T00:00:00.000Z",
          completedAt: null,
          cancelledAt: null,
        }),
      );
    for (let i = 0; i < 500; i++) {
      const id = randomUUID();
      insert.run(
        id,
        "event",
        1,
        JSON.stringify({
          id,
          title: `Block ${i}`,
          body: "x".repeat(1024),
          status: "active",
          allDay: true,
          start: "2026-11-15",
          end: "2026-11-16",
          timeZone: "Asia/Taipei",
          taskId: ids[i],
          location: "",
          reminderAt: null,
          version: 1,
          createdAt: "2026-11-15T00:00:00.000Z",
          updatedAt: "2026-11-15T00:00:00.000Z",
        }),
      );
    }
  });
  const runners = { current: (args) => store.tasks(args) };
  if (process.argv[2]) {
    const { ScheduleService: Baseline } = await import(
      pathToFileURL(process.argv[2])
    );
    runners.baseline = (args) => Baseline.prototype.tasks.call(store, args);
  }
  const measurements = {};
  for (const [name, run] of Object.entries(runners)) {
    measurements[name] = {};
    for (const view of ["all", "today"]) {
      const args = {
        view,
        timeZone: "Asia/Taipei",
        now: "2026-11-15T04:00:00Z",
      };
      await run(args);
      const samples = [];
      let result;
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        result = await run(args);
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      measurements[name][view] = {
        medianMs: +samples[2].toFixed(2),
        maxMs: +samples[4].toFixed(2),
        returned: result.items.length,
        total: result.total,
      };
    }
  }
  console.log(
    JSON.stringify(
      {
        node: process.version,
        cpu: os.cpus()[0]?.model,
        tasks: 10000,
        events: 500,
        bodyBytes: 1024,
        method:
          "one warmup then five sequential queries per view; median and max; no performance guarantee",
        measurements,
      },
      null,
      2,
    ),
  );
} finally {
  store.close();
  await rm(root, { recursive: true });
}
