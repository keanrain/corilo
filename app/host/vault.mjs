import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export const fault = (status, message) => Object.assign(new Error(message), { status });
const digest = b => createHash('sha256').update(b).digest('hex');

export class Vault {
  constructor(root) { this.root = path.resolve(root); }
  async init() {
    await fs.mkdir(this.root, { recursive: true });
    this.root = await fs.realpath(this.root);
    // Refuse an inherited parent repository: this must be a standalone knowledge library.
    const ownGit = await fs.lstat(path.join(this.root, '.git')).catch(e => { if (e.code !== 'ENOENT') throw e; });
    if (ownGit && !ownGit.isDirectory()) throw fault(409, '知识库需使用独立 Git 仓库，不能使用链接工作树');
    if (!ownGit) await this.git(['init', '--initial-branch=main']);
    await this.git(['config', '--local', 'core.autocrlf', 'false']);
    await this.checkpoint('Corilo: initial local history');
  }
  async git(args) {
    return (await exec('git', ['-c', 'user.name=Corilo', '-c', 'user.email=local@corilo.invalid', '-c', 'commit.gpgsign=false', ...args], {
      cwd: this.root, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
    })).stdout;
  }
  async checkpoint(message) {
    const state = await this.git(['status', '--porcelain']);
    if (state) {
      await this.git(['add', '--all']);
      await this.git(['commit', '-m', message]);
    } else {
      try { await this.git(['rev-parse', '--verify', 'HEAD']); }
      catch { await this.git(['commit', '--allow-empty', '-m', message]); }
    }
    return (await this.git(['rev-parse', 'HEAD'])).trim();
  }
  async resolve(input = '') {
    if (typeof input !== 'string' || input.includes('\\') || input.includes('\0')) throw fault(400, '无效路径');
    const parts = input.replace(/^\/+/, '').split('/').filter(Boolean);
    if (parts.some(p => p === '..' || p.startsWith('.') || p.includes(':'))) throw fault(400, '不允许访问此路径');
    let target = this.root;
    for (const part of parts) {
      target = path.join(target, part);
      const stat = await fs.lstat(target).catch(e => { if (e.code !== 'ENOENT') throw e; });
      if (stat?.isSymbolicLink()) throw fault(400, '文件页面不支持符号链接');
    }
    return target;
  }
  async validateNew(input) {
    const target = await this.resolve(input);
    const name = path.basename(target);
    if (/[<>:"|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name))
      throw fault(400, '该名称不能在 Windows 上使用');
    const siblings = await fs.readdir(path.dirname(target));
    if (siblings.some(n => n !== name && n.normalize('NFC').toLowerCase() === name.normalize('NFC').toLowerCase()))
      throw fault(409, '存在大小写或 Unicode 名称冲突');
    return target;
  }
  async stat(input) {
    const p = await this.resolve(input), s = await fs.stat(p);
    return { name: path.basename(p), kind: s.isDirectory() ? 'directory' : 'file', size: s.size, lastModified: s.mtimeMs, version: await this.version(input) };
  }
  async list(input) {
    const p = await this.resolve(input);
    const entries = (await fs.readdir(p, { withFileTypes: true }))
      .filter(e => !e.name.startsWith('.') && !e.isSymbolicLink());
    const result = [];
    for (const e of entries) result.push({ name: e.name, kind: e.isDirectory() ? 'directory' : 'file', version: await this.version(path.posix.join(input || '', e.name)) });
    return result;
  }
  async version(input) {
    const p = await this.resolve(input), stat = await fs.lstat(p);
    if (stat.isFile()) return digest(await fs.readFile(p));
    if (!stat.isDirectory()) throw fault(400, '不支持此文件类型');
    // Descendant metadata detects managed atomic writes, additions, removals and moves.
    // Include hidden descendants but never follow links. No file bodies are loaded for a tree token.
    const hash = createHash('sha256');
    const walk = async (dir, relative = '') => {
      for (const name of (await fs.readdir(dir)).sort()) {
        const child = path.join(dir, name), key = path.posix.join(relative, name);
        const s = await fs.lstat(child, { bigint: true });
        hash.update(JSON.stringify([key, String(s.mode), String(s.ino), String(s.size), String(s.mtimeNs), String(s.ctimeNs)]));
        if (s.isDirectory()) await walk(child, key);
      }
    };
    await walk(p);
    return 'dir-' + hash.digest('hex');
  }
  async assertVersion(input, expected) {
    if (typeof expected !== 'string' || !expected || await this.version(input) !== expected)
      throw fault(409, '文件或目录已变化；未执行删除或移动，请刷新核对后重试');
  }
  async read(input) {
    const p = await this.resolve(input), data = await fs.readFile(p), stat = await fs.stat(p);
    return { data, etag: digest(data), lastModified: stat.mtimeMs };
  }
  async create(input, kind) {
    const p = await this.validateNew(input);
    if (kind === 'directory') await fs.mkdir(p).catch(e => { if (e.code !== 'EEXIST') throw e; });
    else { const handle = await fs.open(p, 'a'); await handle.close(); }
    const result = await this.stat(input);
    if (result.kind !== kind) throw fault(409, '路径类型不匹配');
    return result;
  }
  async write(input, data, expected) {
    const p = await this.resolve(input);
    const current = await fs.readFile(p);
    if (!expected || digest(current) !== expected) throw fault(409, '文件已在其他位置修改；草稿已保留，请重新加载或另存');
    // UI-only atomic replacement. Pi continues to use its own default file tools.
    const temp = path.join(path.dirname(p), `.corilo-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temp, data, { flag: 'wx' });
      await fs.rename(temp, p);
    } finally { await fs.rm(temp, { force: true }); }
    return { etag: digest(data) };
  }
  async rename(from, to, expected) {
    const source = await this.resolve(from), target = await this.validateNew(to);
    if (source === this.root || target === this.root) throw fault(400, '不能移动知识库根目录');
    await this.assertVersion(from, expected);
    if (source === target) return;
    try { await fs.lstat(target); throw fault(409, '目标已存在'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    await fs.rename(source, target);
  }
  async remove(input, recursive = false, expected) {
    const p = await this.resolve(input);
    if (p === this.root) throw fault(400, '不能删除知识库根目录');
    await this.assertVersion(input, expected);
    const stat = await fs.lstat(p);
    if (stat.isDirectory() && !recursive) await fs.rmdir(p);
    else await fs.rm(p, { recursive });
  }
}
