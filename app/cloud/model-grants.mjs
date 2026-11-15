import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fault } from '../host/vault.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const tokenValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const modelValid = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(value);
const bounded = (value, max) => Number.isSafeInteger(value) && value >= 1 && value <= max;
const view = row => ({ runId: row.run_id, ownerId: row.owner_id, vaultId: row.vault_id, model: row.model });

// Trusted control-plane/outlet only. Reserves output allowance before any upstream
// request; this is not tokenizer-based input accounting, billing, or actual usage.
// A lost upstream response never refunds a reservation and cannot reset a grant.
export class ModelGrants {
  constructor(pool) { this.pool = pool; }
  async transaction(task) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Same short lock as Runs: stop/finish and model admission have a defined order.
      // Never perform network I/O while this transaction is held.
      await client.query('SELECT pg_advisory_xact_lock(174923, 2)');
      const result = await task(client);
      await client.query('COMMIT'); return result;
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }
  async issue(claim, limits = {}) {
    const { model, maxRequests, maxOutputTokens, maxTokensPerRequest, ttlSeconds } = limits;
    if (!claim || ![claim.id, claim.ownerId, claim.vaultId, claim.conversationId].every(uuid) || !tokenValid(claim.token))
      throw fault(401, '执行身份已失效');
    if (!modelValid(model) || !bounded(maxRequests,10000) || !bounded(maxOutputTokens,1000000000) ||
      !bounded(maxTokensPerRequest,1000000) || maxTokensPerRequest > maxOutputTokens || !bounded(ttlSeconds,86400))
      throw fault(400, '模型调用额度无效');
    return this.transaction(async client => {
      const run = (await client.query(`SELECT r.id FROM corilo_private.runs r
        JOIN corilo_private.accounts a ON a.id=r.owner_id
        WHERE r.id=$1 AND r.owner_id=$2 AND r.vault_id=$3 AND r.lease_digest=$4 AND r.conversation_id=$5
          AND r.state='running' AND r.lease_until>clock_timestamp() AND r.deadline_at>clock_timestamp()
          AND NOT a.disabled FOR SHARE OF a`, [claim.id,claim.ownerId,claim.vaultId,hash(claim.token),claim.conversationId])).rows[0];
      if (!run) throw fault(401, '执行身份已失效');
      const token = randomBytes(32).toString('hex');
      const result = (await client.query(`INSERT INTO corilo_private.model_grants
        (run_id,digest,model,expires_at,max_requests,max_output_tokens,max_tokens_per_request)
        SELECT id,$2,$3,LEAST(deadline_at,clock_timestamp()+$4*interval '1 second'),$5,$6,$7
        FROM corilo_private.runs WHERE id=$1 ON CONFLICT (run_id) DO NOTHING RETURNING expires_at`,
      [claim.id,hash(token),model,ttlSeconds,maxRequests,maxOutputTokens,maxTokensPerRequest])).rows[0];
      if (!result) throw fault(409, '任务模型身份已签发，不能重置额度');
      return { token, expiresAt: result.expires_at };
    });
  }
  async active(client, token) {
    if (!tokenValid(token)) throw fault(401, '模型调用身份已失效');
    const row = (await client.query(`SELECT g.*,r.owner_id,r.vault_id FROM corilo_private.model_grants g
      JOIN corilo_private.runs r ON r.id=g.run_id JOIN corilo_private.accounts a ON a.id=r.owner_id
      WHERE g.digest=$1 AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()
        AND r.state='running' AND r.lease_until>clock_timestamp() AND r.deadline_at>clock_timestamp()
        AND NOT a.disabled FOR SHARE OF a`, [hash(token)])).rows[0];
    if (!row) throw fault(401, '模型调用身份已失效');
    return row;
  }
  async assertActive(token) { return this.transaction(async client => view(await this.active(client,token))); }
  async reserve(token, { model, maxTokens } = {}) {
    if (!modelValid(model) || !bounded(maxTokens,1000000)) throw fault(400, '模型请求额度无效');
    return this.transaction(async client => {
      const grant = await this.active(client,token);
      if (model !== grant.model) throw fault(403, '模型不在任务授权范围');
      if (maxTokens > grant.max_tokens_per_request || grant.reserved_requests >= grant.max_requests ||
        Number(grant.reserved_output_tokens) + maxTokens > Number(grant.max_output_tokens))
        throw fault(429, '模型调用额度不足');
      const reservationId = randomUUID();
      await client.query(`UPDATE corilo_private.model_grants SET reserved_requests=reserved_requests+1,
        reserved_output_tokens=reserved_output_tokens+$2 WHERE run_id=$1`, [grant.run_id,maxTokens]);
      await client.query('INSERT INTO corilo_private.model_reservations(id,run_id,max_tokens) VALUES($1,$2,$3)',
        [reservationId,grant.run_id,maxTokens]);
      return { ...view(grant), maxTokens, reservationId };
    });
  }
  async revokeRun(runId) {
    if (!uuid(runId)) throw fault(400, '任务 ID 无效');
    return this.transaction(async client => {
      await client.query('UPDATE corilo_private.model_grants SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE run_id=$1',[runId]);
    });
  }
}
