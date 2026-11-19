import React from "react";
import { CalendarClock, Link2, MapPin } from "lucide-react";
import { uiText } from "./i18n.mjs";
import { agendaRows } from "./planner-agenda.mjs";

export function PlannerAgenda({ s, open }) {
  if (!s.agenda?.length) return null;
  return (
    <section className="planner-agenda" aria-label={uiText("今日日程")}>
      <h2 className="planner-group-heading"><CalendarClock size={14} aria-hidden="true" />{uiText("今日日程")}<small>{s.agenda.length}</small></h2>
      <ul>
        {agendaRows(s.agenda, s.zone).map(({ item, allDay, from, to }) => (
          <li key={item.id}>
            <button type="button" disabled={s.busy || Boolean(s.pending)} onClick={() => open("event", item)}>
              <span className="planner-agenda-time">{allDay ? uiText("全天") : `${from ?? "…"}–${to ?? "…"}`}</span>
              <span className="planner-agenda-title">{item.title}</span>
              {item.location && <span className="planner-agenda-meta"><MapPin size={12} aria-hidden="true" />{item.location}</span>}
              {item.taskId && <span className="planner-agenda-meta" title={uiText("任务时间块")}><Link2 size={12} aria-hidden="true" /></span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
