// Current business boundary. The underlying v1 SQLite/JSON format stays intact
// for existing records; retired cancellation/association fields are not exposed
// as editing capabilities by either the page or Agent tools.
const fail = (status, message) => Object.assign(new Error(message), { status });
const fields = (value, allowed) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw fail(400, '待办请求格式无效');
};
const current = item => {
  if (item.status === 'cancelled') throw fail(404, '待办不在当前清单中');
  const { notePath, ...result } = item;
  return result;
};
export function coreTodos(store) {
  return {
    get identity() { return store.identity; },
    async list(args = {}) {
      fields(args, ['status', 'cursor', 'query', 'signal']);
      if (args.status !== undefined && !['open', 'done', 'all'].includes(args.status)) throw fail(400, '待办状态无效');
      const page = await store.list({ ...args, activeOnly: true });
      return { ...page, items: page.items.map(current) };
    },
    async get(id) { return current(await store.get(id)); },
    async create(args) {
      fields(args, ['requestId', 'title', 'body', 'signal']);
      return current(await store.create(args));
    },
    async update(args) {
      fields(args, ['requestId', 'id', 'expected', 'patch', 'signal']);
      fields(args.patch, ['title', 'body', 'status']);
      if (Object.hasOwn(args.patch, 'status') && !['open', 'done'].includes(args.patch.status)) throw fail(400, '待办状态无效');
      return current(await store.update({ ...args, activeOnly: true }));
    },
    // Export preserves old cancelled records/associations without converting or
    // deleting them. It remains the original public corilo-todos-v1 format.
    export(options) { return store.export(options); },
  };
}
