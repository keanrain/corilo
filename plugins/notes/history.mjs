import path from 'node:path';
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const fail = (status, message) => Object.assign(new Error(message), { status });
const digest = text => createHash('sha256').update(text).digest('hex');
const oid = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const config = '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = true\n';
const MAX_HISTORY = 100;

// A separate bare repository holds immutable blobs/checkpoints. No user worktree,
// index, Git configuration, remotes or hooks are used or modified.
export class NoteHistory {
  static async open(root, stateRoot, maxBytes) {
    if (typeof stateRoot !== 'string' || !path.isAbsolute(stateRoot) || stateRoot.includes('\0')) throw fail(400, '历史目录需为绝对路径');
    stateRoot = path.resolve(stateRoot);
    const overlaps = (a, b) => a === b || path.relative(a, b).split(path.sep)[0] !== '..' && !path.isAbsolute(path.relative(a, b));
    if (overlaps(root, stateRoot) || overlaps(stateRoot, root)) throw fail(400, '历史目录与笔记目录必须分开且不能互相包含');
    await safeDirectory(stateRoot);
    const markerPath = path.join(stateRoot, 'corilo-notes-state.json');
    const marker = { format: 'corilo-notes-state-v1', rootId: digest(root) };
    const listing = await fs.readdir(stateRoot);
    if (!listing.length) await durableCreate(markerPath, JSON.stringify(marker) + '\n');
    else {
      let stored;
      try { stored = JSON.parse(await safeRead(markerPath, 1024)); } catch { throw fail(400, '历史目录不属于此笔记库'); }
      if (stored.format !== marker.format || stored.rootId !== marker.rootId) throw fail(400, '历史目录不属于此笔记库');
    }
    const history = new NoteHistory(root, stateRoot, maxBytes);
    await history.check(false);
    const version = /^git version (\d+)\.(\d+)/.exec((await history.run(['--version'], undefined, 256, true)).toString());
    if (!version || Number(version[1]) < 2 || Number(version[1]) === 2 && Number(version[2]) < 36) throw fail(400, '历史恢复需要 Git 2.36 或更新版本');
    if (!(await fs.readdir(stateRoot)).includes('history.git')) {
      await history.run(['init', '--bare', '--template=', history.repo], undefined, 65536, true);
      // Own the exact configuration instead of accepting include directives,
      // fsmonitor commands, object alternates or inherited user configuration.
      await fs.writeFile(path.join(history.repo, 'config'), config, { mode: 0o600 });
    }
    await history.check();
    return history;
  }
  constructor(root, stateRoot, maxBytes) { this.root = root; this.stateRoot = stateRoot; this.repo = path.join(stateRoot, 'history.git'); this.maxBytes = maxBytes; }
  async check(requireRepo = true) {
    if (await fs.realpath(this.stateRoot) !== this.stateRoot) throw fail(400, '历史目录不支持链接');
    let count = 0;
    const walk = async directory => {
      for (const name of await fs.readdir(directory)) {
        if (++count > 20000) throw fail(413, '历史目录超过检查条目限制');
        const filename = path.join(directory, name), stat = await fs.lstat(filename);
        if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory() || stat.isFile() && stat.nlink !== 1) throw fail(400, '历史目录不支持链接或特殊文件');
        if (stat.isDirectory()) await walk(filename);
      }
    };
    await walk(this.stateRoot);
    for (const name of ['disabled-hooks', 'no-global-config']) {
      if (await fs.lstat(path.join(this.stateRoot, name)).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) throw fail(400, '历史目录包含保留路径，请先检查配置');
    }
    const marker = JSON.parse(await safeRead(path.join(this.stateRoot, 'corilo-notes-state.json'), 1024));
    if (marker.format !== 'corilo-notes-state-v1' || marker.rootId !== digest(this.root)) throw fail(400, '历史目录不属于此笔记库');
    if (requireRepo) {
      if (await safeRead(path.join(this.repo, 'config'), 1024) !== config) throw fail(400, '历史 Git 配置已改变，请先检查历史目录');
      for (const entry of ['commondir', 'objects/info/alternates', 'objects/info/http-alternates']) {
        if (await fs.lstat(path.join(this.repo, entry)).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) throw fail(400, '历史 Git 不支持外部对象目录');
      }
    }
  }
  async run(args, input, maxOutput = this.maxBytes + 8192, initializing = false) {
    if (!initializing) await this.check();
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(this.stateRoot, 'no-global-config'), GIT_AUTHOR_NAME: 'Corilo', GIT_AUTHOR_EMAIL: 'notes@localhost', GIT_COMMITTER_NAME: 'Corilo', GIT_COMMITTER_EMAIL: 'notes@localhost' });
    const command = ['--no-pager', `--git-dir=${this.repo}`, '-c', `core.hooksPath=${path.join(this.stateRoot, 'disabled-hooks')}`, '-c', 'core.fsmonitor=false', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.fsync=committed', '-c', 'core.fsyncMethod=fsync', ...args];
    return new Promise((resolve, reject) => {
      let child, output = [], size = 0, timer, overflow = false;
      try { child = spawn('git', command, { env, cwd: this.stateRoot, stdio: ['pipe', 'pipe', 'pipe'] }); } catch { reject(fail(503, 'Git 历史暂不可用')); return; }
      const timeout = () => { overflow = true; child.kill('SIGKILL'); };
      timer = setTimeout(timeout, 15000);
      child.stdout.on('data', bytes => { size += bytes.length; if (size > maxOutput) timeout(); else output.push(bytes); });
      child.stderr.resume();
      child.stdin.on('error', () => {});
      child.on('error', () => { clearTimeout(timer); reject(fail(503, 'Git 历史暂不可用，请检查 Git 安装')); });
      child.on('close', code => {
        clearTimeout(timer);
        if (overflow) reject(fail(413, '历史读取超过限制'));
        else if (code !== 0) reject(Object.assign(fail(503, 'Git 历史暂不可用'), { gitCode: code }));
        else resolve(Buffer.concat(output));
      });
      child.stdin.end(input);
    });
  }
  ref(input) { return `refs/corilo/notes/${digest(input)}`; }
  async tip(input) {
    try { return (await this.run(['rev-parse', '--verify', '--quiet', this.ref(input)], undefined, 256)).toString().trim(); }
    catch (error) { if (error.gitCode === 1) return null; throw error; }
  }
  async metadata(revision, input) {
    if (!oid(revision)) throw fail(400, '历史版本无效');
    const raw = (await this.run(['cat-file', 'commit', revision], undefined, 8192)).toString();
    const split = raw.indexOf('\n\n');
    let data;
    try { data = JSON.parse(raw.slice(split + 2)); } catch { throw fail(400, '历史记录无效'); }
    if (split < 0 || data.format !== 1 || data.path !== input || !/^[a-f0-9]{64}$/.test(data.version) || !['save', 'before', 'trash', 'restore'].includes(data.operation) || typeof data.time !== 'string') throw fail(400, '历史记录无效');
    return { revision, path: data.path, version: data.version, time: data.time, operation: data.operation };
  }
  async snapshot(input, text, operation = 'save') {
    const version = digest(Buffer.from(text)), previous = await this.tip(input);
    if (previous && operation !== 'trash' && (await this.metadata(previous, input)).version === version) return previous;
    const blob = (await this.run(['hash-object', '-w', '--stdin'], Buffer.from(text), 256)).toString().trim();
    const tree = (await this.run(['mktree'], `100644 blob ${blob}\tnote\n`, 256)).toString().trim();
    const data = { format: 1, path: input, version, time: new Date().toISOString(), operation };
    const revision = (await this.run(['commit-tree', tree, ...(previous ? ['-p', previous] : [])], JSON.stringify(data), 256)).toString().trim();
    await this.run(['update-ref', this.ref(input), revision, previous ?? '0'.repeat(40)], undefined, 256);
    return revision;
  }
  async history(input) {
    const tip = await this.tip(input);
    if (!tip) return { items: [], hasMore: false };
    const revisions = (await this.run(['rev-list', `--max-count=${MAX_HISTORY + 1}`, tip], undefined, 8192)).toString().trim().split('\n');
    const items = [];
    for (const revision of revisions.slice(0, MAX_HISTORY)) items.push(await this.metadata(revision, input));
    return { items, hasMore: revisions.length > MAX_HISTORY };
  }
  async read(input, revision) {
    if (!oid(revision)) throw fail(400, '历史版本无效');
    const tip = await this.tip(input);
    if (!tip) throw fail(404, '历史版本不存在');
    try { await this.run(['rev-parse', '--verify', '--quiet', `${revision}^{commit}`], undefined, 256); }
    catch (error) { if (error.gitCode === 1) throw fail(404, '历史版本不存在'); throw error; }
    try { await this.run(['merge-base', '--is-ancestor', revision, tip], undefined, 256); }
    catch (error) { if (error.gitCode === 1) throw fail(404, '历史版本不存在'); throw error; }
    const metadata = await this.metadata(revision, input);
    const tree = (await this.run(['ls-tree', revision], undefined, 1024)).toString();
    const match = /^100644 blob ([a-f0-9]{40})\tnote\n$/.exec(tree);
    if (!match) throw fail(400, '历史内容无效');
    const size = Number((await this.run(['cat-file', '-s', match[1]], undefined, 256)).toString());
    if (!Number.isSafeInteger(size) || size > this.maxBytes) throw fail(413, '历史笔记超过大小限制');
    const bytes = await this.run(['cat-file', 'blob', match[1]], undefined, this.maxBytes);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw fail(400, '历史内容不是有效 UTF-8'); }
    if (digest(bytes) !== metadata.version) throw fail(400, '历史内容校验失败');
    return { path: input, text, version: metadata.version, revision };
  }
  async putTrash(revision) { await this.run(['update-ref', `refs/corilo/trash/${revision}`, revision, '0'.repeat(40)], undefined, 256); }
  async removeTrash(revision) { await this.run(['update-ref', '-d', `refs/corilo/trash/${revision}`, revision], undefined, 256); }
  async trashItems() {
    const refs = (await this.run(['for-each-ref', '--format=%(refname)', '--count=1001', 'refs/corilo/trash/'], undefined, 131072)).toString().trim();
    if (!refs) return [];
    const items = refs.split('\n');
    if (items.length > 1000) throw fail(413, '回收站超过读取条目限制');
    const result = [];
    for (const ref of items) {
      const id = ref.slice('refs/corilo/trash/'.length);
      if (!oid(id)) throw fail(400, '回收站记录无效');
      const raw = (await this.run(['cat-file', 'commit', id], undefined, 8192)).toString();
      let data; try { data = JSON.parse(raw.slice(raw.indexOf('\n\n') + 2)); } catch { throw fail(400, '回收站记录无效'); }
      const item = await this.metadata(id, data.path);
      if (item.operation !== 'trash') throw fail(400, '回收站记录无效');
      result.push({ id, path: item.path, version: item.version, time: item.time });
    }
    return result.sort((a, b) => b.time.localeCompare(a.time));
  }
  async readTrash(id) {
    if (!oid(id)) throw fail(400, '回收站记录无效');
    const record = (await this.trashItems()).find(item => item.id === id);
    if (!record) throw fail(404, '回收站记录不存在');
    return this.read(record.path, id);
  }
}

