import React from "react";
import { options, priorities } from "./planner-fields.jsx";
import { strip } from "./planner-record.mjs";
import { shiftStart, localInstant, Temporal } from "./planner-dates.mjs";
export function PlannerEditor({
  s,
  set,
  edit,
  save,
  title,
  composing,
  returnFocus,
  latest,
  reconcile,
  submit,
}) {
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
  return (
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
                  type={s.editor.value.due.kind === "date" ? "date" : "text"}
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
                  const shifted = shiftStart(s.editor.value, e.target.value);
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
  );
}
