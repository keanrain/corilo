import React, { useRef, useEffect } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGrid from "@fullcalendar/daygrid";
import timeGrid from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interaction, { Draggable } from "@fullcalendar/interaction";
import luxon from "@fullcalendar/luxon3";
import zh from "@fullcalendar/core/locales/zh-cn";
import { Temporal } from "./planner-dates.mjs";
import { strip } from "./planner-record.mjs";
export function PlannerCalendar({ s, set, open, refresh }) {
  const cal = useRef(),
    drags = useRef();
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
  return (
    <>
      <label>
        跳转日期
        <input
          type="date"
          onChange={(e) =>
            e.target.value && cal.current?.getApi().gotoDate(e.target.value)
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
          {s.cursor && (
            <button onClick={() => refresh(true)}>加载更多可安排任务</button>
          )}
        </aside>
        <FullCalendar
          ref={cal}
          plugins={[dayGrid, timeGrid, listPlugin, interaction, luxon]}
          locale={zh}
          initialView={window.innerWidth < 700 ? "listWeek" : "dayGridMonth"}
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
                info.date.getTime() + (info.allDay ? 86400000 : 1800000),
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
  );
}
