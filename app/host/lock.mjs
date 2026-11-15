import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fault } from './vault.mjs';

// Local filesystems in a single Linux PID namespace only. Keep the flock inode forever:
// unlinking it would let competing processes lock different inodes for the same vault.
export async function acquireHostLock(root, { recoverFileHost = false } = {}) {
  const marker = path.join(root, '.corilo-host.lock');
  const occupied = () => fault(409, '知识库已被宿主占用或无法确认旧进程状态；请确认旧进程已停止');
  let kernelLock, handle;
  if (process.platform === 'linux') {
    kernelLock = await fs.open(path.join(root, '.corilo-host.flock'), constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    try {
      const stat = await kernelLock.stat();
      if (!stat.isFile() || stat.nlink !== 1) throw occupied();
      // flock(2) belongs to the shared open file description. The short child acquires
      // it on inherited fd 3; our descriptor retains it until close or process death.
      await new Promise((resolve, reject) => {
        const child = spawn('flock', ['--exclusive', '--nonblock', '3'], { stdio: ['ignore', 'ignore', 'ignore', kernelLock.fd] });
        child.once('error', reject);
        child.once('close', code => code === 0 ? resolve() : reject(occupied()));
      });
    } catch (e) { await kernelLock.close(); throw e; }
  }
  const unlock = async () => { await kernelLock?.close(); };
  try {
    try { handle = await fs.open(marker, 'wx', 0o600); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (!kernelLock || !recoverFileHost) throw occupied();
      const stat = await fs.lstat(marker);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 64) throw occupied();
      const text = await fs.readFile(marker, 'utf8');
      // Only a known file-only host is recoverable: a dead local Pi parent may
      // still have live shell descendants. Legacy/ambiguous markers fail closed.
      const match = /^cloud-files:([1-9][0-9]*)$/.exec(text);
      if (!match) throw occupied();
      const pid = Number(match[1]);
      if (!Number.isSafeInteger(pid) || pid > 2147483647) throw occupied();
      try { process.kill(pid, 0); throw occupied(); }
      catch (e) { if (e.code !== 'ESRCH') throw occupied(); }
      // flock serializes recoverers; only a confirmed absent PID can be reclaimed.
      await fs.unlink(marker);
      handle = await fs.open(marker, 'wx', 0o600);
    }
    await handle.writeFile((recoverFileHost ? 'cloud-files:' : '') + process.pid);
  } catch (e) {
    if (handle) { await handle.close(); await fs.rm(marker, { force: true }); }
    await unlock(); throw e;
  }
  return { async close() {
    await handle.close(); await fs.rm(marker, { force: true }); await unlock();
  } };
}
