import React from "react";
import { options, priorities } from "./planner-fields.jsx";
export function PlannerTaskList({ s, set, open, refresh }) {
  return (
    <>
      <div className="planner-filters">
        <label>
          搜索
          <input
            value={s.query}
            onChange={(e) => set({ query: e.target.value })}
          />
        </label>
        <label>
          清单
          <input
            value={s.list}
            onChange={(e) => set({ list: e.target.value })}
          />
        </label>
        <label>
          优先级
          <select
            aria-label="优先级"
            value={s.priority}
            onChange={(e) => set({ priority: e.target.value })}
          >
            {options([["", "全部优先级"], ...priorities])}
          </select>
        </label>
        <button onClick={() => set({ query: "", list: "", priority: "" })}>
          清空筛选
        </button>
      </div>
      <p>
        {s.total} 项{" "}
        {s.view === "today" &&
          Object.entries(s.counts)
            .map(([g, n]) => `${g} ${n}`)
            .join(" · ")}
      </p>
      <ul>
        {s.items.map((t) => (
          <li key={t.id}>
            <button onClick={() => open("task", t)}>{t.title}</button>
            <span>
              {t.classification.group ?? t.classification.future}{" "}
              {t.plannedDate && `原计划 ${t.plannedDate}`} {t.list}
            </span>
            <button
              onClick={() =>
                open("event", null, { title: t.title, taskId: t.id })
              }
            >
              安排时间
            </button>
          </li>
        ))}
      </ul>
      {s.cursor && <button onClick={() => refresh(true)}>加载更多任务</button>}
    </>
  );
}
