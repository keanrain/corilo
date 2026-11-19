import { uiText } from './i18n.mjs';
import React, { useEffect, useRef } from "react";
import { X } from 'lucide-react';
import TextareaAutosize from 'react-textarea-autosize';
import { plannerDraftChanged } from './planner-present.mjs';
import { PlannerLatest } from './planner-latest.jsx';
import { options, priorities, useLinkedTaskLabel } from "./planner-fields.jsx";
import { strip } from "./planner-record.mjs";
import { shiftStart, localInstant, Temporal } from "./planner-dates.mjs";
import { PlannerTimeField } from "./planner-time-field.jsx";
import { reminderShortcuts } from "./planner-time.mjs";

const shortcutLabels = {
  "day-9": "当天 9:00",
  "tomorrow-9": "明天 9:00",
  "before-15": "开始前 15 分钟",
  "before-60": "开始前 1 小时",
};
export function PlannerEditor({
  s,
  set,
  call,
  edit,
  save,
  title,
  composing,
  returnFocus,
  latest,
  reconcile,
  submit,
}) {
  const form = useRef(null);
  const wasBusy = useRef(false);
  const dirty = plannerDraftChanged(s.editor);
  const taskId = s.editor.value.taskId;
  const previewTaskId = s.editor.latest?.taskId;
  const listedTask = s.items.find((task) => task.id === taskId);
  const linkedTaskLabel = useLinkedTaskLabel(call, taskId, listedTask?.title);
  const previewTaskLabel = useLinkedTaskLabel(
    call,
    previewTaskId === taskId ? null : previewTaskId,
    s.items.find((task) => task.id === previewTaskId)?.title,
  );
  useEffect(() => { title.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    if (wasBusy.current && !s.busy && document.activeElement === document.body) {
      form.current?.querySelector('footer button:not(:disabled)')?.focus({ preventScroll: true });
    }
    wasBusy.current = s.busy;
  }, [s.busy]);
  function onKeyDown(event) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape' && !event.defaultPrevented && event.target.tagName !== 'SELECT') {
      event.preventDefault(); event.stopPropagation(); close();
    }
    if (event.key !== 'Tab' || getComputedStyle(form.current).position !== 'fixed') return;
    const controls = [...form.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary')].filter(el => el.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if ((event.shiftKey && event.target === first) || (!event.shiftKey && event.target === last)) {
      event.preventDefault(); (event.shiftKey ? last : first)?.focus();
    }
  }
  function close() {
    if (s.busy || s.pending) return;
    if (!dirty || window.confirm(uiText("关闭编辑并放弃未提交的修改？"))) {
      set({ editor: null });
      returnFocus.current?.focus();
    }
  }
  function moveStart(next) {
    try {
      const shifted = shiftStart(s.editor.value, next);
      set((old) => ({ editor: { ...old.editor, value: { ...old.editor.value, ...shifted } } }));
    } catch {
      edit("start", next);
    }
  }
  const field = (label, k, type = "text") => (
    <label>
      {label}
      <input
        type={type}
        list={k === "timeZone" ? "corilo-planner-zones" : undefined}
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
      ref={form}
      className="planner-editor"
      onKeyDown={onKeyDown}
      aria-label={uiText("事项详情")}
      onSubmit={save}
      onCompositionStart={() => (composing.current = true)}
      onCompositionEnd={() => (composing.current = false)}
    >
      <div className="planner-editor-heading"><h2>{s.editor.kind === "task" ? uiText("任务详情") : uiText("日程详情")}</h2><button type="button" className="planner-icon-button" aria-label={uiText("关闭详情")} disabled={s.busy || Boolean(s.pending)} onClick={close}><X size={18} aria-hidden="true" /></button></div>
      {s.error && <p className="planner-alert" role="alert">{uiText(s.error)}</p>}
      <label className="planner-editor-title"><span className="planner-sr-only">{uiText("标题")}</span><TextareaAutosize
          ref={title}
          aria-label={uiText("标题")}
          minRows={1}
          maxRows={5}
          placeholder={uiText("要做什么？")}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
              event.preventDefault();
              form.current?.requestSubmit();
            }
          }}
          required
          maxLength={200}
          value={s.editor.value.title}
          onChange={(e) => edit("title", e.target.value)}
        />
      </label>
      <label className="planner-editor-description">{uiText("说明")}<TextareaAutosize
          minRows={3}
          maxRows={8}
          placeholder={uiText("添加说明…")}
          aria-label={uiText("说明")}
          maxLength={20000}
          value={s.editor.value.body}
          onChange={(e) => edit("body", e.target.value)}
        />
      </label>
      <label>{uiText("状态")}<select
          aria-label={uiText("状态")}
          value={s.editor.value.status}
          onChange={(e) => edit("status", e.target.value)}
        >
          {options(
            s.editor.kind === "task"
              ? [
                  ["open", uiText("未完成")],
                  ["done", uiText("完成")],
                  ["cancelled", uiText("取消")],
                ]
              : [
                  ["active", uiText("有效")],
                  ["cancelled", uiText("取消")],
                ],
          )}
        </select>
      </label>
      {s.editor.kind === "task" ? (
        <div className="planner-editor-properties">
          {field(uiText("计划日期"), "plannedDate", "date")}
          {field(uiText("清单"), "list")}
          <label>{uiText("优先级")}<select
              aria-label={uiText("优先级")}
              value={s.editor.value.priority}
              onChange={(e) => edit("priority", e.target.value)}
            >
              {options(priorities())}
            </select>
          </label>
          <label>{uiText("截止类型")}<select
              aria-label={uiText("截止类型")}
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
                ["", uiText("无截止")],
                ["date", uiText("日期")],
                ["instant", uiText("精确时间")],
              ])}
            </select>
          </label>
          {s.editor.value.due && (
            <>
              {s.editor.value.due.kind === "date" ? (
                <label>{uiText("截止")}<input
                    type="date"
                    value={s.editor.value.due.date}
                    onChange={(e) => edit("due", { ...s.editor.value.due, date: e.target.value })}
                  />
                </label>
              ) : (
                <PlannerTimeField
                  label={uiText("截止")}
                  value={s.editor.value.due.at}
                  zone={s.editor.value.due.timeZone}
                  onChange={(at) => edit("due", { ...s.editor.value.due, at })}
                />
              )}
              <label>{uiText("截止时区")}<input
                  list="corilo-planner-zones"
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
        </div>
      ) : (
        <div className="planner-editor-properties">
          <label>{uiText("全天")}<input
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
          {s.editor.value.allDay ? (
            <label>{uiText("开始")}<input
                type="date"
                value={s.editor.value.start}
                onChange={(e) => moveStart(e.target.value)}
              />
            </label>
          ) : (
            <PlannerTimeField label={uiText("开始")} value={s.editor.value.start}
              zone={s.editor.value.timeZone} onChange={moveStart} />
          )}
          {s.editor.value.allDay
            ? field(uiText("结束（全天结束日期不含当天）"), "end", "date")
            : <PlannerTimeField label={uiText("结束")} value={s.editor.value.end}
                zone={s.editor.value.timeZone} onChange={(end) => edit("end", end)} />}
          {field(uiText("日程原时区"), "timeZone")}
          {field(uiText("地点"), "location")}
          <label>{uiText("关联任务")}<select
              aria-label={uiText("关联任务")}
              value={s.editor.value.taskId ?? ""}
              onChange={(e) => edit("taskId", e.target.value || null)}
            >
              {options([
                ["", uiText("独立事件")],
                ...(taskId && !listedTask ? [[taskId, linkedTaskLabel]] : []),
                ...s.items.map((t) => [t.id, t.id === taskId ? linkedTaskLabel : t.title]),
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
                {minutes}{" "}{uiText("分钟")}</button>
            ))}
        </div>
      )}
      <PlannerTimeField label={uiText("提醒")} value={s.editor.value.reminderAt} zone={s.zone}
        clearable warnPast onChange={(at) => edit("reminderAt", at)}>
        <div className="planner-time-shortcuts">
          {reminderShortcuts(s.editor.value, s.editor.kind, s.zone).map((shortcut) => (
            <button key={shortcut.key} type="button" onClick={() => edit("reminderAt", shortcut.instant)}>{uiText(shortcutLabels[shortcut.key])}</button>
          ))}
        </div>
      </PlannerTimeField>
      {s.editor.latest && (
        <section>
          <h3>{uiText("服务器最新内容")}</h3>
          <PlannerLatest kind={s.editor.kind} value={s.editor.latest} zone={s.zone}
            linkedTaskLabel={previewTaskId === taskId ? linkedTaskLabel : previewTaskLabel} />
          <p className="planner-conflict-help">{uiText("保留输入会用当前表单的全部内容替换此版本，请先核对以上字段。")}</p>
          <button
            type="button"
            disabled={s.busy || Boolean(s.pending)}
            onClick={() =>
              set({
                editor: {
                  ...s.editor,
                  item: s.editor.latest,
                  latest: null,
                  conflict: false,
                },
                error: "",
                notice: "未保存",
              })
            }
          >{uiText("保留输入，按最新版本编辑")}</button>
          <button
            type="button"
            disabled={s.busy || Boolean(s.pending)}
            onClick={() =>
              set({
                editor: {
                  ...s.editor,
                  item: s.editor.latest,
                  value: strip(s.editor.latest),
                  latest: null,
                  conflict: false,
                },
                error: "",
                notice: "",
              })
            }
          >{uiText("采用服务器内容")}</button>
        </section>
      )}
      <footer>
        <p className="planner-editor-save-state" role="status">{s.notice ? uiText(s.notice) : ''}</p>
        <button type="submit" disabled={s.busy || Boolean(s.pending)}>
          {s.busy ? uiText("保存中…") : uiText("保存")}
        </button>
        <button
          type="button"
          disabled={s.busy || Boolean(s.pending)}
          onClick={close}
        >{uiText("关闭")}</button>
        {s.editor.item && s.editor.conflict && (
          <button
            type="button"
            disabled={s.busy || Boolean(s.pending)}
            onClick={latest}
          >{uiText("查看最新记录")}</button>
        )}
        {s.pending && (
          <>
            <button type="button" disabled={s.busy} onClick={reconcile}>{uiText("核对操作")}</button>
            {s.notice === "未找到回执，可重试原请求" && (
              <button
                type="button"
                disabled={s.busy}
                onClick={() => submit(s.pending)}
              >{uiText("重试原请求")}</button>
            )}
          </>
        )}
      </footer>
    </form>
  );
}
