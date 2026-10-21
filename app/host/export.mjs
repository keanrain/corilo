import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { zip } from 'fflate';
import { fault } from './vault.mjs';
const makeZip = promisify(zip);

// Called under the host's writer queue, with Agent and Git sync idle.
// Export current visible files, never Git history, Pi configuration or sessions.
export async function exportKnowledge(vault, { maxBytes = 128 * 1024 * 1024, maxEntries = 10000 } = {}) {
  const entries = Object.create(null), files = [], directories = [], observed = [];
  let bytes = 0, count = 0;
  const unchanged = (a, b) => a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
  async function walk(relative = '') {
    const directory = await vault.resolve(relative);
    const before = await fs.lstat(directory);
    if (!before.isDirectory() || before.isSymbolicLink()) throw fault(409, '导出目录已变化，请重试');
    observed.push([directory, before]);
    for (const name of (await fs.readdir(directory)).sort()) {
      if (name.startsWith('.')) continue;
      if (++count > maxEntries) throw fault(413, '导出超过文件数量限制');
      const item = relative ? `${relative}/${name}` : name;
      const target = await vault.resolve(item); // Reject traversal and symlinks, including parents.
      const stat = await fs.lstat(target);
      if (stat.isDirectory()) {
        directories.push(item); entries[`knowledge/${item}/`] = new Uint8Array();
        await walk(item); continue;
      }
      if (!stat.isFile() || stat.nlink !== 1) throw fault(409, '导出不支持链接或特殊文件，请先处理后重试');
      if (bytes + stat.size > maxBytes) throw fault(413, '导出超过 128 MiB 容量限制，请分批整理后重试');
      const handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
      let data;
      try {
        const opened = await handle.stat();
        if (!unchanged(stat, opened)) throw fault(409, '导出期间文件发生变化，请重试');
        // Bound the read even when another local process grows a file during export.
        data = Buffer.alloc(stat.size);
        let offset = 0;
        while (offset < data.length) {
          const read = await handle.read(data, offset, data.length - offset, offset);
          if (!read.bytesRead) throw fault(409, '导出期间文件发生变化，请重试');
          offset += read.bytesRead;
        }
        if (!unchanged(stat, await handle.stat())) throw fault(409, '导出期间文件发生变化，请重试');
      } finally { await handle.close(); }
      bytes += data.length;
      observed.push([target, stat]);
      entries[`knowledge/${item}`] = data;
      files.push({ path: item, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
    }
  }
  await walk();
  entries['knowledge/'] = new Uint8Array();
  const manifest = { format: 'corilo-knowledge-export', version: 1, exportedAt: new Date().toISOString(),
    scope: 'Current visible knowledge files and attachments only',
    excluded: ['hidden files and directories', 'Git history', 'Pi configuration and credentials', 'conversations', 'tasks and schedules'],
    files, directories };
  entries['manifest.json'] = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  entries['README.txt'] = Buffer.from('Corilo 知识库导出 v1\n\nknowledge/ 保留普通文件、附件与空目录，可直接解压使用，无需 Corilo。\nmanifest.json 提供路径、字节数及 SHA-256 校验值。\n仅含已保存的可见知识库内容；不含隐藏项、Git 历史、Pi 配置、凭据、对话、任务或日程。\n这不是完整账号备份，不能用于恢复尚未导出的数据。\n');
  const archive = await makeZip(entries, { level: 0 });
  for (const [target, stat] of observed) {
    if (!unchanged(stat, await fs.lstat(target))) throw fault(409, '导出期间知识库发生变化，请重试');
  }
  return Buffer.from(archive);
}
