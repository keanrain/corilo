import { Temporal } from "./planner-dates.mjs";

// Today's events, ordered for reading: all-day first, then by start time in
// the display zone. Spans that begin before or end after today are marked.
export function agendaRows(items, zone, now = Temporal.Now.instant()) {
  const today = now.toZonedDateTimeISO(zone).toPlainDate();
  const hm = (z) => z.toPlainTime().toString({ smallestUnit: "minute" });
  return items
    .map((item) => {
      if (item.allDay) return { item, allDay: true, sort: -1, from: null, to: null };
      const start = Temporal.Instant.from(item.start).toZonedDateTimeISO(zone);
      const end = Temporal.Instant.from(item.end).toZonedDateTimeISO(zone);
      const startsToday = Temporal.PlainDate.compare(start.toPlainDate(), today) === 0;
      const endsToday = Temporal.PlainDate.compare(end.toPlainDate(), today) === 0;
      return {
        item,
        allDay: false,
        sort: startsToday ? start.epochMilliseconds : 0,
        from: startsToday ? hm(start) : null,
        to: endsToday ? hm(end) : null,
      };
    })
    .sort((a, b) => a.sort - b.sort || a.item.title.localeCompare(b.item.title));
}
