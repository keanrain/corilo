// Preserve the visible page count on polling. Explicit "more" loads one page;
// switching view/filter starts from the first page. No unbounded eager loading.
export async function loadPlannerTasks(call, model, more = false) {
  const args = {
    view: model.view === "calendar" ? "all" : model.view,
    timeZone: model.zone,
    ...(model.view === "calendar"
      ? {}
      : { query: model.query, list: model.list, priority: model.priority }),
  };
  const queryKey = JSON.stringify({ surface: model.view, ...args });
  const sameQuery = model.queryKey === queryKey;
  let cursor = more && sameQuery ? model.cursor : null;
  let items = more && sameQuery ? [...model.items] : [];
  const target = more
    ? items.length + 100
    : sameQuery
      ? Math.max(100, model.items.length)
      : 100;
  let page;
  do {
    page = await call("tasks/list", { ...args, cursor });
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor && items.length < target);
  return { items, cursor, total: page.total, counts: page.counts, queryKey };
}
