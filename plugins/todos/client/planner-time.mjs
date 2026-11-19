import { Temporal } from "./planner-dates.mjs";

// Pure helpers behind the date + time controls. Storage keeps exact instants;
// people type a wall-clock date and time in a named zone.

export function splitInstant(value, zone) {
  if (!value) return { date: "", time: "" };
  try {
    const local = Temporal.Instant.from(value).toZonedDateTimeISO(zone);
    return {
      date: local.toPlainDate().toString(),
      time: local.toPlainTime().toString({ smallestUnit: "minute" }),
    };
  } catch {
    return { date: "", time: "" };
  }
}

const offsetOf = (zoned) => zoned.offset;

// Resolve a wall-clock date and time in a zone. A time that does not exist
// (spring-forward gap) or exists twice (fall-back overlap) is never guessed:
// the caller gets the explicit candidates, each with its UTC offset.
export function resolveLocal(date, time, zone) {
  if (!date || !time) return { kind: "incomplete" };
  let local;
  try {
    local = Temporal.PlainDateTime.from(`${date}T${time}`);
    Temporal.Now.zonedDateTimeISO(zone);
  } catch {
    return { kind: "invalid" };
  }
  try {
    const exact = local.toZonedDateTime(zone, { disambiguation: "reject" });
    return { kind: "exact", instant: exact.toInstant().toString() };
  } catch {
    const earlier = local.toZonedDateTime(zone, { disambiguation: "earlier" });
    const later = local.toZonedDateTime(zone, { disambiguation: "later" });
    const candidates = [earlier, later]
      .filter((z, i, all) => all.findIndex((o) => o.epochNanoseconds === z.epochNanoseconds) === i)
      .map((z) => ({
        instant: z.toInstant().toString(),
        label: `${z.toPlainTime().toString({ smallestUnit: "minute" })} (UTC${offsetOf(z)})`,
      }));
    // Two equal-wall-clock instants = overlap; a shifted single one = gap.
    const overlap = earlier.toPlainDateTime().equals(later.toPlainDateTime());
    return { kind: overlap ? "ambiguous" : "missing", candidates };
  }
}

export function isPast(instant, now = Temporal.Now.instant()) {
  if (!instant) return false;
  try {
    return Temporal.Instant.compare(Temporal.Instant.from(instant), now) <= 0;
  } catch {
    return false;
  }
}

const at = (date, hhmm, zone) =>
  resolveLocal(date, hhmm, zone).instant ?? null;

// Reminder shortcuts offered next to the controls; only future instants.
export function reminderShortcuts(value, kind, zone, now = Temporal.Now.instant()) {
  const today = now.toZonedDateTimeISO(zone).toPlainDate();
  const out = [];
  if (kind === "task") {
    const day = value.plannedDate ?? (value.due?.kind === "date" ? value.due.date : null);
    if (day) out.push({ key: "day-9", instant: at(day, "09:00", zone) });
    out.push({ key: "tomorrow-9", instant: at(today.add({ days: 1 }).toString(), "09:00", zone) });
  } else if (value.allDay) {
    out.push({ key: "day-9", instant: at(value.start, "09:00", zone) });
  } else {
    try {
      const start = Temporal.Instant.from(value.start);
      out.push({ key: "before-15", instant: start.subtract({ minutes: 15 }).toString() });
      out.push({ key: "before-60", instant: start.subtract({ hours: 1 }).toString() });
    } catch {
      // An unfinished start has no shortcuts yet.
    }
  }
  return out.filter((s) => s.instant && !isPast(s.instant, now));
}

// Exact and readable: wall-clock time in the zone plus its UTC offset.
export function exactLabel(value, zone) {
  if (!value) return value;
  try {
    const z = Temporal.Instant.from(value).toZonedDateTimeISO(zone);
    return `${z.toPlainDate()} ${z.toPlainTime().toString({ smallestUnit: "minute" })} (UTC${z.offset})`;
  } catch {
    return value;
  }
}
