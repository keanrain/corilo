import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fault } from '../host/vault.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const active = new Set(['queued', 'running', 'stopping']);
const terminal = new Set(['completed', 'failed', 'stopped', 'interrupted']);
const view = row => ({ id: row.id, conversationId: row.conversation_id, state: row.state, reason: row.reason,
  createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at });

// Owner-scoped observation/cancellation needs no scheduler capacity configuration.
export class RunObservation {
  constructor(pool) { this.pool = pool; }
  async transaction(task) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize capacity checks and transitions across control-plane processes.
      // Never hold this transaction while calling a worker/model/network service.
      await client.query('SELECT pg_advisory_xact_lock(174923, 2)');
      const result = await task(client);
      await client.query('COMMIT'); return result;
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }
  async owner(client, ownerId) {
    if (!uuid(ownerId)) throw fault(404, '账号不存在');
    const row = (await client.query(`SELECT a.id,v.id AS vault_id FROM corilo_private.accounts a
      JOIN corilo_private.vaults v ON v.owner_id=a.id WHERE a.id=$1 AND NOT a.disabled FOR SHARE OF a`, [ownerId])).rows[0];
    if (!row) throw fault(403, '账号不可用');
    return row;
  }
  async event(client, run) {
    await client.query('INSERT INTO corilo_private.run_events(run_id,state,reason) VALUES($1,$2,$3)', [run.id, run.state, run.reason]);
    return view(run);
  }
  async owned(client, ownerId, runId) {
    await this.owner(client, ownerId);
    if (!uuid(runId)) throw fault(404, '任务不存在');
    const run = (await client.query('SELECT * FROM corilo_private.runs WHERE id=$1 AND owner_id=$2', [runId, ownerId])).rows[0];
    if (!run) throw fault(404, '任务不存在');
    return run;
  }
  async get(ownerId, runId) {
    return this.transaction(async client => view(await this.owned(client, ownerId, runId)));
  }
  async events(ownerId, runId, after = '0') {
    if (typeof after !== 'string' || !/^\d{1,18}$/.test(after)) throw fault(400, '事件游标无效');
    return this.transaction(async client => {
      await this.owned(client, ownerId, runId);
      return (await client.query(`SELECT id,state,reason,created_at AS "createdAt" FROM corilo_private.run_events
        WHERE run_id=$1 AND id>$2 ORDER BY id LIMIT 100`, [runId, after])).rows;
    });
  }
  async stop(ownerId, runId) {
    return this.transaction(async client => {
      const run = await this.owned(client, ownerId, runId);
      if (!active.has(run.state) || run.state === 'stopping') return view(run);
      const state = run.state === 'queued' ? 'stopped' : 'stopping';
      const updated = (await client.query(`UPDATE corilo_private.runs SET state=$2,reason='user_stop',
        finished_at=CASE WHEN $2='stopped' THEN now() ELSE NULL END WHERE id=$1 RETURNING *`, [runId, state])).rows[0];
      return this.event(client, updated);
    });
  }
}

