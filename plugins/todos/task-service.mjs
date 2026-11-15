import {
  date,
  dueValue,
  dueInstant,
  dayAt,
  Temporal,
  fail,
  instant,
} from "./date-values.mjs";
export function fields(value, allowed) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !allowed.includes(k))
  )
    throw fail("请求含有不支持的字段");
}
export function text(value, max, required = false) {
  if (
    typeof value !== "string" ||
    !value.isWellFormed() ||
    value.includes("\0") ||
    [...value].length > max ||
    (required && !value.trim())
  )
    throw fail("文字为空或超出长度限制");
  return required ? value.trim() : value;
}
export function taskValue(value) {
  fields(value, [
    "title",
    "body",
    "status",
    "plannedDate",
    "due",
    "priority",
    "list",
    "reminderAt",
  ]);
  const {
    title,
    body = "",
    status = "open",
    plannedDate = null,
    due = null,
    priority = "normal",
    list = "",
    reminderAt = null,
  } = value;
  if (
    !["open", "done", "cancelled"].includes(status) ||
    !["normal", "high", "urgent"].includes(priority)
  )
    throw fail("状态或优先级无效");
  return {
    title: text(title, 200, true),
    body: text(body, 20000),
    status,
    plannedDate: plannedDate === null ? null : date(plannedDate),
    due: dueValue(due),
    priority,
    list: text(list, 100),
    reminderAt: reminderAt === null ? null : instant(reminderAt),
  };
}
export function classify(task, events, timeZone, now) {
  const today = dayAt(now, timeZone),
    due = dueInstant(task.due);
  const dueDay = task.due
    ? task.due.kind === "date"
      ? task.due.date
      : dayAt(task.due.at, timeZone)
    : null;
  const blocks = events.filter(
    (e) => e.taskId === task.id && e.status === "active",
  );
  const days = blocks.map((e) =>
    e.allDay ? e.start : dayAt(e.start, timeZone),
  );
  const overdue = due && Temporal.Instant.compare(now, due) >= 0;
  const earlier = task.plannedDate && task.plannedDate < today;
  const scheduled =
    task.plannedDate === today || dueDay === today || days.includes(today);
  const future =
    [task.plannedDate, dueDay, ...days]
      .filter((d) => d && d > today)
      .sort()[0] ?? null;
  return {
    overdue: Boolean(overdue),
    group: overdue
      ? "逾期截止"
      : scheduled
        ? "今日安排"
        : earlier
          ? "此前计划未完成"
          : null,
    future,
    inbox:
      !task.list &&
      !task.plannedDate &&
      !task.due &&
      !blocks.some((e) =>
        e.allDay ? e.end > today : Temporal.Instant.compare(e.end, now) > 0,
      ),
  };
}
