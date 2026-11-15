import { defineTool } from "@deepseek-ai/dsh-tools";
import { output, string } from "./task-tools.mjs";
export function scheduleTools(store) {
  const properties = {
    title: { type: "string" },
    body: { type: "string" },
    status: { type: "string", enum: ["active", "cancelled"] },
    allDay: { type: "boolean" },
    start: { type: "string" },
    end: { type: "string" },
    timeZone: { type: "string" },
    taskId: { oneOf: [{ type: "string" }, { type: "null" }] },
    location: { type: "string" },
    reminderAt: { oneOf: [{ type: "string" }, { type: "null" }] },
  };
  return [
    [
      "list",
      { start: string, end: string, timeZone: string },
      (a) => store.calendar(a),
    ],
    ["read", { id: string }, (a) => store.read("event", a.id)],
    [
      "create",
      { requestId: string, ...properties },
      ({ requestId, ...value }) => store.mutate("event", { requestId, value }),
    ],
    [
      "update",
      {
        requestId: string,
        id: string,
        expected: { type: "integer", required: true },
        patch: {
          type: "object",
          required: true,
          properties,
          additionalProperties: false,
        },
      },
      (a) => store.mutate("event", a),
    ],
    ["request", { requestId: string }, (a) => store.request(a.requestId)],
  ].map(([action, parameters, run]) =>
    defineTool({
      name: `corilo_calendar_${action}`,
      description:
        "个人日历与任务时间块。定时起止须包含 UTC/偏移及 IANA 时区，全天结束日期排他。更改时间块不改任务截止。写前读取版本；未知结果查询 request。仅按明确用户要求写入，不支持重复或外部推送。",
      parameters,
      output,
      async execute(args, exec) {
        exec.signal?.throwIfAborted();
        return run(args);
      },
    }),
  );
}
