import path from 'node:path';
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { NoteHistory } from './history.mjs';
import { listPage, searchNotes } from './library.mjs';

const fail = (status, message) => Object.assign(new Error(message), { status });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const missing = error => error.code === 'ENOENT';
const checkSignal = signal => { if (signal?.aborted) throw fail(409, '操作已取消'); };
const changed = () => fail(409, '笔记已变化，请重新读取后保存');
const occupied = () => Object.assign(changed(), { occupied: true });
const defaults = { maxBytes: 1024 * 1024, maxEntries: 2000, maxTotalBytes: 8 * 1024 * 1024 };
const textBytes = (text, maxBytes) => {
  if (typeof text !== 'string' || Buffer.byteLength(text) > maxBytes) throw fail(413, '笔记超过大小限制或正文无效');
  const bytes = Buffer.from(text);
  if (bytes.toString('utf8') !== text) throw fail(400, '笔记不是有效 Unicode 文本');
  return bytes;
};

// Portable Markdown storage, not a filesystem sandbox for other tools/processes.
// Version checks coordinate this store's operations; independent editors must
// still be reconciled. No claim of atomic compare-and-swap against arbitrary writers.
export class NotesStore {
  static async open(root, limits = {}, { stateRoot } = {}) {
    if (typeof root !== 'string' || !path.isAbsolute(root) || root.includes('\0')) throw fail(400, '笔记目录需为绝对路径');
    root = path.resolve(root);
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    if (await fs.realpath(root) !== root || !(await fs.lstat(root)).isDirectory()) throw fail(400, '笔记目录不支持链接');
    const store = new NotesStore(root, limits);
    if (stateRoot !== undefined) store.recovery = await NoteHistory.open(root, stateRoot, store.limits.maxBytes);
    return store;
  }
  constructor(root, limits = {}) {
    this.root = root;
    this.limits = { ...defaults, ...limits };
    for (const key of Object.keys(defaults)) if (!Number.isSafeInteger(this.limits[key]) || this.limits[key] < 1 || this.limits[key] > defaults[key]) throw fail(400, '笔记大小限制无效');
    this.queue = Promise.resolve();
  }
  serial(task) {
    const next = this.queue.then(task).catch(error => {
      if ([400, 404, 409, 413].includes(error.status)) throw error;
      if (error.committed === true) throw error;
      throw fail(503, '笔记暂不可用');
    });
    this.queue = next.catch(() => {});
    return next;
  }
  parts(input) {
    if (typeof input !== 'string' || !input || input.includes('\\') || Buffer.byteLength(input) > 1024) throw fail(400, '笔记路径无效');
    const parts = input.split('/');
    if (parts.length > 20 || parts.some(part => !part || part.startsWith('.') || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || Buffer.byteLength(part) > 240 || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part)) || !/\.(md|markdown)$/i.test(parts.at(-1))) throw fail(400, '仅支持可移植的相对 Markdown 路径');
    return parts;
  }
  async location(input, createParents = false) {
    const parts = this.parts(input);
    if (await fs.realpath(this.root) !== this.root || !(await fs.lstat(this.root)).isDirectory()) throw fail(400, '笔记目录不支持链接');
    let directory = this.root;
    for (const part of parts.slice(0, -1)) {
      directory = path.join(directory, part);
      if (createParents) await fs.mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== directory) throw fail(400, '笔记路径不支持链接或特殊文件');
    }
    return path.join(directory, parts.at(-1));
  }
  async readFile(filename) {
    let handle;
    try {
      const entry = await fs.lstat(filename);
      if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) throw fail(400, '笔记不支持链接或特殊文件');
      handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const before = await handle.stat();
      if (entry.dev !== before.dev || entry.ino !== before.ino) throw changed();
      if (!before.isFile() || before.nlink !== 1) throw fail(400, '笔记不支持链接或特殊文件');
      if (before.size > this.limits.maxBytes) throw fail(413, '笔记超过大小限制');
      const buffer = Buffer.alloc(this.limits.maxBytes + 1);
      let size = 0;
      while (size < buffer.length) {
        const read = await handle.read(buffer, size, buffer.length - size, size);
        if (!read.bytesRead) break;
        size += read.bytesRead;
      }
      const after = await handle.stat();
      if (size > this.limits.maxBytes) throw fail(413, '笔记超过大小限制');
      if (size !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || after.nlink !== 1) throw changed();
      const bytes = buffer.subarray(0, size);
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw fail(400, '笔记不是有效 UTF-8 文本'); }
      return { text, version: hash(bytes), size };
    } catch (error) {
      if (missing(error)) throw fail(404, '笔记不存在');
      if (error.code === 'ELOOP') throw fail(400, '笔记不支持链接');
      throw error;
    } finally { await handle?.close(); }
  }
  read(input) {
    return this.serial(async () => {
      let filename;
      try { filename = await this.location(input); } catch (error) { if (missing(error)) throw fail(404, '笔记不存在'); throw error; }
      const { text, version } = await this.readFile(filename);
      return { path: input, text, version };
    });
  }
  list() {
    return this.serial(async () => {
      const items = []; let entries = 0, total = 0;
      const walk = async (directory, relative = '', depth = 0) => {
        if (depth > 20) throw fail(413, '笔记目录超过深度限制');
        const listing = await fs.opendir(directory);
        for await (const entry of listing) {
          if (++entries > this.limits.maxEntries) throw fail(413, '笔记目录超过条目限制');
          if (entry.name.startsWith('.')) continue;
          const input = relative ? relative + '/' + entry.name : entry.name;
          const filename = path.join(directory, entry.name), stat = await fs.lstat(filename);
          if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || (stat.isFile() && stat.nlink !== 1)) throw fail(400, '笔记目录不支持链接或特殊文件');
          if (stat.isDirectory()) await walk(filename, input, depth + 1);
          else if (/\.(md|markdown)$/i.test(entry.name)) {
            this.parts(input);
            const value = await this.readFile(filename); total += value.size;
            if (total > this.limits.maxTotalBytes) throw fail(413, '笔记列表超过总读取限制');
            items.push({ path: input, version: value.version, size: value.size });
          }
        }
      };
      if (await fs.realpath(this.root) !== this.root) throw fail(400, '笔记目录不支持链接');
      await walk(this.root);
      items.sort((a, b) => a.path.localeCompare(b.path));
      return { items };
    });
  }
  browse(options = {}) { return this.serial(() => listPage(this, options)); }
  search(options = {}) { return this.serial(() => searchNotes(this, options)); }
  create({ text = '', signal } = {}) {
    return this.serial(async () => {
      checkSignal(signal);
      textBytes(text, this.limits.maxBytes);
      for (let number = 1; number <= 1000; number++) {
        checkSignal(signal);
        const input = number === 1 ? '未命名.md' : `未命名 ${number}.md`;
        const filename = await this.location(input);
        // Occupancy is metadata only: an existing large note, directory or
        // unsafe link is skipped without reading its content or following it.
        if (await fs.lstat(filename).then(() => true, error => { if (missing(error)) return false; throw error; })) continue;
        try {
          const result = await this.write(input, text, null, signal);
          return { ...result, text };
        } catch (error) {
          if (error.committed === true) throw Object.assign(error, { path: input });
          // Only exclusive-create collisions may choose another name. A
          // cancellation or any other version/validation failure is final.
          if (error.occupied === true && !signal?.aborted) continue;
          throw error;
        }
      }
      throw fail(409, '未命名笔记已达到 1000 个，请先重命名已有笔记再新建');
    });
  }
  save({ path: input, text, expected, signal } = {}) {
    return this.serial(() => this.write(input, text, expected, signal));
  }
  rename({ path: input, to, expected, signal } = {}) {
    return this.serial(async () => {
      checkSignal(signal);
      this.parts(input); this.parts(to);
      if (path.posix.dirname(input) !== path.posix.dirname(to)) throw fail(400, '重命名只能修改同一目录中的文件名');
      if (input === to) throw fail(400, '新文件名与原文件名相同');
      if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) throw changed();
      const source = await this.location(input).catch(error => { if (missing(error)) throw fail(404, '笔记不存在'); throw error; });
      const destination = await this.location(to);
      const current = await this.readFile(source);
      if (current.version !== expected) throw changed();
      // Occupancy includes links, directories and unsafe files: none may be
      // replaced. Publication below repeats this check atomically via link().
      if (await fs.lstat(destination).then(() => true, error => { if (missing(error)) return false; throw error; })) throw fail(409, '此文件名已存在，请使用其他名称');
      let previousRevision = null;
      if (this.recovery) previousRevision = await this.recovery.snapshot(input, current.text, 'before');
      checkSignal(signal);
      const temp = path.join(path.dirname(source), `.corilo-${randomUUID()}.tmp`);
      let handle, published = false, removed = false;
      try {
        handle = await fs.open(temp, 'wx', 0o600);
        await handle.writeFile(Buffer.from(current.text)); await handle.sync(); await handle.close(); handle = null;
        const latest = await this.readFile(source);
        if (latest.version !== expected) throw changed();
        checkSignal(signal);
        // Node has no portable rename-no-replace operation. Create the target
        // exclusively, then remove the source only after target/history checks.
        // Target publication is the commit boundary; cancellation afterwards
        // cannot pretend to roll it back. A crash can leave both names.
        try { await fs.link(temp, destination); }
        catch (error) { if (error.code === 'EEXIST') throw fail(409, '此文件名已存在，请使用其他名称'); throw error; }
        published = true;
        await fs.unlink(temp);
        const directory = await fs.open(path.dirname(source), constants.O_RDONLY);
        try { await directory.sync(); } finally { await directory.close(); }
        if (this.recovery) await this.recovery.snapshot(to, current.text, 'rename', { previousPath: input, previousRevision });
        const beforeRemoval = await this.readFile(source), target = await this.readFile(destination);
        if (beforeRemoval.version !== expected || target.version !== expected) throw changed();
        await fs.unlink(source); removed = true;
        const finalDirectory = await fs.open(path.dirname(source), constants.O_RDONLY);
        try { await finalDirectory.sync(); } finally { await finalDirectory.close(); }
        return { path: to, previousPath: input, previousRevision, text: current.text, version: current.version };
      } catch (error) {
        if (published) throw Object.assign(fail(503, removed
          ? '新文件名已生效，但重命名确认未完成；请核对两个文件名，不要自动重试'
          : '新文件名已创建，原文件尚未删除或历史确认未完成；请核对两个文件名，不要自动重试'),
        { committed: true, previousPath: input, path: to });
        throw error;
      } finally {
        try { await handle?.close(); await fs.rm(temp, { force: true }); }
        catch {
          if (published) throw Object.assign(fail(503, '新文件名已创建，但临时文件清理未完成；请核对两个文件名，不要自动重试'), { committed: true, previousPath: input, path: to });
          throw fail(503, '重命名尚未完成，临时文件清理失败；请先核对文件');
        }
      }
    });
  }
  async write(input, text, expected, signal, operation = 'save') {
    checkSignal(signal);
    this.parts(input);
    const bytes = textBytes(text, this.limits.maxBytes);
    if (expected !== null && (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected))) throw fail(409, '创建需 expected=null，更新需提供读取版本');
    const filename = await this.location(input, true);
    const current = await this.readFile(filename).catch(error => { if (error.status === 404) return null; throw error; });
    if ((current?.version ?? null) !== expected) throw expected === null && current ? occupied() : changed();
    if (this.recovery) await this.recovery.check();
    if (current && this.recovery) await this.recovery.snapshot(input, current.text, 'before');
    checkSignal(signal);
    const temp = path.join(path.dirname(filename), `.corilo-${randomUUID()}.tmp`);
    let handle, committed = false;
    try {
      handle = await fs.open(temp, 'wx', 0o600); await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
      checkSignal(signal);
      if (expected === null) {
        // Hard-link creation is exclusive and cannot overwrite a concurrent create.
        try { await fs.link(temp, filename); } catch (error) { if (error.code === 'EEXIST') throw occupied(); throw error; }
        committed = true;
        await fs.unlink(temp);
      } else {
        const latest = await this.readFile(filename).catch(error => { if (error.status === 404) throw changed(); throw error; });
        if (latest.version !== expected) throw changed();
        checkSignal(signal);
        await fs.rename(temp, filename);
        committed = true;
      }
      const directory = await fs.open(path.dirname(filename), constants.O_RDONLY);
      try { await directory.sync(); } finally { await directory.close(); }
      if (this.recovery) {
        try { await this.recovery.snapshot(input, text, operation); }
        catch { throw Object.assign(fail(503, '笔记已写入，但历史记录未完成；请重新读取确认'), { committed: true }); }
      }
      return { path: input, version: hash(bytes) };
    } catch (error) {
      if (committed && !error.committed) throw Object.assign(fail(503, '笔记已写入，但保存确认未完成；请重新读取确认'), { committed: true });
      throw error;
    } finally { await handle?.close(); await fs.rm(temp, { force: true }); }
  }
  capture(text, { signal } = {}) {
    return this.serial(async () => {
      checkSignal(signal);
      if (typeof text !== 'string' || !text.trim()) throw fail(400, '原话不能为空');
      const filename = `收集/${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.md`;
      return this.write(filename, text, null, signal);
    });
  }
  requireRecovery() {
    if (!this.recovery) throw fail(400, '历史与回收站尚未配置');
    return this.recovery;
  }
  history(input, options = {}) {
    return this.serial(async () => { this.parts(input); return this.requireRecovery().history(input, options); });
  }
  maintain() { return this.serial(() => this.requireRecovery().maintain()); }
  readRevision(input, revision) {
    return this.serial(async () => { this.parts(input); return this.requireRecovery().read(input, revision); });
  }
  restore({ path: input, revision, expected, signal } = {}) {
    return this.serial(async () => {
      checkSignal(signal); this.parts(input);
      const note = await this.requireRecovery().read(input, revision);
      return this.write(input, note.text, expected, signal, 'restore');
    });
  }
  trash({ path: input, expected, signal } = {}) {
    return this.serial(async () => {
      checkSignal(signal); this.parts(input);
      const history = this.requireRecovery();
      if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) throw changed();
      const filename = await this.location(input);
      const current = await this.readFile(filename);
      if (current.version !== expected) throw changed();
      const id = await history.snapshot(input, current.text, 'trash');
      await history.putTrash(id);
      let removed = false;
      try {
        checkSignal(signal);
        const latest = await this.readFile(filename);
        if (latest.version !== expected) throw changed();
        checkSignal(signal);
        await fs.unlink(filename); removed = true;
        const directory = await fs.open(path.dirname(filename), constants.O_RDONLY);
        try { await directory.sync(); } finally { await directory.close(); }
        return { id, path: input, version: current.version };
      } catch (error) {
        if (removed) throw Object.assign(fail(503, '笔记已移入回收站，但目录同步未完成；请重新读取确认'), { committed: true });
        await history.removeTrash(id).catch(() => {});
        throw error;
      }
    });
  }
  listTrash(options = {}) {
    return this.serial(async () => {
      const page = await this.requireRecovery().trashItems(options);
      const { items } = page;
      for (const item of items) {
        item.originalPresent = await pathOccupied(this.root, this.parts(item.path));
      }
      return page;
    });
  }
  restoreTrash({ id, path: input, expected, signal } = {}) {
    return this.serial(async () => {
      checkSignal(signal); this.parts(input);
      if (expected !== null) throw fail(409, '回收站恢复只能新建，请使用 expected=null');
      const history = this.requireRecovery(), note = await history.readTrash(id);
      this.parts(note.path);
      const result = await this.write(input, note.text, null, signal, 'restore');
      try { await history.removeTrash(id); }
      catch { throw Object.assign(fail(503, '笔记已恢复，但回收站标记未更新；请重新读取确认'), { committed: true }); }
      return result;
    });
  }
}

// Occupancy is metadata only. A replacement directory, invalid text, oversized
// file or link must not prevent browsing recovery records. Stop before entering
// linked/non-directory components; writes retain their own stricter validation.
async function pathOccupied(root, parts) {
  let filename = root;
  for (let index = -1; index < parts.length; index++) {
    if (index >= 0) filename = path.join(filename, parts[index]);
    let stat;
    try { stat = await fs.lstat(filename); }
    catch (error) {
      if (missing(error)) return false;
      if (['EACCES', 'EPERM', 'ENOTDIR', 'ELOOP'].includes(error.code)) return true;
      throw error;
    }
    if (!stat) return false;
    if (index === parts.length - 1 || !stat.isDirectory() || stat.isSymbolicLink()) return true;
    try { if (await fs.realpath(filename) !== filename) return true; }
    catch (error) {
      if (['EACCES', 'EPERM', 'ENOTDIR', 'ELOOP'].includes(error.code)) return true;
      throw error;
    }
  }
  return true;
}
