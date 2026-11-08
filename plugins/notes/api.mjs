import { createHash } from 'node:crypto';

// Public Connection Fetch routes inherit Harness authentication and Host/Origin checks.
// Business failures remain data; filesystem diagnostics never cross the wire.
export function registerNotesApi(ctx, store) {
  const libraryId = createHash('sha256').update(store.root).digest('hex');
  const handle = async (method, args, signal) => {
    const failure = (status, message) => ({ ok: false, error: { code: `notes/${status}`, message, details: {} } });
    const fields = {
      identity: [], list: [], read: ['path'], save: ['path', 'text', 'expected'], capture: ['text'],
      history: ['path'], readRevision: ['path', 'revision'], restore: ['path', 'revision', 'expected'],
      trash: ['path', 'expected'], listTrash: [], restoreTrash: ['id', 'path', 'expected'],
    };
    if (!Object.hasOwn(fields, method)) return failure(404, '笔记操作不存在');
    if (!args || typeof args !== 'object' || Array.isArray(args) ||
        Object.keys(args).length !== fields[method].length ||
        fields[method].some(key => !Object.hasOwn(args, key) ||
          (key === 'expected' ? args[key] !== null && (typeof args[key] !== 'string' || !/^[a-f0-9]{64}$/.test(args[key])) : typeof args[key] !== 'string'))) {
      return failure(400, '笔记请求格式无效');
    }
    try {
      signal.throwIfAborted();
      const value = method === 'identity' ? {
        id: libraryId, recoveryEnabled: Boolean(store.recovery),
      } : method === 'list' ? await store.list()
        : method === 'read' ? await store.read(args.path)
        : method === 'save' ? await store.save({ ...args, signal })
        : method === 'capture' ? await store.capture(args.text, { signal })
        : method === 'history' ? await store.history(args.path)
        : method === 'readRevision' ? await store.readRevision(args.path, args.revision)
        : method === 'listTrash' ? await store.listTrash()
        : method === 'restoreTrash' ? await store.restoreTrash({ ...args, signal })
        : method === 'trash' ? await store.trash({ ...args, signal })
        : await store.restore({ ...args, signal });
      return { ok: true, value };
    } catch (error) {
      const status = [400, 404, 409, 413].includes(error.status) ? error.status : 503;
      if (error.committed === true) return { ok: false, error: { code: 'notes/503', message: error.message, details: { committed: true } } };
      return failure(status, status === 503 ? '笔记暂不可用；草稿已保留，请核对文件后重试' : error.message);
    }
  };
  for (const method of ['identity', 'list', 'read', 'save', 'capture', 'history', 'readRevision', 'restore', 'trash', 'listTrash', 'restoreTrash']) {
    ctx.effect(() => ctx.connection.fetch.register({
      path: `/api/corilo-notes/${method}`, methods: ['POST'], requestBody: 'buffered',
      async fetch(request) {
        const requestedLibrary = request.headers.get('x-corilo-library-id');
        if (requestedLibrary && requestedLibrary !== libraryId) return Response.json({ ok: false, error: {
          code: 'notes/library-changed', message: '知识库已切换，请重新加载页面', details: {},
        } }, { headers: { 'cache-control': 'no-store' } });
        if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return new Response('JSON required', { status: 415 });
        let args;
        try { args = await request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
        return Response.json(await handle(method, args, request.signal), { headers: { 'cache-control': 'no-store' } });
      },
    }));
  }
}
