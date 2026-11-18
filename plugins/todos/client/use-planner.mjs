import { uiText } from './i18n.mjs';
import { loadPlannerTasks } from "./planner-queries.mjs";
import { useSyncExternalStore, useEffect, useRef, useMemo } from "react";
import { createPlannerApi, PLANNER_READ_TIMEOUT_MS } from "./planner-api.mjs";
import { usePlannerEditor } from "./use-planner-editor.mjs";
import styles from "./planner.css";
let retained;
function plannerStore(identity) {
  if (retained && retained.get().identity === identity) return retained;
  const listeners = new Set();
  let snapshot = {
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
  };
  const get = () => snapshot;
  function set(change) {
    const patch = typeof change === "function" ? change(snapshot) : change;
    if (!patch) return;
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  }
  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
  const call = createPlannerApi(identity);
  let generation = 0;
  async function refresh(more = false) {
    const m = get();
    const g = ++generation;
    // Save completion can wait for this read. Bound the whole refresh, including pagination.
    const signal = AbortSignal.timeout(PLANNER_READ_TIMEOUT_MS);
    const read = (method, args) => call(method, args, signal);
    try {
      let change;
      if (m.view === "reminders") {
        const p = await read("reminders/list", { offset: more ? m.offset : 0 });
        change = {
          notifications: more ? [...m.notifications, ...p.items] : p.items,
          offset: p.nextOffset,
        };
      } else if (m.view === "calendar") {
        if (!m.range) return;
        const tasks = await loadPlannerTasks(read, m, more);
        const events = more
          ? {}
          : await read("calendar/range", { ...m.range, timeZone: m.zone });
        change = {
          ...tasks,
          ...(!more ? { events: events.items, deadlines: events.tasks } : {}),
        };
      } else {
        change = await loadPlannerTasks(read, m, more);
      }
      if (g === generation) set(change);
    } catch (e) {
      if (g === generation) set({ error: signal.aborted ? "刷新超时，请重试" : e.message });
    }
  }
  retained = { get, set, subscribe, call, refresh };
  return retained;
}

export function usePlanner(identity) {
  // The host unmounts this panel on navigation. Outstanding requests and
  // remounted editors must complete against the same per-library snapshot.
  const { get, set, subscribe, call, refresh } = useMemo(() => plannerStore(identity), [identity]);
  const s = useSyncExternalStore(subscribe, get);
  const mounted = useRef(true);
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
            body: uiText("可里站内提醒，请打开页面查看"),
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
      if (get().editor || get().pending) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    const timer = setInterval(() => {
      if (get().confirmed && !get().busy) {
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
  }, [get, refresh]);
  useEffect(() => {
    if (s.confirmed) void refresh();
  }, [refresh, s.view, s.query, s.list, s.priority, s.zone, s.confirmed, s.range]);
  const editor = usePlannerEditor({ get, set, call, refresh });
  return { s, set, call, refresh, notify, ...editor };
}
