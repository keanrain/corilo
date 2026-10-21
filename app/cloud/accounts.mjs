import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { fault } from '../host/vault.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const normalize = email => {
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw fault(400, '请输入有效邮箱');
  return email.trim().toLowerCase();
};
export class Accounts {
  constructor(connectionString) { this.pool = new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000, statement_timeout: 10000 }); }
  async migrate() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(174923, 1)");
      await client.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }
  async invite(email, lifetimeHours = 72) {
    email = normalize(email);
    if (!Number.isInteger(lifetimeHours) || lifetimeHours < 1 || lifetimeHours > 720) throw fault(400, '邀请有效期无效');
    const token = randomBytes(32).toString('hex');
    await this.pool.query('INSERT INTO corilo_private.invitations(digest,email,expires_at) VALUES($1,$2,now()+$3*interval \'1 hour\')', [hash(token), email, lifetimeHours]);
    return token;
  }
  // identity must come from the server-side identity provider, never a browser userId.
  async login(identity, invitation = '') {
    const email = normalize(identity.email);
    if (typeof identity.subject !== 'string' || !identity.subject || identity.subject.length > 256) throw fault(401, '身份验证失败');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [identity.subject]);
      let account = (await client.query('SELECT * FROM corilo_private.accounts WHERE subject=$1 FOR UPDATE', [identity.subject])).rows[0];
      if (account?.disabled) throw fault(403, '账号已停用');
      if (!account) {
        if (!/^[a-f0-9]{64}$/.test(invitation)) throw fault(403, '需要有效的本人邀请');
        const invite = (await client.query('SELECT * FROM corilo_private.invitations WHERE digest=$1 AND expires_at>now() AND NOT revoked FOR UPDATE', [hash(invitation)])).rows[0];
        if (!invite || invite.email !== email || invite.redeemed_by) throw fault(403, '邀请无效或不属于当前账号');
        account = { id: randomUUID() };
        await client.query('INSERT INTO corilo_private.accounts(id,subject,email) VALUES($1,$2,$3)', [account.id, identity.subject, email]);
        await client.query('INSERT INTO corilo_private.vaults(id,owner_id) VALUES($1,$2)', [randomUUID(), account.id]);
        await client.query('UPDATE corilo_private.invitations SET redeemed_by=$1 WHERE digest=$2', [account.id, hash(invitation)]);
      }
      const token = randomBytes(32).toString('hex');
      await client.query('DELETE FROM corilo_private.sessions WHERE expires_at<=now()');
      await client.query('INSERT INTO corilo_private.sessions(digest,account_id,expires_at) VALUES($1,$2,now()+interval \'24 hours\')', [hash(token), account.id]);
      await client.query('COMMIT');
      return token;
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }
  async session(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    return (await this.pool.query(`SELECT a.id, a.email, v.id AS vault_id FROM corilo_private.sessions s
      JOIN corilo_private.accounts a ON a.id=s.account_id JOIN corilo_private.vaults v ON v.owner_id=a.id
      WHERE s.digest=$1 AND s.expires_at>now() AND NOT a.disabled`, [hash(token)])).rows[0] ?? null;
  }
  async logout(token) { if (token) await this.pool.query('DELETE FROM corilo_private.sessions WHERE digest=$1', [hash(token)]); }
  async close() { await this.pool.end(); }
}

export class SupabaseIdentity {
  constructor({ url, publishableKey }) {
    const origin = new URL(url);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('SUPABASE_URL must be an HTTPS origin');
    if (!publishableKey) throw new Error('SUPABASE_PUBLISHABLE_KEY is required');
    this.url = origin.origin; this.key = publishableKey;
  }
  async signIn(email, password) {
    email = normalize(email);
    if (typeof password !== 'string' || !password || password.length > 1024) throw fault(401, '邮箱或密码无效');
    let response;
    try {
      response = await fetch(`${this.url}/auth/v1/token?grant_type=password`, { method: 'POST', redirect: 'error',
        headers: { apikey: this.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(10000) });
    } catch { throw fault(503, '身份服务暂不可用，请稍后重试'); }
    if (!response.ok) throw fault(response.status >= 500 ? 503 : 401, '无法登录，请检查邮箱、密码和邮箱验证状态');
    const { user } = await response.json();
    if (!user?.id || !user.email_confirmed_at || user.is_anonymous || normalize(user.email) !== email) throw fault(401, '需要已验证的本人邮箱');
    return { subject: `${this.url}|${user.id}`, email: user.email };
  }
}
