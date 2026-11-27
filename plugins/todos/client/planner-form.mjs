import { Temporal, localInstant, dayAt } from "./planner-dates.mjs";

// Views where a saved event is visible (Calendar, and Today's agenda).
export const eventViews = ["today", "calendar"];

// All-day <-> timed. The event keeps its own date and zone; a wall-clock time
// that does not exist throws (reject disambiguation) instead of being guessed.
export function toggleAllDay(value, allDay) {
  const zone = value.timeZone;
  if (allDay) {
    const start = dayAt(value.start, zone);
    return { allDay: true, start, end: Temporal.PlainDate.from(start).add({ days: 1 }).toString() };
  }
  const day = value.start;
  return {
    allDay: false,
    start: localInstant(`${day}T09:00`, zone),
    end: localInstant(`${day}T09:30`, zone),
  };
}

// Storage ends an all-day event on an exclusive date; the form shows the last day.
export function formEnd(value) {
  if (!value.allDay || !value.end) return value.end;
  try { return Temporal.PlainDate.from(value.end).subtract({ days: 1 }).toString(); } catch { return value.end; }
}
export function storageEnd(day) {
  if (!day) return day;
  try { return Temporal.PlainDate.from(day).add({ days: 1 }).toString(); } catch { return day; }
}
export function eventEndError(value) {
  if (!value.allDay || !value.start || !value.end) return "";
  try {
    return Temporal.PlainDate.compare(formEnd(value), value.start) < 0 ? "结束日期不能早于开始日期" : "";
  } catch { return ""; }
}

// Folded ("更多") fields must never hide existing data.
export function moreHasValue(kind, value, zone) {
  if (value.body) return true;
  if (kind === "task") {
    return Boolean(value.list) || value.status !== "open" || value.priority !== "normal"
      || Boolean(value.due && value.due.timeZone !== zone);
  }
  return Boolean(value.location) || value.status !== "active" || Boolean(value.taskId) || value.timeZone !== zone;
}
