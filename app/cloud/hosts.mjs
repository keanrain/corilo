import path from 'node:path';
import { mkdir, realpath, lstat } from 'node:fs/promises';
import { startHost } from '../host/server.mjs';
import { fault } from '../host/vault.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);

// One owner of file hosts per data root. A future controller transport must call
// this owner, not open a competing host in another process. No Docker access here.
export class CloudHosts {
  constructor({ pool, dataRoot, maxHosts = 20 }) {
    if (!pool || !path.isAbsolute(dataRoot || '') || !Number.isInteger(maxHosts) || maxHosts < 1 || maxHosts > 1000)
      throw new Error('Invalid file host configuration');
    Object.assign(this, { pool, dataRoot: path.resolve(dataRoot), maxHosts });
    this.hosts = new Map(); this.closed = false;
  }
  async directory(...parts) {
    let target = this.dataRoot;
    await mkdir(target, { recursive: true, mode: 0o700 });
    if (await realpath(target) !== target || !(await lstat(target)).isDirectory()) throw new Error('Unsafe file host directory');
    for (const part of parts) {
      if (!part || part === '.' || part === '..' || part.includes(path.sep)) throw new Error('Invalid file host directory');
      target = path.join(target, part);
      await mkdir(target, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
      if (await realpath(target) !== target || !(await lstat(target)).isDirectory()) throw new Error('Unsafe file host directory');
    }
    return target;
  }

  async forAccount(accountId) {
    if (this.closed) throw fault(503, '文件服务正在退出');
    if (!uuid(accountId)) throw fault(404, '账号不存在');
    const account = (await this.pool.query(`SELECT a.id,v.id AS vault_id FROM corilo_private.accounts a
      JOIN corilo_private.vaults v ON v.owner_id=a.id WHERE a.id=$1 AND NOT a.disabled`, [accountId])).rows[0];
    if (!account) throw fault(403, '账号不可用');
    return this.host(account.vault_id);
  }
  // Trusted controller integration only; validate all claimed identifiers against
  // the durable run. Disabled accounts must still be recoverable/terminable.
  async forRun(claim) {
    if (this.closed) throw fault(503, '文件服务正在退出');
    if (![claim?.id,claim?.ownerId,claim?.vaultId,claim?.conversationId].every(uuid)) throw fault(404, '任务不存在');
    const row = (await this.pool.query(`SELECT vault_id FROM corilo_private.runs
      WHERE id=$1 AND owner_id=$2 AND vault_id=$3 AND conversation_id=$4`,
    [claim.id,claim.ownerId,claim.vaultId,claim.conversationId])).rows[0];
    if (!row) throw fault(404, '任务不存在');
    const host = await this.host(row.vault_id);
    await this.directory(row.vault_id, 'state', 'conversations', claim.conversationId);
    return host;
  }
  host(vaultId) {
    if (this.closed) throw fault(503, '文件服务正在退出');
    if (!uuid(vaultId)) throw new Error('Invalid vault identity');
    if (!this.hosts.has(vaultId)) {
      if (this.hosts.size >= this.maxHosts) throw fault(503, '服务容量暂满，请稍后重试');
      const pending = this.open(vaultId);
      this.hosts.set(vaultId, pending);
      pending.catch(() => { if (this.hosts.get(vaultId) === pending) this.hosts.delete(vaultId); });
    }
    return this.hosts.get(vaultId);
  }
  async open(vaultId) {
    await this.directory();
    await this.directory(vaultId);
    const [vault, configDir, piAgentDir] = await Promise.all([
      this.directory(vaultId, 'knowledge'), this.directory(vaultId, 'state'), this.directory(vaultId, 'pi'),
    ]);
    return startHost({ mode: 'cloud-files', vault, configDir, piAgentDir });
  }
  close() {
    if (!this.closing) {
      this.closed = true;
      // Capture pending initialization too; a successful late start must be closed.
      this.closing = Promise.allSettled([...this.hosts.values()].map(async pending => {
        const host = await pending.catch(() => null);
        if (host) await host.close();
      })).then(results => {
        const failed = results.find(result => result.status === 'rejected');
        if (failed) throw failed.reason;
      });
    }
    return this.closing;
  }
}
