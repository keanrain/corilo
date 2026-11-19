import { uiText } from './i18n.mjs';
import { useRef } from "react";
import { v4 as uuid } from "uuid";
import { Temporal } from "./planner-dates.mjs";
import { newTaskDefaults } from "./planner-defaults.mjs";
import { strip } from "./planner-record.mjs";
import { plannerDraftChanged } from "./planner-present.mjs";
import { PLANNER_READ_TIMEOUT_MS } from "./planner-api.mjs";
export function usePlannerEditor({ get, set, call, refresh }) {
  const title = useRef(),
    returnFocus = useRef(),
    composing = useRef(false);
  function open(kind, item = null, defaults = {}) {
    const { pending, busy, editor, zone, view, list } = get();
    if (pending || busy) return;
    if (plannerDraftChanged(editor) && !window.confirm(uiText("放弃当前未提交的编辑？"))) return;
    returnFocus.current = document.activeElement;
    const day = Temporal.Now.plainDateISO(zone).toString();
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
            ...newTaskDefaults({ view, list, zone }),
            ...defaults,
          }
        : {
            title: "",
            body: "",
            status: "active",
            allDay: true,
            start: day,
            end: Temporal.PlainDate.from(day).add({ days: 1 }).toString(),
            timeZone: zone,
            taskId: null,
            location: "",
            reminderAt: null,
            ...defaults,
          };
    set({ editor: { kind, item, value, initial: structuredClone(value) }, error: "", notice: "" });
    setTimeout(() => title.current?.focus(), 0);
    return true;
  }
  const edit = (k, v) =>
    set((old) => ({
      editor: { ...old.editor, value: { ...old.editor.value, [k]: v } },
      notice: "未保存",
    }));
  async function accept(value, p) {
    const e = get().editor;
    const settled = { pending: null, error: "" };
    if (p.operation === "task-status") {
      set({ ...settled, notice: value.status === "done" ? "任务已完成" : "任务已恢复" });
    } else if (e) {
      const changed = JSON.stringify(e.value) !== JSON.stringify(p.snapshot);
      set({
        ...settled,
        editor: { ...e, item: value, value: changed ? e.value : strip(value), conflict: false, latest: null },
        notice: changed ? "提交快照已保存，后续输入仍未保存" : "已保存",
      });
    } else set(settled);
    await refresh();
  }
  async function submit(p) {
    const { busy, pending } = get();
    if (busy || (pending && pending !== p)) return;
    set({ busy: true, pending: p, error: "" });
    try {
      await accept(await call(p.method, p.args), p);
    } catch (e) {
      set((old) => ({
        ...(e.code === "schedule/409" && p.operation !== "task-status" && old.editor
          ? { editor: { ...old.editor, conflict: true, latest: null, latestRequest: null } }
          : {}),
        pending: e.unknown ? p : null,
        error: e.message,
        notice: e.unknown
          ? "保存结果未知，请先核对操作"
          : e.code === "schedule/409"
            ? p.operation === "task-status" ? "任务已更新，请核对后重试" : "版本冲突，请查看最新记录"
            : "保存失败",
      }));
      if (p.operation === "task-status" && e.code === "schedule/409") await refresh();
    } finally {
      set({ busy: false });
    }
  }
  async function toggleTask(item) {
    const current = get();
    if (current.pending || current.busy || current.editor) return;
    const p = {
      operation: "task-status",
      method: "tasks/update",
      args: { requestId: uuid(), id: item.id, expected: item.version, patch: { status: item.status === "open" ? "done" : "open" } },
    };
    await submit(p);
  }
  async function save(event) {
    event.preventDefault();
    const { busy, pending, editor } = get();
    if (composing.current || pending || busy || !editor) return;
    const { kind, item, value } = editor;
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
    await submit(p);
  }
  async function reconcile() {
    const { pending: p, busy } = get();
    if (!p || busy) return;
    set({ busy: true });
    try {
      const r = await call("requests/read", { requestId: p.args.requestId });
      if (r.found) await accept(r.value, p);
      else set({ notice: "未找到回执，可重试原请求" });
    } catch (e) {
      set({ error: e.message });
    } finally {
      set({ busy: false });
    }
  }
  async function latest() {
    const { editor, busy, pending } = get();
    if (busy || pending || !editor?.conflict || !editor.item) return;
    const request = Symbol();
    set({ editor: { ...editor, latest: null, latestRequest: request } });
    try {
      const item = await call(
        `${editor.kind === "task" ? "tasks" : "calendar"}/read`,
        { id: editor.item.id },
        AbortSignal.timeout(PLANNER_READ_TIMEOUT_MS),
      );
      const current = get().editor;
      if (current?.conflict && current.latestRequest === request) {
        set({ editor: { ...current, latest: item, latestRequest: null } });
      }
    } catch (e) {
      const current = get().editor;
      if (current?.conflict && current.latestRequest === request) {
        set({ editor: { ...current, latestRequest: null }, error: e.message });
      }
    }
  }
  return {
    open,
    toggleTask,
    edit,
    save,
    title,
    returnFocus,
    composing,
    latest,
    reconcile,
    submit,
  };
}
