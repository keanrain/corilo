import http from 'node:http';
import path from 'node:path';
import { lstat, realpath, chmod } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';

const terminal = new Set(['completed', 'failed', 'stopped', 'interrupted']);
const fault = status => Object.assign(new Error('Host control unavailable'), { status });
const json = (res, status, value) => {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' });
  res.end(JSON.stringify(value));
};

function emptyBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0, parts = [], finished = false;
    const timer = setTimeout(() => end(fault(400)), 5000);
    function end(error) {
      if (finished) return;
      finished = true; clearTimeout(timer);
      req.removeListener('data', data); req.removeListener('end', complete);
      if (error) { req.resume(); reject(error); } else resolve();
    }
    function data(part) {
      size += part.length;
      if (size > 1024) { parts = []; end(fault(413)); } else parts.push(part);
    }
    function complete() {
      try {
        const value = JSON.parse(Buffer.concat(parts).toString('utf8'));
        if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).length) throw fault(400);
        end();
      } catch { end(fault(400)); }
    }
    const failed = () => end(fault(400)), aborted = () => end(fault(400));
    req.on('data', data); req.once('end', complete); req.once('error', failed); req.once('aborted', aborted);
  });
}

// This credential authorizes the trusted controller, not users or workers. The
// file owner never obtains Docker access; stop confirmation stays the controller's
// responsibility. Operations accept durable run IDs only, never filesystem paths.
export async function startHostControl({ pool, hosts, socketPath, token }) {
  if (process.platform !== 'linux' || !pool?.query || !hosts?.forRun || typeof socketPath !== 'string' ||
      !path.isAbsolute(socketPath) || path.resolve(socketPath) !== socketPath || socketPath.includes('\0') || Buffer.byteLength(socketPath) > 100 ||
      typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid host control configuration');
  const directory = path.dirname(socketPath), parent = await lstat(directory);
  if (!parent.isDirectory() || parent.uid !== process.getuid() || (parent.mode & 0o777) !== 0o700 ||
      await realpath(directory) !== directory) throw new Error('Private host control directory required');
  const existing = await lstat(socketPath).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (existing) throw new Error('Host control socket already exists; inspect previous owner');
  const expected = Buffer.from(token), queues = new Map(), inflight = new Set();
  let closing = false, closeTask;
  function serial(id, task) {
    const next = (queues.get(id) || Promise.resolve()).then(task);
    const settled = next.catch(() => {}); queues.set(id, settled);
    void settled.then(() => { if (queues.get(id) === settled) queues.delete(id); });
    return next;
  }
  async function operation(id, name) {
    const row = (await pool.query(`SELECT id,owner_id,vault_id,conversation_id,state FROM corilo_private.runs WHERE id=$1`, [id])).rows[0];
    if (!row) throw fault(404);
    if ((name === 'begin' && !['running', 'stopping'].includes(row.state)) ||
        (name === 'release' && !terminal.has(row.state)) ||
        (name === 'checkpoint' && !['running', 'stopping'].includes(row.state) && !terminal.has(row.state))) throw fault(409);
    const host = await hosts.forRun({ id: row.id, ownerId: row.owner_id, vaultId: row.vault_id, conversationId: row.conversation_id });
    if (name === 'status') return { active: host.activeRunId() === id };
    if (name === 'begin') await host.beginRun(id);
    if (name === 'checkpoint') await host.checkpointRun(id);
    if (name === 'release') {
      const active = host.activeRunId();
      // Lost acknowledgements may be retried by recovery. Never release another
      // run's gate, and never turn a terminal retry into a new occupied gate.
      if (active !== null && active !== id) throw fault(409);
      if (active === id) await host.releaseRun(id);
    }
    return { ok: true };
  }
  async function handle(req, res) {
    try {
      if (closing) throw fault(503);
      const authorizationHeaders = req.rawHeaders.filter((_value, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'authorization');
      if (authorizationHeaders.length !== 1) throw fault(401);
      const auth = req.headers.authorization;
      if (typeof auth !== 'string' || !/^Bearer [a-f0-9]{64}$/.test(auth)) throw fault(401);
      const supplied = Buffer.from(auth.slice(7));
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw fault(401);
      if (req.headers.origin !== undefined || req.headers['sec-fetch-site'] !== undefined || req.headers.cookie !== undefined ||
          req.method !== 'POST' || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '')) throw fault(400);
      const route = /^\/runs\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/(begin|checkpoint|release|status)$/.exec(req.url || '');
      if (!route) throw fault(404);
      await emptyBody(req);
      if (closing) throw fault(503);
      const value = await serial(route[1], () => operation(route[1], route[2]));
      json(res, 200, value);
    } catch (error) {
      const status = [400, 401, 404, 409, 413, 429, 503].includes(error.status) ? error.status : 503;
      json(res, status, { error: 'Host control unavailable' });
    }
  }
  const server = http.createServer({ maxHeaderSize: 4096, headersTimeout: 5000, requestTimeout: 5000,
    connectionsCheckingInterval: 1000 }, (req, res) => {
    if (closing || inflight.size >= 128) { json(res, closing ? 503 : 429, { error: 'Host control unavailable' }); return; }
    const task = handle(req, res); inflight.add(task);
    void task.then(() => inflight.delete(task), () => inflight.delete(task));
  });
  server.on('checkContinue', (_req, res) => json(res, 400, { error: 'Host control unavailable' }));
  server.on('checkExpectation', (_req, res) => json(res, 400, { error: 'Host control unavailable' }));
  server.on('upgrade', (_req, socket) => socket.destroy());
  server.on('connect', (_req, socket) => socket.destroy());
  server.on('clientError', (_error, socket) => socket.destroy());
  try {
    await new Promise((resolve, reject) => {
      const failed = error => { server.removeListener('listening', ready); reject(error); };
      const ready = () => { server.removeListener('error', failed); resolve(); };
      server.once('error', failed); server.once('listening', ready); server.listen(socketPath);
    });
    await chmod(socketPath, 0o600);
    const socket = await lstat(socketPath);
    if (!socket.isSocket() || socket.uid !== process.getuid() || (socket.mode & 0o777) !== 0o600)
      throw new Error('Unsafe host control socket');
  } catch (error) {
    closing = true;
    if (server.listening) {
      const stopped = new Promise(resolve => server.close(resolve));
      await Promise.allSettled([...inflight]);
      server.closeAllConnections(); await stopped;
    }
    throw error;
  }
  return {
    close() {
      if (closeTask) return closeTask;
      closing = true;
      closeTask = (async () => {
        const stopped = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        // HTTP disconnect does not cancel a persisted mutation. Drain the actual
        // handler promises before the caller is allowed to close the file hosts.
        await Promise.allSettled([...inflight]);
        server.closeAllConnections(); await stopped;
      })();
      return closeTask;
    },
  };
}
