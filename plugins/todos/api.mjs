// Public Connection Fetch routes inherit Harness auth, Host/Origin and owner
// checks. A persistent database identity protects pages across root changes.
const fields = {
  identity: { required: [], optional: [] },
  list: { required: [], optional: ['status', 'cursor', 'query'] },
  get: { required: ['id'], optional: [] },
  create: { required: ['requestId', 'title'], optional: ['body', 'notePath'] },
  update: { required: ['requestId', 'id', 'expected', 'patch'], optional: [] },
  export: { required: [], optional: [] },
};
const object = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
function valid(method, args) {
  const { required, optional } = fields[method];
  if (!object(args) || required.some(key => !Object.hasOwn(args, key)) || Object.keys(args).some(key => !required.includes(key) && !optional.includes(key))) return false;
  for (const [key, value] of Object.entries(args)) {
    if (key === 'expected') { if (!Number.isSafeInteger(value) || value < 1) return false; }
    else if (key === 'patch') {
      if (!object(value) || !Object.keys(value).length || Object.keys(value).some(field => !['title', 'body', 'notePath', 'status'].includes(field) || (field === 'notePath' ? value[field] !== null && typeof value[field] !== 'string' : typeof value[field] !== 'string'))) return false;
    } else if (key === 'cursor' || key === 'notePath') { if (value !== null && typeof value !== 'string') return false; }
    else if (typeof value !== 'string') return false;
  }
  return true;
}
const failure = (code, message) => ({ ok: false, error: { code, message, details: {} } });
const json = value => Response.json(value, { headers: { 'cache-control': 'no-store' } });

export function registerTodosApi(ctx, store) {
  for (const method of Object.keys(fields)) {
    ctx.effect(() => ctx.connection.fetch.register({
      path: `/api/corilo-todos/${method}`, methods: ['POST'], requestBody: 'buffered',
      async fetch(request) {
        if (method !== 'identity' && request.headers.get('x-corilo-todos-id') !== store.identity) {
          return json(failure('todos/library-changed', '待办资料库已切换或身份未确认，请重新加载页面'));
        }
        if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return new Response('JSON required', { status: 415 });
        let args;
        try { args = await request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
        if (!valid(method, args)) return json(failure('todos/400', '待办请求格式无效'));
        try {
          request.signal.throwIfAborted();
          const value = method === 'identity' ? { id: store.identity }
            : method === 'list' ? await store.list({ ...args, signal: request.signal })
            : method === 'get' ? await store.get(args.id)
            : method === 'create' ? await store.create({ ...args, signal: request.signal })
            : method === 'update' ? await store.update({ ...args, signal: request.signal })
            : await store.export({ signal: request.signal });
          return json({ ok: true, value });
        } catch (error) {
          const status = [400, 404, 409, 413].includes(error.status) ? error.status : 503;
          // Known service errors are curated business messages; SQL and native
          // filesystem diagnostics never leave this process.
          return json(failure(`todos/${status}`, status === 503 ? '待办暂不可用，输入已保留；请核对或使用原请求重试' : error.message));
        }
      },
    }));
  }
}
