import { fields } from "./task-service.mjs";
import {
  notifications,
  readNotification,
  claimNotifications,
} from "./reminders.mjs";
export function scheduleMethods(store) {
  return {
    identity: [[], () => ({ id: store.identity, format: 2 })],
    "tasks/list": [
      ["view", "query", "list", "priority", "cursor", "timeZone"],
      (a) => store.tasks(a),
    ],
    "tasks/read": [["id"], (a) => store.read("task", a.id)],
    "tasks/create": [["requestId", "value"], (a) => store.mutate("task", a)],
    "tasks/update": [
      ["requestId", "id", "expected", "patch"],
      (a) => store.mutate("task", a),
    ],
    "calendar/range": [["start", "end", "timeZone"], (a) => store.calendar(a)],
    "calendar/read": [["id"], (a) => store.read("event", a.id)],
    "calendar/create": [
      ["requestId", "value"],
      (a) => store.mutate("event", a),
    ],
    "calendar/update": [
      ["requestId", "id", "expected", "patch"],
      (a) => store.mutate("event", a),
    ],
    "requests/read": [["requestId"], (a) => store.request(a.requestId)],
    "reminders/list": [["offset", "unread"], (a) => notifications(store, a)],
    "reminders/read": [["id"], (a) => readNotification(store, a.id)],
    "reminders/claim": [[], () => claimNotifications(store)],
    export: [[], () => store.export()],
  };
}
export function registerScheduleApi(ctx, store) {
  for (const [name, [allowed, run]] of Object.entries(scheduleMethods(store)))
    ctx.effect(() =>
      ctx.connection.fetch.register({
        path: `/api/corilo-todos/v2/${name}`,
        methods: ["POST"],
        requestBody: "buffered",
        async fetch(request) {
          const json = (value) =>
            Response.json(value, { headers: { "cache-control": "no-store" } });
          if (
            name !== "identity" &&
            request.headers.get("x-corilo-todos-id") !== store.identity
          )
            return json({
              ok: false,
              error: {
                code: "schedule/library-changed",
                message: "资料库已改变，请重新加载；输入已保留",
              },
            });
          try {
            if (
              request.headers.get("content-type")?.split(";")[0].trim() !==
              "application/json"
            )
              return new Response("JSON required", { status: 415 });
            const raw = await request.text();
            if (raw.length > 128000)
              return new Response("Too large", { status: 413 });
            let args;
            try {
              args = JSON.parse(raw);
            } catch {
              return new Response("Invalid JSON", { status: 400 });
            }
            fields(args, allowed);
            request.signal.throwIfAborted();
            const value = await run(args);
            return json({ ok: true, value });
          } catch (error) {
            const status = [400, 404, 409, 413].includes(error.status)
              ? error.status
              : 503;
            return json({
              ok: false,
              error: {
                code: `schedule/${status}`,
                message:
                  status === 503
                    ? "暂不可用，请保留输入并核对操作结果"
                    : error.message,
              },
            });
          }
        },
      }),
    );
}
