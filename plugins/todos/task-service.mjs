import {
  date,
  dueValue,
  dueInstant,
  dayAt,
  dayStart,
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
// Compute once per task's blocks; callers can group a single event scan by task.
export function taskClock(timeZone, now) {
  const today = dayAt(now, timeZone);
  const tomorrow = Temporal.PlainDate.from(today).add({ days: 1 }).toString();
  const startOfToday = dayStart(today, timeZone),
    startOfTomorrow = dayStart(tomorrow, timeZone);
  return { today, tomorrow, startOfToday, startOfTomorrow };
}
export function summarizeBlocks(
  blocks,
  timeZone,
  now,
  clock = taskClock(timeZone, now),
) {
  const { today, tomorrow, startOfToday, startOfTomorrow } = clock;
  let scheduled = false,
    upcoming = false,
    future = null;
  for (const event of blocks) {
    if (event.status !== "active") continue;
    let futureDay = null;
    if (event.allDay) {
      scheduled ||= event.start < tomorrow && event.end > today;
      upcoming ||= event.end > today;
      if (event.end > tomorrow)
        futureDay = event.start > tomorrow ? event.start : tomorrow;
    } else {
      scheduled ||=
        Temporal.Instant.compare(event.start, startOfTomorrow) < 0 &&
        Temporal.Instant.compare(event.end, startOfToday) > 0;
      upcoming ||= Temporal.Instant.compare(event.end, now) > 0;
      if (Temporal.Instant.compare(event.end, startOfTomorrow) > 0)
        futureDay =
          Temporal.Instant.compare(event.start, startOfTomorrow) > 0
            ? dayAt(event.start, timeZone)
            : tomorrow;
    }
    if (futureDay && (!future || futureDay < future)) future = futureDay;
  }
  return { scheduled, upcoming, future };
}
export function classifyWithSchedule(
  task,
  schedule,
  timeZone,
  now,
  clock = taskClock(timeZone, now),
) {
  const today = clock.today,
    due = dueInstant(task.due);
  const dueDay = task.due
    ? task.due.kind === "date"
      ? task.due.date
      : dayAt(task.due.at, timeZone)
    : null;
  const overdue = Boolean(due && Temporal.Instant.compare(now, due) >= 0);
  const earlier = task.plannedDate && task.plannedDate < today;
  const scheduled =
    task.plannedDate === today || dueDay === today || schedule.scheduled;
  const future =
    [task.plannedDate, dueDay, schedule.future]
      .filter((d) => d && d > today)
      .sort()[0] ?? null;
  return {
    overdue,
    group: overdue
      ? "逾期截止"
      : scheduled
        ? "今日安排"
        : earlier
          ? "此前计划未完成"
          : null,
    future,
    inbox: !task.list && !task.plannedDate && !task.due && !schedule.upcoming,
  };
}
export function classify(task, events, timeZone, now) {
  return classifyWithSchedule(
    task,
    summarizeBlocks(
      events.filter((e) => e.taskId === task.id),
      timeZone,
      now,
    ),
    timeZone,
    now,
  );
}