// Internal control-plane service, not a browser or worker database API. All callers
// share these deployment-wide limits. Worker execution and model budgets are separate.
export class Runs extends RunObservation {
  constructor(pool, { maxRunning, maxQueued, leaseSeconds, maxRunSeconds } = {}) {
    super(pool);
    for (const [name, value, limit] of [['maxRunning', maxRunning, 1000], ['maxQueued', maxQueued, 10000],
      ['leaseSeconds', leaseSeconds, 300], ['maxRunSeconds', maxRunSeconds, 86400]]) {
      if (!Number.isInteger(value) || value < 1 || value > limit) throw new Error(`Invalid ${name}`);
    }
    if (leaseSeconds > maxRunSeconds) throw new Error('Lease cannot exceed run duration');
    Object.assign(this, { pool, maxRunning, maxQueued, leaseSeconds, maxRunSeconds });
  }
  async conversation(ownerId, conversationId = randomUUID()) {
    if (!uuid(conversationId)) throw fault(400, '会话 ID 无效');
    return this.transaction(async client => {
      const owner = await this.owner(client, ownerId);
      await client.query(`INSERT INTO corilo_private.conversations(id,owner_id,vault_id) VALUES($1,$2,$3)
        ON CONFLICT (id) DO NOTHING`, [conversationId, ownerId, owner.vault_id]);
      const row = (await client.query('SELECT id FROM corilo_private.conversations WHERE id=$1 AND owner_id=$2', [conversationId, ownerId])).rows[0];
      if (!row) throw fault(404, '会话不存在');
      return row.id;
    });
  }
  async submit(ownerId, { conversationId, key, prompt } = {}) {
    if (!uuid(conversationId) || typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(key) ||
      typeof prompt !== 'string' || !prompt.trim() || prompt.includes('\0') || Buffer.byteLength(prompt) > 65536)
      throw fault(400, '任务请求无效');
    return this.transaction(async client => {
      const owner = await this.owner(client, ownerId);
      const conversation = (await client.query('SELECT id FROM corilo_private.conversations WHERE id=$1 AND owner_id=$2 AND vault_id=$3',
        [conversationId, ownerId, owner.vault_id])).rows[0];
      if (!conversation) throw fault(404, '会话不存在');
      const existing = (await client.query('SELECT * FROM corilo_private.runs WHERE owner_id=$1 AND conversation_id=$2 AND request_key=$3', [ownerId, conversationId, key])).rows[0];
      if (existing) {
        if (existing.request_digest !== hash(prompt)) throw fault(409, '相同请求标识不能用于不同内容');
        return view(existing);
      }
      if ((await client.query("SELECT 1 FROM corilo_private.runs WHERE vault_id=$1 AND state IN ('queued','running','stopping')", [owner.vault_id])).rowCount)
        throw fault(409, '本知识库已有未结束任务');
      await this.cancelDisabledQueued(client);
      const count = Number((await client.query("SELECT count(*) FROM corilo_private.runs WHERE state='queued'")).rows[0].count);
      if (count >= this.maxQueued) throw fault(429, '任务队列已满，请稍后重试');
      const run = (await client.query(`INSERT INTO corilo_private.runs(id,owner_id,vault_id,conversation_id,request_key,request_digest,prompt,state)
        VALUES($1,$2,$3,$4,$5,$6,$7,'queued') RETURNING *`, [randomUUID(), ownerId, owner.vault_id, conversationId, key, hash(prompt), prompt])).rows[0];
      return this.event(client, run);
    });
  }
  async cancelDisabledQueued(client) {
    const rows = (await client.query(`UPDATE corilo_private.runs r SET state='interrupted',reason='account_disabled',finished_at=now()
      FROM corilo_private.accounts a WHERE r.owner_id=a.id AND a.disabled AND r.state='queued' RETURNING r.*`)).rows;
    for (const run of rows) await this.event(client, run);
  }
  // Trusted scheduler only. Expired/stopping runs still consume capacity until the
  // controller confirms their whole execution environment is gone.
  async claim() {
    return this.transaction(async client => {
      await this.cancelDisabledQueued(client);
      const used = Number((await client.query("SELECT count(*) FROM corilo_private.runs WHERE state IN ('running','stopping')")).rows[0].count);
      if (used >= this.maxRunning) return null;
      const row = (await client.query(`SELECT r.* FROM corilo_private.runs r JOIN corilo_private.accounts a ON a.id=r.owner_id
        WHERE r.state='queued' AND NOT a.disabled ORDER BY r.created_at,r.id LIMIT 1 FOR UPDATE OF r`)).rows[0];
      if (!row) return null;
      // Lock account against concurrent disable until this short claim commits.
      await this.owner(client, row.owner_id);
      const token = randomBytes(32).toString('hex');
      const run = (await client.query(`UPDATE corilo_private.runs SET state='running',started_at=now(),
        worker_id=$2,lease_digest=$3,lease_until=now()+$4*interval '1 second',deadline_at=now()+$5*interval '1 second'
        WHERE id=$1 RETURNING *`, [row.id, 'corilo-run-'+row.id, hash(token), this.leaseSeconds, this.maxRunSeconds])).rows[0];
      await this.event(client, run);
      return { ...view(run), ownerId: run.owner_id, vaultId: run.vault_id, workerId: run.worker_id, prompt: run.prompt, token };
    });
  }
  async leased(client, runId, token) {
    if (!uuid(runId) || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw fault(409, '执行身份已失效');
    const run = (await client.query(`SELECT r.*,a.disabled,(r.lease_until>now() AND r.deadline_at>now()) AS live
      FROM corilo_private.runs r JOIN corilo_private.accounts a ON a.id=r.owner_id
      WHERE r.id=$1 AND r.lease_digest=$2 AND r.state IN ('running','stopping') FOR SHARE OF a`, [runId, hash(token)])).rows[0];
    if (!run) throw fault(409, '执行身份已失效');
    return run;
  }
  async heartbeat(runId, token) {
    return this.transaction(async client => {
      const run = await this.leased(client, runId, token);
      if (run.disabled || !run.live || run.state !== 'running') return { continue: false };
      await client.query("UPDATE corilo_private.runs SET lease_until=LEAST(deadline_at,now()+$2*interval '1 second') WHERE id=$1", [runId, this.leaseSeconds]);
      return { continue: true };
    });
  }
  // Called by the controller ONLY AFTER confirming worker exit, not by model text
  // or a worker-provided 'done' message. A lease is not proof that a process died.
  async finish(runId, token, outcome) {
    if (!['completed','failed','stopped'].includes(outcome)) throw fault(400, '结束状态无效');
    return this.transaction(async client => {
      const run = await this.leased(client, runId, token);
      const reason = run.reason || (run.disabled ? 'account_disabled' : !run.live ? 'lease_expired' : null);
      const state = run.state === 'stopping' ? (reason === 'user_stop' ? 'stopped' : 'interrupted')
        : run.disabled || !run.live ? 'interrupted' : outcome;
      return this.end(client, run.id, state, reason);
    });
  }
  async end(client, runId, state, reason) {
    if (!terminal.has(state)) throw new Error('Invalid terminal state');
    const run = (await client.query(`UPDATE corilo_private.runs SET state=$2,reason=$3,finished_at=now(),
      lease_digest=NULL,lease_until=NULL WHERE id=$1 RETURNING *`, [runId, state, reason])).rows[0];
    return this.event(client, run);
  }
  // Returns candidates for reconciliation, never releases capacity or requeues them.
  async recoveryCandidates() {
    return (await this.pool.query(`SELECT r.id,r.worker_id AS "workerId",r.state FROM corilo_private.runs r
      JOIN corilo_private.accounts a ON a.id=r.owner_id
      WHERE r.state IN ('running','stopping') AND
      (r.state='stopping' OR r.lease_until<=now() OR r.deadline_at<=now() OR a.disabled)
      ORDER BY r.created_at LIMIT 100`)).rows;
  }
  async reconcile(runId, ensureWorkerStopped) {
    if (!uuid(runId) || typeof ensureWorkerStopped !== 'function') throw new Error('Worker reconciliation required');
    // Fence before performing external work, so an expired worker cannot renew or
    // report completion between reconciliation selection and termination.
    const pending = await this.transaction(async client => {
      const run = (await client.query(`SELECT r.*,a.disabled,(r.lease_until>now() AND r.deadline_at>now()) AS live
        FROM corilo_private.runs r JOIN corilo_private.accounts a ON a.id=r.owner_id WHERE r.id=$1`, [runId])).rows[0];
      if (!run || !['running','stopping'].includes(run.state)) return null;
      if (run.state === 'running' && run.live && !run.disabled) return null;
      const reason = run.reason || (run.disabled ? 'account_disabled' : 'lease_expired');
      const updated = (await client.query("UPDATE corilo_private.runs SET state='stopping',reason=$2 WHERE id=$1 RETURNING *", [runId, reason])).rows[0];
      if (run.state !== updated.state) await this.event(client, updated);
      return { workerId: run.worker_id, reason };
    });
    if (!pending) return null;
    // Must stop/remove the complete worker and verify absence, including a worker
    // that might still be launching. An exception or false leaves the vault held.
    if (await ensureWorkerStopped(pending.workerId) !== true) throw fault(503, '尚未确认执行环境已停止');
    return this.transaction(async client => {
      const run = (await client.query('SELECT * FROM corilo_private.runs WHERE id=$1', [runId])).rows[0];
      if (terminal.has(run.state)) return view(run);
      if (run.state !== 'stopping') throw fault(409, '执行状态已变化');
      return this.end(client, runId, pending.reason === 'user_stop' ? 'stopped' : 'interrupted', pending.reason);
    });
  }
}
