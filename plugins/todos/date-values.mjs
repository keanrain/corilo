import { Temporal } from "@js-temporal/polyfill";
export { Temporal };
export const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
export function date(value) {
  try {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw 0;
    return Temporal.PlainDate.from(value, { overflow: "reject" }).toString();
  } catch {
    throw fail("日期需为有效的 YYYY-MM-DD");
  }
}
export function zone(value) {
  try {
    if (typeof value !== "string" || /^[+-]/.test(value)) throw 0;
    Temporal.Now.instant().toZonedDateTimeISO(value);
    return value;
  } catch {
    throw fail("请选择有效的 IANA 时区");
  }
}
export function instant(value) {
  try {
    if (typeof value !== "string") throw 0;
    return Temporal.Instant.from(value).toString();
  } catch {
    throw fail("精确时间需包含 UTC 或明确偏移");
  }
}
export function localInstant(value, timeZone) {
  try {
    return Temporal.PlainDateTime.from(value)
      .toZonedDateTime(zone(timeZone), { disambiguation: "reject" })
      .toInstant()
      .toString();
  } catch {
    throw fail("此本地时间不存在或有歧义，请提供带偏移的精确时间");
  }
}
export const dayAt = (at, timeZone) =>
  Temporal.Instant.from(at)
    .toZonedDateTimeISO(zone(timeZone))
    .toPlainDate()
    .toString();
export const dayStart = (day, timeZone) =>
  Temporal.PlainDate.from(date(day))
    .toZonedDateTime(zone(timeZone))
    .toInstant()
    .toString();
export function dueValue(value) {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value))
    throw fail("截止格式无效");
  const timeZone = zone(value.timeZone);
  if (
    value.kind === "date" &&
    Object.keys(value).every((k) => ["kind", "date", "timeZone"].includes(k))
  )
    return { kind: "date", date: date(value.date), timeZone };
  if (
    value.kind === "instant" &&
    Object.keys(value).every((k) => ["kind", "at", "timeZone"].includes(k))
  )
    return { kind: "instant", at: instant(value.at), timeZone };
  throw fail("截止格式无效");
}
export const dueInstant = (due) =>
  !due
    ? null
    : due.kind === "instant"
      ? due.at
      : dayStart(
          Temporal.PlainDate.from(due.date).add({ days: 1 }).toString(),
          due.timeZone,
        );
export function range(value) {
  const timeZone = zone(value.timeZone);
  if (typeof value.allDay !== "boolean") throw fail("请选择全天或定时");
  const start = value.allDay ? date(value.start) : instant(value.start);
  const end = value.allDay ? date(value.end) : instant(value.end);
  const comparison = value.allDay
    ? Temporal.PlainDate.compare(start, end)
    : Temporal.Instant.compare(start, end);
  if (comparison >= 0) throw fail("结束必须晚于开始，全天结束日期不包含在内");
  return { allDay: value.allDay, start, end, timeZone };
}
export function shiftStart(value, nextStart, minutes) {
  const current = range(value);
  if (current.allDay) {
    const days = Temporal.PlainDate.from(current.start).until(current.end).days;
    return {
      ...current,
      start: date(nextStart),
      end: Temporal.PlainDate.from(nextStart).add({ days }).toString(),
    };
  }
  const start = instant(nextStart);
  const milliseconds =
    minutes === undefined
      ? Number(
          Temporal.Instant.from(current.end).epochMilliseconds -
            Temporal.Instant.from(current.start).epochMilliseconds,
        )
      : minutes * 60000;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0)
    throw fail("时长必须为正");
  return {
    ...current,
    start,
    end: Temporal.Instant.from(start).add({ milliseconds }).toString(),
  };
}
