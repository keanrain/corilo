import http from 'node:http';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { Vault, fault } from './vault.mjs';
import { GitSync } from './sync.mjs';
import { PiAgent } from './agent.mjs';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
const appRoot = fileURLToPath(new URL('../', import.meta.url));
const vendor = path.join(appRoot, 'vendor/filesmd/web');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.png': 'image/png', '.jpg': 'image/jpeg' };
const inside = (a, b) => b === a || b.startsWith(a + path.sep);
async function body(req, limit = 16 * 1024 * 1024) {
  const chunks = []; let length = 0;
  for await (const chunk of req) { length += chunk.length; if (length > limit) throw fault(413, '文件超过本地接口 16 MiB 限制'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
const jsonBody = async req => { try { return JSON.parse((await body(req, 1024 * 1024)).toString()); } catch (e) { if (e.status) throw e; throw fault(400, '无效 JSON'); } };
const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
export async function startHost({ vault: root, configDir, port = 0, piAgentDir = getAgentDir(), agentFactory = (v, dir, piDir) => new PiAgent(v, dir, piDir), syncFactory = (v, dir) => new GitSync(v, dir) }) {
  const vault = new Vault(root);
  // Do this before initialization so an invalid config never lands in the knowledge library.
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
  const realRoot = await fs.realpath(root), realConfig = await fs.realpath(configDir);
  if (inside(realRoot, realConfig) || inside(realConfig, realRoot)) throw fault(400, '配置目录与知识库必须相互独立');
  // Validate before Git initialization/checkpointing: credentials must never enter history.
  await fs.mkdir(piAgentDir, { recursive: true, mode: 0o700 });
  const realPiDir = await fs.realpath(piAgentDir);
  if (inside(realRoot, realPiDir) || inside(realPiDir, realRoot)) throw fault(400, 'Pi 配置目录与知识库必须相互独立');
  const lockPath = path.join(realRoot, '.corilo-host.lock');
  let lock;
  try { lock = await fs.open(lockPath, 'wx', 0o600); }
  catch (e) { if (e.code === 'EEXIST') throw fault(409, '知识库已被宿主占用；异常退出后请确认旧进程已停止，再移除 .corilo-host.lock'); throw e; }
  await lock.writeFile(String(process.pid));
  // Lock lives in the library for single-writer enforcement, but never enters history.
  let agent, sync;
  try {
    const gitDir = path.join(realRoot, '.git');
    const existing = await fs.lstat(gitDir).catch(e => { if (e.code !== 'ENOENT') throw e; });
    if (existing && !existing.isDirectory()) throw fault(409, '不支持 Git 链接工作树');
    if (!existing) await vault.git(['init', '--initial-branch=main']);
    await fs.mkdir(path.join(gitDir, 'info'), { recursive: true });
    const exclude = path.join(gitDir, 'info/exclude');
    const prior = await fs.readFile(exclude, 'utf8').catch(e => { if (e.code !== 'ENOENT') throw e; return ''; });
    if (!prior.includes('/.corilo-host.lock')) await fs.appendFile(exclude, '\n/.corilo-host.lock\n.corilo-*.tmp\n');
    await vault.init();
    agent = agentFactory(vault, realConfig, realPiDir);
    await agent.init();
    sync = syncFactory(vault, realConfig); await sync.init();
  } catch (e) { await lock.close(); await fs.rm(lockPath, { force: true }); throw e; }
  const token = randomBytes(32).toString('hex');
  let syncing = false;
  let queue = Promise.resolve(), busy = false, runTask = Promise.resolve(), runId = 0;
  let outcome = 'idle', runError = '', stopped = false, changed = [], revision = 0, shuttingDown = false;
  const exclusive = task => { const next = queue.then(task); queue = next.catch(() => {}); return next; };
  const mutate = task => {
    if (syncing) return Promise.reject(fault(409, '正在同步，请稍后重试；草稿保留'));
    return exclusive(async () => {
      if (busy || syncing || shuttingDown) throw fault(409, 'Agent 或同步正在运行，请稍后重试');
      const result = await task();
      if (sync.phase === 'synced') sync.phase = 'pending';
      return result;
    });
  };
  async function staticFile(urlPath, res) {
    const custom = urlPath.startsWith('/corilo/');
    const base = custom ? path.join(appRoot, 'web') : vendor;
    const relative = custom ? urlPath.slice('/corilo/'.length) : (urlPath === '/' ? 'index.html' : urlPath.slice(1));
    const resolved = path.resolve(base, relative);
    if (!inside(base, resolved) || relative.split('/').some(p => p.startsWith('.')) || !mime[path.extname(resolved)]) throw fault(404, '资源不存在');
    let data = await fs.readFile(resolved);
    if (!custom && relative === 'lib/sidebar.js') {
      // Disk-origin names (including names created by Pi) must never become markup.
      let source = data.toString();
      for (const [before, after] of [
        ['span_desc.innerHTML = ret + name + "</span>";', 'span_desc.innerHTML = ret; span_desc.appendChild(document.createTextNode(name));'],
        ["span_desc.innerHTML = ret + node.toString() + '</span>';", 'span_desc.innerHTML = ret; span_desc.appendChild(document.createTextNode(node.toString()));'],
      ]) {
        if (!source.includes(before)) throw new Error('Files.md filename patch no longer matches its pinned source');
        source = source.replace(before, after);
      }
      data = Buffer.from(source);
    }
    if (!custom && relative === 'app.js') {
      // The original focus/blur callbacks bypass the host navigation coordinator.
      const source = data.toString();
      const start = source.indexOf('// Reload files once the app gains focus.');
      const end = source.indexOf("document.addEventListener('keydown'", start);
      if (start < 0 || end < 0) throw new Error('Files.md lifecycle patch no longer matches its pinned source');
      data = Buffer.from(source.slice(0, start) + source.slice(end));
    }
    if (!custom && relative === 'index.html') {
      let html = data.toString().replace('<title>Files.md</title>', '<title>Corilo 可里</title>')
        .replace(/    <link rel="canonical"[^\n]+\n/, '')
        .replace(/    <link rel="manifest"[^\n]+\n/, '')
        .replace(/    <script src="welcome.js[^\n]+\n/, '')
        .replace(/    \/\/ Allow offline mode\.[\s\S]*?\.catch\([^\n]+\n/, '')
        .replace('    init();', '    init().catch(coriloError);');
      html = html.replace('<script>\n    window.COMMIT_HASH', '<link rel="stylesheet" href="/corilo/app.css">\n<script src="/corilo/adapter.js"></script>\n<script src="/corilo/app.js"></script><script src="/corilo/sync.js"></script>\n<script>\n    window.COMMIT_HASH');
      data = Buffer.from(html);
    }
    res.writeHead(200, { 'Content-Type': `${mime[path.extname(resolved)]}${['.html','.js','.css','.json'].includes(path.extname(resolved)) ? '; charset=utf-8' : ''}` });
    res.end(data);
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // Upstream uses inline event handlers. Scripts are vendored; remote connections are blocked.
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const expectedHost = `127.0.0.1:${server.address().port}`;
      if (req.headers.host !== expectedHost) throw fault(403, 'Host 不匹配');
      if (req.headers.origin && req.headers.origin !== `http://${expectedHost}`) throw fault(403, '来源不受信任');
      const url = new URL(req.url, `http://${expectedHost}`), route = url.pathname;
      if (!route.startsWith('/api/')) {
        if (req.method !== 'GET') throw fault(405, '方法不支持');
        return await staticFile(decodeURIComponent(route), res);
      }
      if (req.headers['x-corilo-token'] !== token) throw fault(401, '请从 Corilo 启动入口重新打开页面');
      if (shuttingDown) throw fault(503, '宿主正在退出');
      const input = url.searchParams.get('path') ?? '';
      if (req.method === 'GET' && route === '/api/state') return send(res, 200, {
        busy, outcome, error: runError, changed, revision, runId, activity: agent.activity,
        messages: agent.messages(), liveText: agent.liveText ?? '', model: agent.session?.model ? `${agent.session.model.provider}/${agent.session.model.id}` : null,
        vault: vault.root, sync: sync.state(), syncing,
      });
      if (req.method === 'POST' && ['/api/sync/bind','/api/sync/run','/api/sync/unbind'].includes(route)) {
        const data = await jsonBody(req);
        if (syncing || busy) throw fault(409, 'Agent 或同步正在运行，请稍后重试');
        // Set before queueing: queued file writes must not slip into a network merge.
        syncing = true;
        try {
          const result = await exclusive(async () => {
            if (busy || shuttingDown) throw fault(409, '宿主正忙，请稍后重试');
            if (route.endsWith('/bind')) return sync.bind(data.url, data.branch);
            if (route.endsWith('/unbind')) return sync.unbind();
            return sync.run(data.resolution);
          });
          return send(res, 200, result);
        } finally { syncing = false; revision++; }
      }
      if (syncing && route.startsWith('/api/fs/')) throw fault(409, '正在同步，请稍后重试；草稿保留');
      if (req.method === 'GET' && route === '/api/fs/list') return send(res, 200, await vault.list(input));
      if (req.method === 'GET' && route === '/api/fs/stat') return send(res, 200, await vault.stat(input));
      if (req.method === 'GET' && route === '/api/fs/read') {
        const file = await vault.read(input);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'X-Corilo-Etag': file.etag, 'X-Corilo-Modified': String(file.lastModified) });
        return res.end(file.data);
      }
      if (req.method === 'PUT' && route === '/api/fs/write') {
        const data = await body(req);
        const result = await mutate(() => vault.write(input, data, req.headers['if-match']));
        revision++; return send(res, 200, result);
      }
      if (req.method === 'POST' && route === '/api/fs/create') {
        const data = await jsonBody(req);
        if (!['file', 'directory'].includes(data.kind)) throw fault(400, '路径类型无效');
        return send(res, 200, await mutate(() => vault.create(data.path, data.kind)));
      }
      if (req.method === 'POST' && route === '/api/fs/rename') {
        const data = await jsonBody(req); await mutate(async () => { await vault.checkpoint('Corilo: before rename'); await vault.rename(data.from, data.to); await vault.checkpoint('Corilo: rename'); }); revision++; return send(res, 200, {});
      }
      if (req.method === 'POST' && route === '/api/fs/remove') {
        const data = await jsonBody(req); await mutate(async () => { await vault.checkpoint('Corilo: before remove'); await vault.remove(data.path, data.recursive === true); await vault.checkpoint('Corilo: remove'); }); revision++; return send(res, 200, {});
      }
      if (req.method === 'POST' && route === '/api/checkpoint') {
        const commit = await mutate(() => vault.checkpoint('Corilo: local edits')); return send(res, 200, { commit });
      }
      if (req.method === 'POST' && route === '/api/capture') {
        const { text } = await jsonBody(req);
        if (typeof text !== 'string' || !text.trim()) throw fault(400, '请输入内容');
        const title = text.split('\n').find(line => line.trim())?.replace(/^[#\s]+/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 28) || '原话';
        const filename = `收集/${new Date().toISOString().slice(0,10)} ${title} ${randomUUID().slice(0,6)}.md`;
        await mutate(async () => {
          await vault.create('收集', 'directory'); await vault.create(filename, 'file');
          const initial = await vault.read(filename); await vault.write(filename, Buffer.from(text), initial.etag);
          await vault.checkpoint('Corilo: capture');
        }); revision++; return send(res, 200, { path: filename });
      }
      if (req.method === 'POST' && route === '/api/agent/stop') { stopped = busy; await agent.stop(); return send(res, 200, {}); }
      if (req.method === 'POST' && route === '/api/agent/prompt') {
        const { text } = await jsonBody(req);
        if (typeof text !== 'string' || !text.trim()) throw fault(400, '请输入消息');
        let before;
        await mutate(async () => { await agent.ensureReady?.(); before = await vault.checkpoint('Corilo: before agent'); busy = true; outcome = 'running'; stopped = false; runError = ''; changed = []; runId++; });
        runTask = (async () => {
          try { await agent.prompt(text); outcome = stopped ? 'stopped' : 'completed'; }
          catch (e) { outcome = 'failed'; runError = e.message; }
          finally {
            try {
              await vault.checkpoint('Corilo: after agent');
              changed = (await vault.git(['diff', '--name-only', '-z', before, 'HEAD'])).split('\0').filter(Boolean);
            } catch (e) { outcome = 'failed'; runError = `文件保留在本机，但历史保存失败：${e.message}`; }
            revision++; busy = false;
          }
        })();
        return send(res, 202, { runId });
      }
      throw fault(404, '接口不存在');
    } catch (error) {
      const status = error.status ?? ({ ENOENT: 404, ENOTEMPTY: 409, EEXIST: 409, EACCES: 403 }[error.code]) ?? 500;
      if (!res.headersSent) send(res, status, { error: error.message, name: error.code === 'ENOENT' ? 'NotFoundError' : 'Error' });
      else res.end();
    }
  });
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); }
  catch (e) { await agent.close(); await lock.close(); await fs.rm(lockPath, { force: true }); throw e; }
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, token, vault, agent, url: `${origin}/#token=${token}`, async close() {
    shuttingDown = true; await agent.stop(); await runTask; await queue;
    await agent.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await lock.close(); await fs.rm(lockPath, { force: true });
  } };
}
