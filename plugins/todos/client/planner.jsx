import luxon from "@fullcalendar/luxon3";
import React, { useState, useEffect, useRef } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGrid from "@fullcalendar/daygrid";
import timeGrid from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interaction, { Draggable } from "@fullcalendar/interaction";
import zh from "@fullcalendar/core/locales/zh-cn";
import { v4 as uuid } from "uuid";
import { shiftStart, localInstant, Temporal } from "./planner-dates.mjs";
import styles from "./planner.css";
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
const strip = (x) =>
  Object.fromEntries(
    Object.entries(x).filter(
      ([k]) =>
        ![
          "id",
          "version",
          "createdAt",
          "updatedAt",
          "completedAt",
          "cancelledAt",
          "classification",
        ].includes(k),
    ),
  );
let retained;
export function Planner({ identity }) {
  const [s, state] = useState(() =>
    retained?.identity === identity
      ? retained
      : {
          identity,
          view: "today",
          zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          confirmed: false,
          items: [],
          events: [],
          deadlines: [],
          notifications: [],
          query: "",
          list: "",
          priority: "",
          total: 0,
          counts: {},
          cursor: null,
          offset: null,
          range: null,
          editor: null,
          pending: null,
          busy: false,
          error: "",
          notice: "",
        },
  );
  const ref = useRef(s);
  ref.current = s;
  const set = (change) =>
    state((old) => {
      const next = {
        ...old,
        ...(typeof change === "function" ? change(old) : change),
      };
      ref.current = next;
      retained = next;
      return next;
    });
  const cal = useRef(),
    drags = useRef(),
    title = useRef(),
    returnFocus = useRef(),
    composing = useRef(false),
    generation = useRef(0),
    mounted = useRef(true);
  async function call(method, args = {}) {
    let result;
    try {
      const r = await fetch(`api/corilo-todos/v2/${method}`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-corilo-todos-id": identity,
        },
        body: JSON.stringify(args),
      });
      if (!r.ok) throw Error();
      result = await r.json();
      if (typeof result.ok !== "boolean") throw Error();
    } catch {
      throw Object.assign(Error("连接失败，输入已保留，请核对操作结果"), {
        unknown: true,
      });
    }
    if (!result.ok)
      throw Object.assign(Error(result.error.message), {
        code: result.error.code,
        unknown: result.error.code === "schedule/503",
      });
    return result.value;
  }
  async function refresh(more = false) {
    const m = ref.current,
      g = ++generation.current;
    try {
      let change;
      if (m.view === "reminders") {
        const p = await call("reminders/list", { offset: more ? m.offset : 0 });
        change = {
          notifications: more ? [...m.notifications, ...p.items] : p.items,
          offset: p.nextOffset,
        };
      } else if (m.view === "calendar") {
        if (!m.range) return;
        const p = await call("calendar/range", {
          ...m.range,
          timeZone: m.zone,
        });
        const t = await call("tasks/list", { view: "all", timeZone: m.zone });
        change = {
          events: p.items,
          deadlines: p.tasks,
          items: t.items,
          cursor: t.nextCursor,
        };
      } else {
        const p = await call("tasks/list", {
          view: m.view,
          query: m.query,
          list: m.list,
          priority: m.priority,
          cursor: more ? m.cursor : null,
          timeZone: m.zone,
        });
        change = {
          items: more ? [...m.items, ...p.items] : p.items,
          cursor: p.nextCursor,
          total: p.total,
          counts: p.counts,
        };
      }
      if (g === generation.current && mounted.current) set(change);
    } catch (e) {
      if (mounted.current) set({ error: e.message });
    }
  }
  async function notify() {
    if (!("Notification" in window) || Notification.permission !== "granted")
      return;
    try {
      let more = true;
      while (more && mounted.current) {
        const p = await call("reminders/claim");
        for (const n of p.items)
          new Notification(n.source.title, {
            tag: n.id,
            body: "可里站内提醒，请打开页面查看",
          });
        more = p.hasMore;
      }
    } catch (e) {
      set({ error: e.message });
    }
  }
  useEffect(() => {
    mounted.current = true;
    const sheet = document.createElement("style");
    sheet.textContent = styles;
    document.head.append(sheet);
    const guard = (e) => {
      if (ref.current.editor || ref.current.pending) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    const timer = setInterval(() => {
      if (ref.current.confirmed && !ref.current.busy) {
        void refresh();
        void notify();
      }
    }, 30000);
    return () => {
      mounted.current = false;
      sheet.remove();
      clearInterval(timer);
      window.removeEventListener("beforeunload", guard);
    };
  }, []);
  useEffect(() => {
    if (s.confirmed) void refresh();
  }, [s.view, s.query, s.list, s.priority, s.zone, s.confirmed, s.range]);
  useEffect(() => {
    if (!drags.current) return;
    const d = new Draggable(drags.current, {
      itemSelector: "[data-task-id]",
      eventData: (el) => ({
        title: el.dataset.title,
        duration: "00:30",
        create: false,
      }),
    });
    return () => d.destroy();
  }, [s.view, s.items]);
  function open(kind, item = null, defaults = {}) {
    if (ref.current.pending || ref.current.busy) return;
    if (ref.current.editor && !window.confirm("放弃当前未提交的编辑？")) return;
    returnFocus.current = document.activeElement;
    const day = Temporal.Now.plainDateISO(s.zone).toString();
    const value = item
      ? strip(item)
      : kind === "task"
        ? {
            title: "",
            body: "",
            status: "open",
            plannedDate: null,
            due: null,
            priority: "normal",
            list: "",
            reminderAt: null,
          }
        : {
            title: "",
            body: "",
            status: "active",
            allDay: true,
            start: day,
            end: Temporal.PlainDate.from(day).add({ days: 1 }).toString(),
            timeZone: s.zone,
            taskId: null,
            location: "",
            reminderAt: null,
            ...defaults,
          };
    set({ editor: { kind, item, value }, error: "", notice: "" });
    setTimeout(() => title.current?.focus(), 0);
    return true;
  }
  const edit = (k, v) =>
    set((old) => ({
      editor: { ...old.editor, value: { ...old.editor.value, [k]: v } },
      notice: "未保存",
    }));
  async function accept(value, p) {
    const e = ref.current.editor;
    if (e) {
      const changed = JSON.stringify(e.value) !== JSON.stringify(p.snapshot);
      set({
        editor: { ...e, item: value, value: changed ? e.value : strip(value) },
        notice: changed ? "提交快照已保存，后续输入仍未保存" : "已保存",
      });
    }
    set({ pending: null, busy: false });
    await refresh();
  }
  async function submit(p) {
    set({ busy: true, error: "" });
    try {
      await accept(await call(p.method, p.args), p);
    } catch (e) {
      set({
        busy: false,
        pending: e.unknown ? p : null,
        error: e.message,
        notice: e.unknown
          ? "保存结果未知，请先核对操作"
          : e.code === "schedule/409"
            ? "版本冲突，请查看最新记录"
            : "保存失败",
      });
    }
  }
  async function save(event) {
    event.preventDefault();
    if (composing.current || s.pending || s.busy) return;
    const { kind, item, value } = s.editor;
    const p = {
      method: `${kind === "task" ? "tasks" : "calendar"}/${item ? "update" : "create"}`,
      args: item
        ? {
            requestId: uuid(),
            id: item.id,
            expected: item.version,
            patch: value,
          }
        : { requestId: uuid(), value },
      snapshot: structuredClone(value),
    };
    set({ pending: p });
    await submit(p);
  }
  async function reconcile() {
    const p = s.pending;
    set({ busy: true });
    try {
      const r = await call("requests/read", { requestId: p.args.requestId });
      if (r.found) await accept(r.value, p);
      else set({ busy: false, notice: "未找到回执，可重试原请求" });
    } catch (e) {
      set({ busy: false, error: e.message });
    }
  }
  async function latest() {
    try {
      const e = s.editor;
      const item = await call(
        `${e.kind === "task" ? "tasks" : "calendar"}/read`,
        { id: e.item.id },
      );
      set({ editor: { ...e, latest: item } });
    } catch (e) {
      set({ error: e.message });
    }
  }
  function select(info, task) {
    open("event", null, {
      title: task?.title ?? "",
      taskId: task?.id ?? null,
      allDay: info.allDay,
      start: info.allDay
        ? info.startStr.slice(0, 10)
        : info.start.toISOString(),
      end: info.allDay ? info.endStr.slice(0, 10) : info.end.toISOString(),
    });
  }
  function moved(info) {
    const item = info.event.extendedProps.record;
    const value = {
      ...strip(item),
      allDay: info.event.allDay,
      start: info.event.allDay
        ? info.event.startStr.slice(0, 10)
        : info.event.start.toISOString(),
      end: info.event.allDay
        ? info.event.endStr.slice(0, 10)
        : info.event.end.toISOString(),
    };
    info.revert();
    if (s.pending || s.busy) return;
    if (!open("event", item)) return;
    set({
      editor: { kind: "event", item, value },
      notice: "调整尚未保存，请核对并保存",
    });
  }
  const field = (label, k, type = "text") => (
    <label>
      {label}
      <input
        type={type}
        value={s.editor.value[k] ?? ""}
        onChange={(e) =>
          edit(
            k,
            e.target.value ||
              (["plannedDate", "reminderAt"].includes(k) ? null : ""),
          )
        }
      />
    </label>
  );
  const options = (values) =>
    values.map(([v, l]) => (
      <option key={v} value={v}>
        {l}
      </option>
    ));
  const priorities = [
    ["normal", "普通"],
    ["high", "高"],
    ["urgent", "紧急"],
  ];
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
                <button
                  onClick={() => set({ query: "", list: "", priority: "" })}
                >
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
              {s.cursor && (
                <button onClick={() => refresh(true)}>加载更多任务</button>
              )}
            </>
          )}
          {s.view === "calendar" && (
            <>
              <label>
                跳转日期
                <input
                  type="date"
                  onChange={(e) =>
                    e.target.value &&
                    cal.current?.getApi().gotoDate(e.target.value)
                  }
                />
              </label>
              <div className="planner-calendar">
                <aside ref={drags} aria-label="可安排任务">
                  {s.items.map((t) => (
                    <div key={t.id} data-task-id={t.id} data-title={t.title}>
                      <button
                        onClick={() =>
                          open("event", null, { title: t.title, taskId: t.id })
                        }
                      >
                        {t.title} · 安排
                      </button>
                    </div>
                  ))}
                </aside>
                <FullCalendar
                  ref={cal}
                  plugins={[dayGrid, timeGrid, listPlugin, interaction, luxon]}
                  locale={zh}
                  initialView={
                    window.innerWidth < 700 ? "listWeek" : "dayGridMonth"
                  }
                  headerToolbar={{
                    left: "prev,next today",
                    center: "title",
                    right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
                  }}
                  timeZone={s.zone}
                  height="auto"
                  selectable
                  editable
                  droppable
                  events={[
                    ...s.events.map((e) => ({
                      id: e.id,
                      title: e.title,
                      start: e.start,
                      end: e.end,
                      allDay: e.allDay,
                      extendedProps: { record: e },
                    })),
                    ...s.deadlines.map((t) => ({
                      id: `due-${t.id}`,
                      title: `截止 · ${t.title}`,
                      start: t.due.kind === "date" ? t.due.date : t.due.at,
                      allDay: t.due.kind === "date",
                      editable: false,
                      display: "list-item",
                      extendedProps: { task: t },
                    })),
                  ]}
                  datesSet={(info) =>
                    set({
                      range: {
                        start: info.start.toISOString(),
                        end: info.end.toISOString(),
                      },
                    })
                  }
                  select={select}
                  eventClick={(i) =>
                    i.event.extendedProps.task
                      ? open("task", i.event.extendedProps.task)
                      : open("event", i.event.extendedProps.record)
                  }
                  eventDrop={moved}
                  eventResize={moved}
                  drop={(info) => {
                    const task = s.items.find(
                        (t) => t.id === info.draggedEl.dataset.taskId,
                      ),
                      end = new Date(
                        info.date.getTime() +
                          (info.allDay ? 86400000 : 1800000),
                      );
                    select(
                      {
                        allDay: info.allDay,
                        start: info.date,
                        end,
                        startStr: info.dateStr,
                        endStr: info.allDay
                          ? Temporal.PlainDate.from(info.dateStr.slice(0, 10))
                              .add({ days: 1 })
                              .toString()
                          : end.toISOString(),
                      },
                      task,
                    );
                  }}
                />
              </div>
              <p>网格显示所选时区；详情保留事件原时区。拖动后需确认保存。</p>
            </>
          )}
          {s.view === "reminders" && (
            <>
              <p>
                持久站内提醒；网页通知只在页面打开时尝试发送，关闭页面不推送。
              </p>
              <button
                onClick={async () => {
                  if (!("Notification" in window)) {
                    set({ error: "浏览器不支持网页通知" });
                    return;
                  }
                  const p = await Notification.requestPermission();
                  set({
                    notice:
                      p === "granted" ? "网页通知已允许" : "未允许网页通知",
                  });
                  if (p === "granted") void notify();
                }}
              >
                允许网页通知
              </button>
              <ul>
                {s.notifications.map((n) => (
                  <li key={n.id}>
                    <span>
                      {n.readAt ? "已读" : "未读"}{" "}
                      {n.missed ? "离线期间到期 · " : ""}
                      {n.source.title}{" "}
                      {n.source.allDay
                        ? `${n.source.start} (${n.source.timeZone})`
                        : n.source.reminderAt}
                    </span>
                    <button
                      onClick={async () => {
                        try {
                          open(
                            n.source.kind,
                            await call(
                              `${n.source.kind === "task" ? "tasks" : "calendar"}/read`,
                              { id: n.source.id },
                            ),
                          );
                        } catch (e) {
                          set({ error: e.message });
                        }
                      }}
                    >
                      查看来源
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          await call("reminders/read", { id: n.id });
                          await refresh();
                        } catch (e) {
                          set({ error: e.message });
                        }
                      }}
                    >
                      标为已读
                    </button>
                  </li>
                ))}
              </ul>
              {s.offset !== null && (
                <button onClick={() => refresh(true)}>加载更多提醒</button>
              )}
            </>
          )}
        </>
      )}
      {s.editor && (
        <form
          className="planner-editor"
          aria-label="事项详情"
          onSubmit={save}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => (composing.current = false)}
        >
          <h2>{s.editor.kind === "task" ? "任务详情" : "日程详情"}</h2>
          <label>
            标题
            <input
              ref={title}
              required
              maxLength={200}
              value={s.editor.value.title}
              onChange={(e) => edit("title", e.target.value)}
            />
          </label>
          <label>
            说明
            <textarea
              aria-label="说明"
              maxLength={20000}
              value={s.editor.value.body}
              onChange={(e) => edit("body", e.target.value)}
            />
          </label>
          <label>
            状态
            <select
              aria-label="状态"
              value={s.editor.value.status}
              onChange={(e) => edit("status", e.target.value)}
            >
              {options(
                s.editor.kind === "task"
                  ? [
                      ["open", "未完成／恢复"],
                      ["done", "完成"],
                      ["cancelled", "取消"],
                    ]
                  : [
                      ["active", "有效"],
                      ["cancelled", "取消"],
                    ],
              )}
            </select>
          </label>
          {s.editor.kind === "task" ? (
            <>
              {field("计划日期", "plannedDate", "date")}
              {field("清单", "list")}
              <label>
                优先级
                <select
                  aria-label="优先级"
                  value={s.editor.value.priority}
                  onChange={(e) => edit("priority", e.target.value)}
                >
                  {options(priorities)}
                </select>
              </label>
              <label>
                截止类型
                <select
                  aria-label="截止类型"
                  value={s.editor.value.due?.kind ?? ""}
                  onChange={(e) =>
                    edit(
                      "due",
                      e.target.value
                        ? {
                            kind: e.target.value,
                            ...(e.target.value === "date"
                              ? {
                                  date: Temporal.Now.plainDateISO(
                                    s.zone,
                                  ).toString(),
                                }
                              : { at: new Date().toISOString() }),
                            timeZone: s.zone,
                          }
                        : null,
                    )
                  }
                >
                  {options([
                    ["", "无截止"],
                    ["date", "日期"],
                    ["instant", "精确时间"],
                  ])}
                </select>
              </label>
              {s.editor.value.due && (
                <>
                  <label>
                    截止
                    <input
                      type={
                        s.editor.value.due.kind === "date" ? "date" : "text"
                      }
                      value={s.editor.value.due.date ?? s.editor.value.due.at}
                      onChange={(e) =>
                        edit("due", {
                          ...s.editor.value.due,
                          [s.editor.value.due.kind === "date" ? "date" : "at"]:
                            e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    截止时区
                    <input
                      value={s.editor.value.due.timeZone}
                      onChange={(e) =>
                        edit("due", {
                          ...s.editor.value.due,
                          timeZone: e.target.value,
                        })
                      }
                    />
                  </label>
                </>
              )}
            </>
          ) : (
            <>
              <label>
                全天
                <input
                  type="checkbox"
                  checked={s.editor.value.allDay}
                  onChange={(e) => {
                    const day = Temporal.Now.plainDateISO(s.zone).toString();
                    set((old) => ({
                      editor: {
                        ...old.editor,
                        value: {
                          ...old.editor.value,
                          allDay: e.target.checked,
                          start: e.target.checked
                            ? day
                            : localInstant(`${day}T09:00`, s.zone),
                          end: e.target.checked
                            ? Temporal.PlainDate.from(day)
                                .add({ days: 1 })
                                .toString()
                            : localInstant(`${day}T09:30`, s.zone),
                        },
                      },
                    }));
                  }}
                />
              </label>
              <label>
                开始
                <input
                  type={s.editor.value.allDay ? "date" : "text"}
                  value={s.editor.value.start}
                  onChange={(e) => {
                    try {
                      const shifted = shiftStart(
                        s.editor.value,
                        e.target.value,
                      );
                      set((old) => ({
                        editor: {
                          ...old.editor,
                          value: { ...old.editor.value, ...shifted },
                        },
                      }));
                    } catch {
                      edit("start", e.target.value);
                    }
                  }}
                />
              </label>
              {field(
                "结束（全天结束日期不含当天）",
                "end",
                s.editor.value.allDay ? "date" : "text",
              )}
              {field("日程原时区", "timeZone")}
              {field("地点", "location")}
              <label>
                关联任务
                <select
                  aria-label="关联任务"
                  value={s.editor.value.taskId ?? ""}
                  onChange={(e) => edit("taskId", e.target.value || null)}
                >
                  {options([
                    ["", "独立事件"],
                    ...s.items.map((t) => [t.id, t.title]),
                  ])}
                </select>
              </label>
              {!s.editor.value.allDay &&
                [30, 60].map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    onClick={() => {
                      try {
                        const value = shiftStart(
                          s.editor.value,
                          s.editor.value.start,
                          minutes,
                        );
                        set((old) => ({
                          editor: {
                            ...old.editor,
                            value: { ...old.editor.value, ...value },
                          },
                        }));
                      } catch (e) {
                        set({ error: e.message });
                      }
                    }}
                  >
                    {minutes} 分钟
                  </button>
                ))}
            </>
          )}
          {field("提醒时间（含 UTC 或偏移，留空关闭）", "reminderAt")}
          {s.editor.latest && (
            <section>
              <h3>服务器最新内容</h3>
              <pre>{JSON.stringify(s.editor.latest, null, 2)}</pre>
              <button
                type="button"
                onClick={() =>
                  set({
                    editor: {
                      ...s.editor,
                      item: s.editor.latest,
                      latest: null,
                    },
                  })
                }
              >
                保留输入，按最新版本编辑
              </button>
              <button
                type="button"
                onClick={() =>
                  set({
                    editor: {
                      ...s.editor,
                      item: s.editor.latest,
                      value: strip(s.editor.latest),
                      latest: null,
                    },
                  })
                }
              >
                采用服务器内容
              </button>
            </section>
          )}
          <footer>
            <button type="submit" disabled={s.busy || Boolean(s.pending)}>
              {s.busy ? "保存中…" : "保存"}
            </button>
            <button
              type="button"
              disabled={s.busy || Boolean(s.pending)}
              onClick={() => {
                if (window.confirm("关闭编辑并放弃未提交的修改？")) {
                  set({ editor: null });
                  returnFocus.current?.focus();
                }
              }}
            >
              关闭
            </button>
            {s.editor.item && (
              <button
                type="button"
                disabled={s.busy || Boolean(s.pending)}
                onClick={latest}
              >
                查看最新记录
              </button>
            )}
            {s.pending && (
              <>
                <button type="button" disabled={s.busy} onClick={reconcile}>
                  核对操作
                </button>
                {s.notice === "未找到回执，可重试原请求" && (
                  <button
                    type="button"
                    disabled={s.busy}
                    onClick={() => submit(s.pending)}
                  >
                    重试原请求
                  </button>
                )}
              </>
            )}
          </footer>
        </form>
      )}
    </section>
  );
}