async function safeDirectory(directory) {
  let current = path.parse(directory).root;
  for (const segment of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    await fs.mkdir(current, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(current) !== current) throw fail(400, '历史目录不支持链接');
  }
}
async function safeRead(filename, maxBytes) {
  const entry = await fs.lstat(filename);
  if (!entry.isFile() || entry.nlink !== 1 || entry.isSymbolicLink() || entry.size > maxBytes) throw fail(400, '历史目录文件无效');
  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (entry.ino !== stat.ino || entry.dev !== stat.dev || stat.nlink !== 1 || stat.size > maxBytes) throw fail(400, '历史目录文件已变化');
    const bytes = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < bytes.length) {
      const result = await handle.read(bytes, size, bytes.length - size, size);
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    const after = await handle.stat();
    if (size > maxBytes || size !== stat.size || stat.size !== after.size || stat.mtimeMs !== after.mtimeMs || stat.ctimeMs !== after.ctimeMs || after.nlink !== 1) throw fail(400, '历史目录文件已变化或超过限制');
    return bytes.subarray(0, size).toString('utf8');
  } finally { await handle.close(); }
}
async function durableCreate(filename, text) {
  const handle = await fs.open(filename, 'wx', 0o600);
  try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
  const directory = await fs.open(path.dirname(filename), constants.O_RDONLY);
  try { await directory.sync(); } finally { await directory.close(); }
}
