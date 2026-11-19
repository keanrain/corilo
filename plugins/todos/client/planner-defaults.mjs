import { Temporal } from "./planner-dates.mjs";

// A task added from a view should stay in that view after saving: Today gets
// today's date, Future gets tomorrow, and an active list filter fills the list.
export function newTaskDefaults({ view, list, zone }) {
  const today = Temporal.Now.plainDateISO(zone);
  const defaults = {};
  if (view === "today") defaults.plannedDate = today.toString();
  if (view === "future") defaults.plannedDate = today.add({ days: 1 }).toString();
  if (list && !["done", "cancelled"].includes(view)) defaults.list = list;
  return defaults;
}
