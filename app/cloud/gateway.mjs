import http from 'node:http';
import path from 'node:path';
import { readFile, mkdir, realpath } from 'node:fs/promises';
import { startHost } from '../host/server.mjs';
import { fault } from '../host/vault.mjs';
const cookieName = '__Host-corilo-session';
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
const tokenFrom = req => {
  const cookies = (req.headers.cookie || '').split(';').map(s => s.trim()).filter(s => s.startsWith(cookieName+'='));
  return cookies.length === 1 ? cookies[0].slice(cookieName.length+1) : '';
};
async function input(req) {
  let total = 0; const parts = [];
  for await (const part of req) { total += part.length; if (total > 8192) throw fault(413, '请求过大'); parts.push(part); }
  try { return JSON.parse(Buffer.concat(parts)); } catch { throw fault(400, '请求格式无效'); }
}
export async function startCloud({ accounts, identity, dataRoot, publicOrigin, port = 0, maxHosts = 20 }) {
  const origin = new URL(publicOrigin);
  if ((origin.protocol !== 'https:' && !(origin.protocol === 'http:' && origin.hostname === '127.0.0.1')) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Public origin must be HTTPS (loopback HTTP is development only)');
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  dataRoot = await realpath(dataRoot);
  const hosts = new Map(), limits = new Map();
  let closing = false;
  const cookie = (token, age) => `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
  async function hostFor(account) {
    const id = account.vault_id;
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid vault identity');
    if (!hosts.has(id)) {
      if (hosts.size >= maxHosts) throw fault(503, '服务容量暂满，请稍后重试');
      const base = path.join(dataRoot, id);
      const pending = startHost({ mode: 'cloud-files', vault: path.join(base, 'knowledge'), configDir: path.join(base, 'state'), piAgentDir: path.join(base, 'pi') });
      hosts.set(id, pending);
      pending.catch(() => { if (hosts.get(id) === pending) hosts.delete(id); });
    }
    return hosts.get(id);
  }
  function rateLimit(req) {
    const now = Date.now();
    for (const [key, value] of limits) if (value.until < now) limits.delete(key);
    const key = req.socket.remoteAddress; // Do not trust arbitrary X-Forwarded-For.
    if (!limits.has(key)) {
      if (limits.size >= 10000) throw fault(429, '登录请求过多，请稍后重试');
      limits.set(key, { count: 0, until: now + 300000 });
    }
    if (++limits.get(key).count > 30) throw fault(429, '登录请求过多，请稍后重试');
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; connect-src 'self'; base-uri 'none'");
    try {
      if (closing) throw fault(503, '服务正在退出');
      if (req.headers.host !== origin.host) throw fault(403, 'Host 不匹配');
      if (req.headers.origin && req.headers.origin !== origin.origin) throw fault(403, '来源不受信任');
      if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== origin.origin) throw fault(403, '缺少可信来源');
      if (req.headers['sec-fetch-site'] === 'cross-site') throw fault(403, '跨站请求已拒绝');
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && ['/login','/login.js','/login.css'].includes(url.pathname)) {
        const ext = url.pathname === '/login' ? 'html' : url.pathname.split('.').pop();
        res.setHeader('Content-Type', { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' }[ext]);
        return res.end(await readFile(new URL(`./login.${ext}`, import.meta.url)));
      }
      if (req.method === 'POST' && url.pathname === '/auth/login') {
        rateLimit(req);
        const body = await input(req);
        if (!body || typeof body !== 'object' || (body.invitation !== undefined && (typeof body.invitation !== 'string' || body.invitation.length > 64))) throw fault(400, '登录信息无效');
        const verified = await identity.signIn(body.email, body.password);
        const token = await accounts.login(verified, body.invitation || '');
        await accounts.logout(tokenFrom(req)); // Rotate any previous app session.
        res.setHeader('Set-Cookie', cookie(token, 86400));
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/auth/logout') {
        await accounts.logout(tokenFrom(req)); res.setHeader('Set-Cookie', cookie('', 0));
        return json(res, 200, { ok: true });
      }
      const account = await accounts.session(tokenFrom(req));
      if (!account) {
        if (req.method === 'GET' && url.pathname === '/') { res.writeHead(303, { Location: '/login' }); return res.end(); }
        throw fault(401, '请重新登录');
      }
      if (req.method === 'GET' && url.pathname === '/auth/me') return json(res, 200, { email: account.email });
      if (url.pathname.startsWith('/auth/')) throw fault(404, '接口不存在');
      // Forward only fixed safe headers. Never trust a browser-selected tenant or host token.
      const host = await hostFor(account);
      const headers = { host: new URL(host.origin).host, 'x-corilo-token': host.token };
      for (const name of ['content-type','if-match']) if (req.headers[name]) headers[name] = req.headers[name];
      const upstream = http.request(host.origin + url.pathname + url.search, { method: req.method, headers }, response => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res);
      });
      upstream.on('error', () => { if (!res.headersSent) json(res, 503, { error: '知识库暂不可用' }); else res.destroy(); });
      let size = 0;
      req.on('data', chunk => { size += chunk.length; if (size > 17 * 1024 * 1024) upstream.destroy(); });
      req.on('aborted', () => upstream.destroy());
      res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
      req.pipe(upstream);
    } catch (e) { json(res, e.status || 500, { error: e.status ? e.message : '服务暂不可用，请稍后重试' }); }
  });
  server.requestTimeout = 30000; server.headersTimeout = 15000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  if (origin.protocol === 'http:' && origin.port === '0') origin.port = String(server.address().port);
  return { address: `http://127.0.0.1:${server.address().port}`, async close() {
    closing = true; server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await Promise.allSettled([...hosts.values()].map(async pending => (await pending).close()));
  } };
}
