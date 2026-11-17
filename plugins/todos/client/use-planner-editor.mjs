import { uiText } from './i18n.mjs';
import { useRef } from "react";
import { v4 as uuid } from "uuid";
import { Temporal } from "./planner-dates.mjs";
import { strip } from "./planner-record.mjs";
import { plannerDraftChanged } from "./planner-present.mjs";
export function usePlannerEditor({ s, set, ref, call, refresh }) {
  const title = useRef(),
    returnFocus = useRef(),
    composing = useRef(false);
  // React may batch several clicks before pending/busy reaches the next render.
  const networkBusy = useRef(false);
  function open(kind, item = null, defaults = {}) {
    if (ref.current.pending || ref.current.busy) return;
    if (plannerDraftChanged(ref.current.editor) && !window.confirm(uiText("放弃当前未提交的编辑？"))) return;
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
    const e = ref.current.editor;
    if (p.operation === "task-status") {
      set({ notice: value.status === "done" ? "任务已完成" : "任务已恢复" });
    } else if (e) {
      const changed = JSON.stringify(e.value) !== JSON.stringify(p.snapshot);
      set({
        editor: { ...e, item: value, value: changed ? e.value : strip(value), conflict: false, latest: null },
        notice: changed ? "提交快照已保存，后续输入仍未保存" : "已保存",
      });
    }
    // The write is confirmed, but controls stay busy until its refresh completes.
    // submit/reconcile release the synchronous lock and UI state together.
    set({ pending: null, error: "" });
    await refresh();
  }
  async function submit(p) {
    if (networkBusy.current) return;
    networkBusy.current = true;
    set({ busy: true, error: "" });
    try {
      await accept(await call(p.method, p.args), p);
    } catch (e) {
      set((old) => ({
        ...(e.code === "schedule/409" && p.operation !== "task-status" && old.editor
          ? { editor: { ...old.editor, conflict: true, latest: null } }
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
      networkBusy.current = false;
      set({ busy: false });
    }
  }
  async function toggleTask(item) {
    const current = ref.current;
    if (networkBusy.current || current.pending || current.busy || current.editor) return;
    const p = {
      operation: "task-status",
      method: "tasks/update",
      args: { requestId: uuid(), id: item.id, expected: item.version, patch: { status: item.status === "open" ? "done" : "open" } },
    };
    set({ pending: p });
    await submit(p);
  }
  async function save(event) {
    event.preventDefault();
    if (composing.current || networkBusy.current || ref.current.pending || ref.current.busy) return;
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
    const p = ref.current.pending;
    if (!p || networkBusy.current || ref.current.busy) return;
    networkBusy.current = true;
    set({ busy: true });
    try {
      const r = await call("requests/read", { requestId: p.args.requestId });
      if (r.found) await accept(r.value, p);
      else set({ notice: "未找到回执，可重试原请求" });
    } catch (e) {
      set({ error: e.message });
    } finally {
      networkBusy.current = false;
      set({ busy: false });
    }
  }
  async function latest() {
    try {
      const e = ref.current.editor;
      if (!e?.conflict || !e.item) return;
      const item = await call(
        `${e.kind === "task" ? "tasks" : "calendar"}/read`,
        { id: e.item.id },
      );
      set((current) =>
        current.editor?.conflict && current.editor.kind === e.kind &&
        current.editor.item?.id === e.item.id &&
        current.editor.item.version === e.item.version
          ? { editor: { ...current.editor, latest: item } }
          : {},
      );
    } catch (e) {
      set({ error: e.message });
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
