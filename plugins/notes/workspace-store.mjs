import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const fail = (status, message) => Object.assign(new Error(message), { status });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const missing = error => error.code === 'ENOENT';
const MAX_MEDIA = 16 * 1024 * 1024;
const TEXT = /\.(md|markdown|txt)$/i;
const MEDIA = /\.(png|jpg|jpeg|webp|gif|mp4|webm|mov|mp3|ogg|oga|weba|wav)$/i;
const check = signal => signal?.throwIfAborted();

// One host directory and the same queue as Agent Markdown tools. No browser
// directory permission, local mirror, cloud sync, Git, or second Agent loop.
export class WorkspaceStore {
  static async open(notes) {
    const stat = await fs.lstat(notes.root);
    return new WorkspaceStore(notes, { dev: stat.dev, ino: stat.ino });
  }
  constructor(notes, rootStat) {
    this.notes = notes; this.root = notes.root; this.rootStat = rootStat;
    this.identity = digest(JSON.stringify([this.root, rootStat.dev, rootStat.ino]));
  }
  serial(task) { return this.notes.serial(async () => { try { return await task(); } catch (error) { if (missing(error)) throw fail(404, '文件不存在'); throw error; } }); }
  async resolve(input = '') {
    if (typeof input !== 'string' || !input.isWellFormed() || input.includes('\\') || Buffer.byteLength(input) > 1024) throw fail(400, '工作区路径无效');
    input = input.replace(/^\/+/, '');
    const parts = input ? input.split('/') : [];
    if (parts.length > 20 || parts.some(part => !part || part.startsWith('.') || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || Buffer.byteLength(part) > 240 || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part))) throw fail(400, '仅支持可移植的工作区相对路径');
    const root = await fs.lstat(this.root);
    if (!root.isDirectory() || root.dev !== this.rootStat.dev || root.ino !== this.rootStat.ino || await fs.realpath(this.root) !== this.root) throw fail(409, '工作区目录已变化，请重启服务并重新加载页面');
    let target = this.root;
    for (let index = 0; index < parts.length; index++) {
      target = path.join(target, parts[index]);
      const stat = await fs.lstat(target).catch(error => { if (missing(error) && index === parts.length - 1) return null; throw error; });
      if (stat && (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory() || stat.isFile() && stat.nlink !== 1)) throw fail(400, '工作区不支持链接或特殊文件');
      if (stat && index < parts.length - 1 && !stat.isDirectory()) throw fail(400, '父路径不是目录');
    }
    return target;
  }
  supported(input) {
    if (!TEXT.test(input) && !MEDIA.test(input) && input.replace(/^\/+/, '') !== 'config.json') throw fail(400, '文件格式不受支持');
  }
  limit(input) { return MEDIA.test(input) ? MAX_MEDIA : this.notes.limits.maxBytes; }
  async bytes(input) {
    this.supported(input);
    const filename = await this.resolve(input), entry = await fs.lstat(filename);
    if (!entry.isFile() || entry.nlink !== 1) throw fail(400, '不是普通文件');
    if (entry.size > this.limit(input)) throw fail(413, '文件超过工作区大小限制');
    const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.nlink !== 1 || before.dev !== entry.dev || before.ino !== entry.ino) throw fail(409, '文件已变化');
      const data = Buffer.alloc(this.limit(input) + 1);
      let size = 0;
      while (size < data.length) { const part = await handle.read(data, size, data.length - size, size); if (!part.bytesRead) break; size += part.bytesRead; }
      const after = await handle.stat();
      if (size > this.limit(input)) throw fail(413, '文件超过工作区大小限制');
      if (size !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || after.nlink !== 1) throw fail(409, '文件已变化');
      return { data: data.subarray(0, size), etag: digest(data.subarray(0, size)), lastModified: after.mtimeMs };
    } finally { await handle.close(); }
  }
  async version(input, budget = { entries: 0, deadline: Date.now() + 10000 }) {
    const target = await this.resolve(input), stat = await fs.lstat(target);
    if (stat.isFile()) return (await this.bytes(input)).etag;
    const hash = createHash('sha256');
    const walk = async (directory, relative = '', depth = 0) => {
      if (Date.now() > budget.deadline) throw fail(413, '目录扫描超时，请缩小工作区');
      if (depth > 20) throw fail(413, '目录层级超过限制');
      for (const entry of (await fs.readdir(directory)).sort()) {
        if (Date.now() > budget.deadline) throw fail(413, '目录扫描超时，请缩小工作区');
        if (++budget.entries > 20000) throw fail(413, '目录超过 20000 项扫描限制');
        if (entry.startsWith('.')) throw fail(400, '目录包含隐藏资料，请先检查后再移动或删除');
        const child = path.join(directory, entry), key = path.posix.join(relative, entry);
        const info = await fs.lstat(child, { bigint: true });
        if (info.isSymbolicLink() || !info.isFile() && !info.isDirectory() || info.isFile() && info.nlink !== 1n) throw fail(400, '目录包含链接或特殊文件');
        hash.update(JSON.stringify([key, String(info.mode), String(info.ino), String(info.size), String(info.mtimeNs), String(info.ctimeNs)]));
        if (info.isDirectory()) await walk(child, key, depth + 1);
      }
    };
    await walk(target);
    return 'dir-' + hash.digest('hex');
  }
  async statUnsafe(input, budget) {
    const target = await this.resolve(input), stat = await fs.lstat(target);
    return { name: path.basename(target), kind: stat.isDirectory() ? 'directory' : 'file', size: stat.size, lastModified: stat.mtimeMs, version: stat.isDirectory() ? await this.version(input, budget) : (await this.bytes(input)).etag };
  }
  stat(input) { return this.serial(() => this.statUnsafe(input)); }
  list(input = '') {
    return this.serial(async () => {
      const directory = await this.resolve(input), entries = await fs.readdir(directory, { withFileTypes: true });
      if (entries.length > 20000) throw fail(413, '目录超过 20000 项扫描限制');
      const result = [], budget = { entries: 0, deadline: Date.now() + 10000 }; let bytes = 0;
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const key = path.posix.join(input || '', entry.name);
        // Upstream ignores unsupported files. Do not read or expose them.
        if (!entry.isDirectory() && !TEXT.test(entry.name) && !MEDIA.test(entry.name) && key.replace(/^\/+/, '') !== 'config.json') continue;
        if (Date.now() > budget.deadline) throw fail(413, '目录扫描超时，请缩小工作区');
        if (!entry.isDirectory()) { bytes += (await fs.lstat(path.join(directory, entry.name))).size; if (bytes > 64 * 1024 * 1024) throw fail(413, '目录文件超过 64 MiB 读取限制'); }
        const item = await this.statUnsafe(key, budget);
        result.push(item);
      }
      return result;
    });
  }
  read(input) { return this.serial(() => this.bytes(input)); }
  async copy(text, signal) { await this.resolve(''); return this.notes.create({text,signal}); }
  create(input, kind, signal) {
    return this.serial(async () => {
      check(signal);
      if (!['file', 'directory'].includes(kind)) throw fail(400, '路径类型无效');
      const target = await this.resolve(input);
      if (target === this.root) throw fail(400, '不能创建工作区根目录');
      if (kind === 'file') this.supported(input);
      const existing = await fs.lstat(target).catch(error => { if (missing(error)) return null; throw error; });
      if (!existing) {
        check(signal);
        if (kind === 'directory') await fs.mkdir(target, { mode: 0o700 });
        else { const handle = await fs.open(target, 'wx', 0o600); await handle.sync(); await handle.close(); }
      }
      const result = await this.statUnsafe(input);
      if (result.kind !== kind) throw fail(409, '路径类型不匹配');
      return result;
    });
  }
  write(input, data, expected, signal) {
    return this.serial(async () => {
      check(signal); this.supported(input);
      if (!Buffer.isBuffer(data) || data.length > this.limit(input)) throw fail(413, '文件超过工作区大小限制');
      if (!MEDIA.test(input)) { try { new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { throw fail(400, '正文不是有效 UTF-8'); } }
      if (typeof expected !== 'string' || (await this.bytes(input)).etag !== expected) throw fail(409, '文件已在其他位置修改，当前输入仍保留，请核对后再保存');
      const filename = await this.resolve(input), temp = path.join(path.dirname(filename), `.corilo-${randomUUID()}.tmp`);
      let committed = false;
      try {
        const handle = await fs.open(temp, 'wx', 0o600);
        try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
        if ((await this.bytes(input)).etag !== expected) throw fail(409, '文件已变化，当前输入仍保留');
        check(signal); await fs.rename(temp, filename); committed = true;
        const directory = await fs.open(path.dirname(filename), constants.O_RDONLY);
        try { await directory.sync(); } finally { await directory.close(); }
        return { etag: digest(data) };
      } catch (error) { if (committed) throw Object.assign(fail(503, '文件已写入，保存确认未完成，请核对后再操作'), { committed: true }); throw error; }
      finally { await fs.rm(temp, { force: true }); }
    });
  }
  versionOf(input) { return this.serial(() => this.version(input)); }
  rename(from, to, expected, signal) {
    return this.serial(async () => {
      check(signal);
      const source = await this.resolve(from), target = await this.resolve(to);
      if (source === this.root || target === this.root || target.startsWith(source + path.sep)) throw fail(400, '不能移动根目录或移入自身');
      if (await this.version(from) !== expected || typeof expected !== 'string') throw fail(409, '文件或目录已变化，未移动原资料');
      if (source === target) return {};
      if (await fs.lstat(target).then(() => true, error => { if (missing(error)) return false; throw error; })) throw fail(409, '目标已存在，未覆盖原资料');
      const sourceStat = await fs.lstat(source);
      if (sourceStat.isFile()) {
        this.supported(to);
        const file = await this.bytes(from);
        const temp = path.join(path.dirname(target), `.corilo-${randomUUID()}.tmp`);
        let published = false;
        try {
          const handle = await fs.open(temp, 'wx', 0o600);
          try { await handle.writeFile(file.data); await handle.sync(); } finally { await handle.close(); }
          if ((await this.bytes(from)).etag !== expected) throw fail(409, '源文件已变化，未移动原资料');
          check(signal); await fs.link(temp, target); published = true; await fs.unlink(temp);
          if ((await this.bytes(from)).etag !== expected) throw fail(409, '源文件已变化，新旧文件均保留');
          await fs.unlink(source);
          for (const directory of new Set([path.dirname(source), path.dirname(target)])) {
            const handle = await fs.open(directory, constants.O_RDONLY); try { await handle.sync(); } finally { await handle.close(); }
          }
        } catch (error) {
          if (published) throw Object.assign(fail(503, '移动结果待核对，新旧文件均可能存在，请核对后再操作'), { committed: true });
          if (error.code === 'EEXIST') throw fail(409, '目标已存在，未覆盖原资料');
          throw error;
        } finally { await fs.rm(temp, { force: true }); }
      } else {
        // Directory move is atomic for this shared service. Independent external
        // filesystem writers are outside its transaction boundary.
        await fs.rename(source, target);
      }
      return { from, to };
    });
  }
  remove(input, recursive, expected, signal) {
    return this.serial(async () => {
      check(signal);
      const target = await this.resolve(input);
      if (target === this.root) throw fail(400, '不能删除工作区根目录');
      if (typeof expected !== 'string' || await this.version(input) !== expected) throw fail(409, '文件或目录已变化，未删除原资料');
      check(signal);
      const stat = await fs.lstat(target);
      if (stat.isDirectory() && !recursive) await fs.rmdir(target);
      else await fs.rm(target, { recursive: Boolean(recursive) });
      return {};
    });
  }
}
