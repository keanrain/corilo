import { defineTool } from "@deepseek-ai/dsh-tools";
const output = {
  schema: { type: "object", additionalProperties: true },
  render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
};
const string = { type: "string", required: true };
export function taskTools(store) {
  const properties = {
    title: { type: "string" },
    body: { type: "string" },
    status: { type: "string", enum: ["open", "done", "cancelled"] },
    plannedDate: { oneOf: [{ type: "string" }, { type: "null" }] },
    due: {
      oneOf: [{ type: "object", additionalProperties: true }, { type: "null" }],
    },
    priority: { type: "string", enum: ["normal", "high", "urgent"] },
    list: { type: "string" },
    reminderAt: { oneOf: [{ type: "string" }, { type: "null" }] },
  };
  const specs = [
    [
      "list",
      {
        view: { type: "string" },
        query: { type: "string" },
        list: { type: "string" },
        priority: { type: "string" },
        cursor: { type: "string" },
        timeZone: string,
      },
      (a) => store.tasks(a),
    ],
    ["read", { id: string }, (a) => store.read("task", a.id)],
    [
      "create",
      { requestId: string, ...properties },
      ({ requestId, ...value }) => store.mutate("task", { requestId, value }),
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
      (a) => store.mutate("task", a),
    ],
    ["export", {}, () => store.export()],
  ];
  return specs.map(([action, parameters, run]) =>
    defineTool({
      name: `corilo_todos_${action}`,
      description:
        "个人任务，与 Agent 执行计划不同。日期使用明确日期和 IANA 时区。仅按用户要求写入；更新前读取版本。requestId 使用 UUID v4；未知结果先核对回执。提醒仅站内，页面关闭不推送。",
      parameters,
      output,
      async execute(args, exec) {
        exec.signal?.throwIfAborted();
        return run(args);
      },
    }),
  );
}
export { output, string };
