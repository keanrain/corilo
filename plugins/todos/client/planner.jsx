import React from "react";
import { Temporal } from "./planner-dates.mjs";
import { usePlanner } from "./use-planner.mjs";
import { PlannerTaskList } from "./planner-task-list.jsx";
import { PlannerCalendar } from "./planner-calendar.jsx";
import { PlannerReminders } from "./planner-reminders.jsx";
import { PlannerEditor } from "./planner-editor.jsx";
const views = {
  inbox: "收集箱",
  today: "今天",
  future: "未来",
  all: "全部",
  done: "已完成",
  cancelled: "已取消",
  calendar: "日历",
  reminders: "提醒",
};
export function Planner({ identity }) {
  const planner = usePlanner(identity);
  const { s, set, open, refresh, call } = planner;
  return (
    <section className="corilo-planner">
      <header>
        <h1>任务与日历</h1>
        <label>
          显示时区
          <input
            value={s.zone}
            onChange={(e) => set({ zone: e.target.value, confirmed: false })}
          />
        </label>
        <button
          onClick={() => {
            try {
              Temporal.Now.zonedDateTimeISO(s.zone);
              set({ confirmed: true, error: "" });
            } catch {
              set({ error: "请选择有效时区" });
            }
          }}
        >
          {s.confirmed ? "时区已确认" : "确认时区"}
        </button>
      </header>
      <nav aria-label="任务视图">
        {Object.entries(views).map(([k, v]) => (
          <button
            key={k}
            aria-pressed={s.view === k}
            onClick={() => set({ view: k })}
          >
            {v}
          </button>
        ))}
      </nav>
      {s.error && <p role="alert">{s.error}</p>}
      {s.notice && <p role="status">{s.notice}</p>}
      {s.confirmed && (
        <>
          <div className="planner-toolbar">
            <button onClick={() => open("task")}>新建任务</button>
            <button onClick={() => open("event")}>新建日程</button>
            <button onClick={() => refresh()}>刷新</button>
            <button
              onClick={async () => {
                try {
                  const value = await call("export");
                  const url = URL.createObjectURL(
                    new Blob([JSON.stringify(value, null, 2)], {
                      type: "application/json",
                    }),
                  );
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "corilo-schedule.json";
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (e) {
                  set({ error: e.message });
                }
              }}
            >
              导出
            </button>
          </div>
          {!["calendar", "reminders"].includes(s.view) && (
            <PlannerTaskList {...planner} />
          )}
          {s.view === "calendar" && <PlannerCalendar {...planner} />}
          {s.view === "reminders" && <PlannerReminders {...planner} />}
        </>
      )}
      {s.editor && <PlannerEditor {...planner} />}
    </section>
  );
}
