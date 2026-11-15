import { useRef } from "react";
import { v4 as uuid } from "uuid";
import { Temporal } from "./planner-dates.mjs";
import { strip } from "./planner-record.mjs";
export function usePlannerEditor({ s, set, ref, call, refresh }) {
  const title = useRef(),
    returnFocus = useRef(),
    composing = useRef(false);
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
      set((current) =>
        current.editor?.kind === e.kind &&
        current.editor?.item?.id === e.item.id
          ? { editor: { ...current.editor, latest: item } }
          : {},
      );
    } catch (e) {
      set({ error: e.message });
    }
  }
  return {
    open,
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
