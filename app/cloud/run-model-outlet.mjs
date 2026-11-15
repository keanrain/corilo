import * as fs from 'node:fs/promises';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { startModelRelay } from './model-relay.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const denied = () => Object.assign(new Error('Model request unavailable'), { status: 401 });

// Recovery revokes existing task grants and removes only their known socket.
// No model key, budget, relay construction or grant issuance is needed.
export class RunModelRecovery {
  constructor({ grants, socketRoot } = {}) {
    if (typeof grants?.revokeRun !== 'function' || typeof socketRoot !== 'string' ||
        !path.isAbsolute(socketRoot) || socketRoot.includes('\0')) throw new Error('Explicit model recovery configuration required');
    this.grants = grants; this.socketRoot = path.resolve(socketRoot);
    this.relays = new Map(); this.queues = new Map(); this.closed = false;
  }
  async prepare() { throw new Error('Model execution is disabled in recovery mode'); }
  serial(id, task) {
    if (!uuid(id)) throw new Error('Invalid model run ID');
    const next = (this.queues.get(id) || Promise.resolve()).then(task);
    const settled = next.catch(() => {}); this.queues.set(id, settled);
    void settled.then(() => { if (this.queues.get(id) === settled) this.queues.delete(id); });
    return next;
  }
  async teardown(id) {
    const entry = this.relays.get(id);
    let failure;
    // Close admission immediately even when the database is unavailable.
    try { await entry?.relay?.close(); } catch (error) { failure = error; }
    try { await this.grants.revokeRun(id); } catch (error) { failure ||= error; }
    if (!failure) {
      // Recovery may have no live relay object. Remove only this run's known
      // socket and empty private directory, never recursively sweep unknown data.
      const directory = path.join(this.socketRoot, id), socketPath = path.join(directory, 'm.sock');
      const stat = await fs.lstat(directory).catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (stat) {
        if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077) ||
            await fs.realpath(directory) !== directory) throw new Error('Unsafe model socket directory');
        const socket = await fs.lstat(socketPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
        if (socket) {
          if (!socket.isSocket() || socket.uid !== process.getuid()) throw new Error('Unsafe model socket');
          await fs.unlink(socketPath);
        }
        await fs.rmdir(directory);
      }
      this.relays.delete(id);
    }
    if (failure) throw failure;
  }
  async revoke(id) { return this.serial(id, () => this.teardown(id)); }
  async close() {
    this.closed = true;
    await Promise.allSettled([...this.queues.values()]);
    const outcomes = await Promise.allSettled([...this.relays.keys()].map(id => this.revoke(id)));
    const failed = outcomes.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
  }
}

// Trusted controller adapter. One socket exposes one grant, never a shared model
// proxy that a worker could use with another task's stolen credential.
export class RunModelOutlet extends RunModelRecovery {
  constructor({ grants, socketRoot, limits, relayOptions }) {
    super({ grants, socketRoot });
    if (!grants?.issue || !grants?.reserve || !grants?.assertActive || !limits || !relayOptions)
      throw new Error('Explicit per-run model outlet configuration required');
    this.limits = { ...limits }; this.relayOptions = { ...relayOptions };
  }
  async directory(id) {
    await fs.mkdir(this.socketRoot, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(this.socketRoot);
    if (await fs.realpath(this.socketRoot) !== this.socketRoot || !stat.isDirectory() ||
        stat.uid !== process.getuid() || (stat.mode & 0o077)) throw new Error('Unsafe model socket root');
    const directory = path.join(this.socketRoot, id), socketPath = path.join(directory, 'm.sock');
    if (Buffer.byteLength(socketPath) > 100) throw new Error('Model socket path too long');
    await fs.mkdir(directory, { mode: 0o700 }); // Existing run directories are recovery work, not a replay.
    return { directory, socketPath };
  }
  async prepare(claim) {
    return this.serial(claim.id, async () => {
      if (this.closed || this.relays.has(claim.id)) throw new Error('Model outlet unavailable');
      const entry = await this.directory(claim.id);
      this.relays.set(claim.id, entry);
      try {
        const grant = await this.grants.issue(claim, this.limits);
        const expected = Buffer.from(grant.token);
        const checkToken = token => {
          if (typeof token !== 'string') throw denied();
          const received = Buffer.from(token);
          if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw denied();
        };
        const checkOwner = value => {
          if (value.runId !== claim.id || value.ownerId !== claim.ownerId || value.vaultId !== claim.vaultId) throw denied();
          return value;
        };
        const scoped = {
          reserve: async (token, request) => { checkToken(token); return checkOwner(await this.grants.reserve(token, request)); },
          assertActive: async token => { checkToken(token); return checkOwner(await this.grants.assertActive(token)); },
        };
        entry.relay = await startModelRelay({ ...this.relayOptions, grants: scoped,
          allowedModels: [this.limits.model], socketPath: entry.socketPath });
        await fs.chmod(entry.socketPath, 0o600);
        return { socketPath: entry.socketPath, model: this.limits.model, token: grant.token, maxTokens: this.limits.maxTokensPerRequest };
      } catch (error) {
        // Issuance may have committed despite a lost DB response. Revoke by run ID.
        await this.teardown(claim.id).catch(() => {});
        throw error;
      }
    });
  }
}
