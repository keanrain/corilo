import { uiText } from './i18n.mjs';
import { loadPlannerTasks } from "./planner-queries.mjs";
import { useState, useEffect, useRef, useMemo } from "react";
import { createPlannerApi } from "./planner-api.mjs";
import { usePlannerEditor } from "./use-planner-editor.mjs";
import styles from "./planner.css";
let retained;
export function usePlanner(identity) {
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
  const generation = useRef(0),
    mounted = useRef(true);
  const call = useMemo(() => createPlannerApi(identity), [identity]);
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
        const tasks = await loadPlannerTasks(call, m, more);
        const events = more
          ? {}
          : await call("calendar/range", { ...m.range, timeZone: m.zone });
        change = {
          ...tasks,
          ...(!more ? { events: events.items, deadlines: events.tasks } : {}),
        };
      } else {
        change = await loadPlannerTasks(call, m, more);
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
  const editor = usePlannerEditor({ s, set, ref, call, refresh });
  return { s, set, call, refresh, notify, ...editor };
}
