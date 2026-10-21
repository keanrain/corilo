import path from 'node:path';
import { constants } from 'node:fs';
import { open, opendir } from 'node:fs/promises';
import { buildSessionProjection, CURRENT_SESSION_VERSION } from '@earendil-works/pi-coding-agent';
import { fault } from '../host/vault.mjs';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const runView = row => row ? ({ id: row.id, conversationId: row.conversation_id, state: row.state, reason: row.reason,
  createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at }) : null;
const maxBytes = 4 * 1024 * 1024;
const maxEntries = 2000;
const result = (messagesStatus, messages = []) => ({ messagesStatus, messages });

// Linux service: pin every directory component with a descriptor, including the
// trusted root's ancestors. Never follow worker-created links or reopen by path.
async function transcript(directory) {
  const handles = [];
  try {
    if (process.platform !== 'linux') return result('unavailable');
    let dir = await open('/', constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    handles.push(dir);
    for (const component of directory.split(path.sep).filter(Boolean)) {
      dir = await open(`/proc/self/fd/${dir.fd}/${component}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      handles.push(dir);
    }
    const listing = await opendir(`/proc/self/fd/${dir.fd}`);
    const names = [];
    let count = 0;
    for await (const entry of listing) {
      if (++count > maxEntries) return result('unavailable');
      if (entry.name.endsWith('.jsonl')) names.push(entry.name);
    }
    if (!names.length) return result('empty');
    // Multiple native sessions require a trustworthy latest-session selection.
    // Fail closed instead of choosing an arbitrary worker-controlled transcript.
    if (names.length !== 1) return result('unavailable');
    const file = await open(`/proc/self/fd/${dir.fd}/${names[0]}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    handles.push(file);
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes) return result('unavailable');
    const buffer = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    const after = await file.stat();
    if (size > maxBytes || size !== stat.size || after.size !== stat.size || after.nlink !== 1 || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs)
      return result('unavailable');
    const lines = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)).trimEnd().split('\n');
    if (lines.length > maxEntries || !lines.length) return result('unavailable');
    const [header, ...entries] = lines.map(line => JSON.parse(line));
    if (header?.type !== 'session' || header.version !== CURRENT_SESSION_VERSION || typeof header.id !== 'string' || header.cwd !== '/knowledge') return result('unavailable');
    const byId = new Map();
    for (const entry of entries) {
      if (!entry || entry.type === 'session' || typeof entry.type !== 'string' || typeof entry.id !== 'string' || !entry.id ||
        byId.has(entry.id) || (entry.parentId !== null && (typeof entry.parentId !== 'string' || !byId.has(entry.parentId))))
        return result('unavailable');
      byId.set(entry.id, entry);
    }
    const projection = buildSessionProjection(entries, entries.at(-1)?.id ?? null, byId);
    const messages = [];
    let textBytes = 0;
    for (const projected of projection.entries) {
      if (projected.sourceEntry.type !== 'message') continue;
      for (const message of projected.messages) {
        if (!['user', 'assistant'].includes(message.role)) continue;
        const text = typeof message.content === 'string' ? message.content : Array.isArray(message.content)
          ? message.content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n') : '';
        textBytes += Buffer.byteLength(text);
        if (textBytes > maxBytes || messages.length >= maxEntries) return result('unavailable');
        if (text) messages.push({ role: message.role, text });
      }
    }
    return result(messages.length ? 'ready' : 'empty', messages);
  } catch (error) {
    return result(error.code === 'ENOENT' ? 'empty' : 'unavailable');
  } finally { await Promise.all(handles.reverse().map(handle => handle.close())); }
}

export class CloudConversations {
  constructor(pool, { dataRoot } = {}) {
    if (typeof dataRoot !== 'string' || !path.isAbsolute(dataRoot)) throw new Error('Absolute dataRoot required');
    this.pool = pool; this.dataRoot = path.resolve(dataRoot);
  }
  async transaction(ownerId, task) {
    if (!uuid(ownerId)) throw fault(404, '账号不存在');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Same fence as Runs.claim/submit/finish. Only bounded local reads inside.
      await client.query('SELECT pg_advisory_xact_lock(174923, 2)');
      const owner = (await client.query(`SELECT v.id AS vault_id FROM corilo_private.accounts a
        JOIN corilo_private.vaults v ON v.owner_id=a.id WHERE a.id=$1 AND NOT a.disabled FOR SHARE OF a`, [ownerId])).rows[0];
      if (!owner) throw fault(403, '账号不可用');
      const value = await task(client, owner.vault_id);
      await client.query('COMMIT'); return value;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async list(ownerId, { before, limit = 25 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (before !== undefined && !uuid(before))) throw fault(400, '会话分页参数无效');
    return this.transaction(ownerId, async (client, vaultId) => {
      if (before && !(await client.query('SELECT 1 FROM corilo_private.conversations WHERE id=$1 AND owner_id=$2 AND vault_id=$3', [before, ownerId, vaultId])).rowCount)
        throw fault(404, '会话不存在');
      const rows = (await client.query(`SELECT c.id,c.created_at,r.row AS last_run FROM corilo_private.conversations c
        LEFT JOIN LATERAL (SELECT row_to_json(r) AS row FROM corilo_private.runs r WHERE r.conversation_id=c.id AND r.owner_id=$1
          ORDER BY r.created_at DESC,r.id DESC LIMIT 1) r ON true
        WHERE c.owner_id=$1 AND c.vault_id=$2 AND ($3::uuid IS NULL OR (c.created_at,c.id) <
          (SELECT created_at,id FROM corilo_private.conversations WHERE id=$3 AND owner_id=$1))
        ORDER BY c.created_at DESC,c.id DESC LIMIT $4`, [ownerId, vaultId, before ?? null, limit + 1])).rows;
      const items = rows.slice(0, limit).map(row => ({ id: row.id, createdAt: row.created_at, lastRun: runView(row.last_run) }));
      return { items, nextCursor: rows.length > limit ? items.at(-1).id : null };
    });
  }
  async detail(ownerId, conversationId) {
    if (!uuid(conversationId)) throw fault(404, '会话不存在');
    return this.transaction(ownerId, async (client, vaultId) => {
      const conversation = (await client.query('SELECT id,created_at FROM corilo_private.conversations WHERE id=$1 AND owner_id=$2 AND vault_id=$3', [conversationId, ownerId, vaultId])).rows[0];
      if (!conversation) throw fault(404, '会话不存在');
      const runs = (await client.query('SELECT * FROM corilo_private.runs WHERE conversation_id=$1 AND owner_id=$2 ORDER BY created_at DESC,id DESC LIMIT 25', [conversationId, ownerId])).rows.map(runView);
      const busy = (await client.query("SELECT 1 FROM corilo_private.runs WHERE vault_id=$1 AND state IN ('queued','running','stopping') LIMIT 1", [vaultId])).rowCount;
      const messages = busy ? result('running') : await transcript(path.join(this.dataRoot, vaultId, 'state', 'conversations', conversationId, 'sessions'));
      return { id: conversation.id, createdAt: conversation.created_at, runs, ...messages };
    });
  }
}
