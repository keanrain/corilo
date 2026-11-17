import { uiText } from './i18n.mjs';
import React from "react";
import { Bell } from 'lucide-react';
export function PlannerReminders({ s, set, open, refresh, call, notify }) {
  return (
    <>
      <div className="planner-reminders-intro"><p>{uiText("持久站内提醒；网页通知只在页面打开时尝试发送，关闭页面不推送。")}</p>
      <button
        onClick={async () => {
          if (!("Notification" in window)) {
            set({ error: "浏览器不支持网页通知" });
            return;
          }
          const p = await Notification.requestPermission();
          set({
            notice: p === "granted" ? "网页通知已允许" : "未允许网页通知",
          });
          if (p === "granted") void notify();
        }}
      >{uiText("允许网页通知")}</button></div>
      {!s.notifications.length && <div className="planner-empty"><Bell size={32} strokeWidth={1.3} aria-hidden="true" /><h2>{uiText("还没有提醒")}</h2></div>}
      <ul className="planner-reminder-list">
        {s.notifications.map((n) => (
          <li key={n.id} data-read={Boolean(n.readAt)}>
            <Bell size={18} aria-hidden="true" />
            <div className="planner-reminder-copy"><p>{n.source.title}</p><small>
              {n.readAt ? uiText("已读") : uiText("未读")} · {n.missed ? uiText("离线期间到期 · ") : ""}
              {n.source.allDay
                ? `${n.source.start} (${n.source.timeZone})`
                : n.source.reminderAt}
            </small></div>
            <div className="planner-reminder-actions">
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
            >{uiText("查看来源")}</button>
            <button
              onClick={async () => {
                try {
                  await call("reminders/read", { id: n.id });
                  await refresh();
                } catch (e) {
                  set({ error: e.message });
                }
              }}
            >{uiText("标为已读")}</button></div>
          </li>
        ))}
      </ul>
      {s.offset !== null && (
        <button onClick={() => refresh(true)}>{uiText("加载更多提醒")}</button>
      )}
    </>
  );
}
