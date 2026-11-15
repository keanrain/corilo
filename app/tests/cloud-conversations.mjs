import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, link, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { Accounts } from '../cloud/accounts.mjs';
import { Runs } from '../cloud/runs.mjs';
import { CloudConversations } from '../cloud/conversations.mjs';
if (!process.env.CORILO_TEST_DATABASE_URL) throw new Error('CORILO_TEST_DATABASE_URL must point to a disposable PostgreSQL database');

test('owned bounded conversation observation reads native Pi branch without replay or mutation', async t => {
  const accounts = new Accounts(process.env.CORILO_TEST_DATABASE_URL);
  t.after(() => accounts.close());
  await accounts.migrate();
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'corilo-conversations-'));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const owner = async () => {
    const email = `${randomUUID()}@example.test`;
    return accounts.session(await accounts.login({ subject: randomUUID(), email }, await accounts.invite(email)));
  };
  const a = await owner(), b = await owner();
  const runs = new Runs(accounts.pool, { maxRunning: 100, maxQueued: 100, leaseSeconds: 30, maxRunSeconds: 120 });
  const service = new CloudConversations(accounts.pool, { dataRoot });
  const ca = await runs.conversation(a.id), ca2 = await runs.conversation(a.id), cb = await runs.conversation(b.id);
  const all = await service.list(a.id);
  assert.equal(all.items.length, 2);
  assert.ok(all.items.every(c => c.lastRun === null));
  const first = await service.list(a.id, { limit: 1 });
  const second = await service.list(a.id, { limit: 1, before: first.nextCursor });
  assert.equal(second.nextCursor, null);
  assert.deepEqual([...first.items, ...second.items].map(c => c.id), all.items.map(c => c.id));
  await assert.rejects(service.list(a.id, { before: cb }), e => e.status === 404);
  for (const limit of [0, 101, 1.5, '1']) await assert.rejects(service.list(a.id, { limit }), e => e.status === 400);
  await assert.rejects(service.detail(a.id, '../sessions'), e => e.status === 404);
  await assert.rejects(service.detail(b.id, ca), e => e.status === 404);
  assert.equal((await service.detail(a.id, ca)).messagesStatus, 'empty');

  const directory = path.join(dataRoot, a.vault_id, 'state', 'conversations', ca, 'sessions');
  await mkdir(directory, { recursive: true });
  const session = SessionManager.create('/knowledge', directory);
  const firstEntry = session.appendMessage({ role: 'user', content: '原始问题', timestamp: Date.now() });
  const assistant = text => ({ role: 'assistant', content: [{ type: 'thinking', thinking: 'PRIVATE_THINKING' }, { type: 'text', text },
    { type: 'toolCall', id: 'secret-tool', name: 'bash', arguments: { command: 'PRIVATE_COMMAND' } }], api: 'openai-completions', provider: 'synthetic', model: 'synthetic',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now(), errorMessage: 'PRIVATE_PROVIDER_ERROR' });
  session.appendMessage(assistant('废弃分支'));
  session.branch(firstEntry);
  session.appendMessage({ role: 'user', content: [{ type: 'text', text: '当前问题' }, { type: 'image', data: 'PRIVATE_IMAGE', mimeType: 'image/png' }], timestamp: Date.now() });
  session.appendMessage({ role: 'toolResult', toolCallId: 'tool', toolName: 'bash', content: [{ type: 'text', text: 'PRIVATE_TOOL_RESULT' }], isError: false, timestamp: Date.now() });
  session.appendMessage(assistant('当前回答'));
  const filename = session.getSessionFile();
  const bytes = await readFile(filename);
  const read = await service.detail(a.id, ca);
  assert.equal(read.messagesStatus, 'ready');
  assert.deepEqual(read.messages, [{ role: 'user', text: '原始问题' }, { role: 'user', text: '当前问题' }, { role: 'assistant', text: '当前回答' }]);
  assert.ok(!JSON.stringify(read).includes('PRIVATE_'));
  assert.deepEqual(await readFile(filename), bytes, 'read never migrates or rewrites native sessions');

  const queued = await runs.submit(a.id, { conversationId: ca2, key: 'observation', prompt: 'PRIVATE_PROMPT' });
  assert.equal((await service.detail(a.id, ca)).messagesStatus, 'running', 'another conversation holds vault fence');
  assert.deepEqual((await service.detail(a.id, ca)).messages, []);
  assert.equal((await service.list(a.id)).items.find(c => c.id === ca2).lastRun.id, queued.id);
  await runs.stop(a.id, queued.id);
  assert.equal((await service.detail(a.id, ca2)).runs[0].state, 'stopped');
  const countBefore = (await accounts.pool.query('SELECT count(*) FROM corilo_private.runs WHERE owner_id=$1', [a.id])).rows[0].count;
  await new CloudConversations(accounts.pool, { dataRoot }).detail(a.id, ca2);
  assert.equal((await accounts.pool.query('SELECT count(*) FROM corilo_private.runs WHERE owner_id=$1', [a.id])).rows[0].count, countBefore, 'reconnection does not resubmit');

  // Check running/stopping without global scheduler ordering assumptions.
  const active = await runs.submit(a.id, { conversationId: ca, key: 'active', prompt: 'PRIVATE_PROMPT' });
  await accounts.pool.query("UPDATE corilo_private.runs SET state='running',lease_digest='synthetic',lease_until=now()+interval '1 minute',deadline_at=now()+interval '2 minutes' WHERE id=$1", [active.id]);
  assert.equal((await service.detail(a.id, ca)).messagesStatus, 'running');
  await runs.stop(a.id, active.id);
  assert.equal((await service.detail(a.id, ca)).messagesStatus, 'running');
  await runs.reconcile(active.id, async () => true);
  assert.equal((await service.detail(a.id, ca)).messagesStatus, 'ready');

  const assertUnavailable = async () => {
    const value = await service.detail(a.id, ca);
    assert.equal(value.messagesStatus, 'unavailable'); assert.deepEqual(value.messages, []);
    assert.ok(!JSON.stringify(value).includes(directory));
  };
  await writeFile(path.join(directory, 'another.jsonl'), bytes); await assertUnavailable();
  await rm(path.join(directory, 'another.jsonl'));
  await writeFile(filename, Buffer.alloc(4 * 1024 * 1024 + 1)); await assertUnavailable();
  const original = bytes.toString().trimEnd().split('\n').map(JSON.parse);
  for (const corrupt of [
    [...original, { ...original[1], id: 'cycle', parentId: 'cycle' }],
    [...original, original[1]],
    [...original, { ...original[1], id: 'unknown-parent', parentId: 'absent' }],
    [...original, ...Array.from({ length: 2000 }, (_, i) => ({ ...original[1], id: `extra-${i}`, parentId: null }))],
  ]) { await writeFile(filename, corrupt.map(e => JSON.stringify(e)).join('\n')+'\n'); await assertUnavailable(); }
  await writeFile(filename, bytes.toString()+'{'); await assertUnavailable();
  await rm(filename);
  const outside = path.join(dataRoot, 'private.jsonl'); await writeFile(outside, bytes);
  await symlink(outside, filename); await assertUnavailable(); await rm(filename);
  await link(outside, filename); await assertUnavailable(); await rm(filename);
  await writeFile(filename, bytes);
  await rename(directory, directory+'-real'); await symlink(directory+'-real', directory); await assertUnavailable();
  await rm(directory); await rename(directory+'-real', directory);

  // A reader must participate in the exact Runs fence, not a separate mutex.
  const blocker = await accounts.pool.connect();
  await blocker.query('BEGIN'); await blocker.query('SELECT pg_advisory_xact_lock(174923, 2)');
  let completed = false;
  const pending = service.detail(a.id, ca).then(value => { completed = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 40)); assert.equal(completed, false);
  await blocker.query('COMMIT'); blocker.release();
  assert.equal((await pending).messagesStatus, 'ready');
  await accounts.pool.query('UPDATE corilo_private.accounts SET disabled=true WHERE id=$1', [a.id]);
  await assert.rejects(service.list(a.id), e => e.status === 403);
  await assert.rejects(service.detail(a.id, ca), e => e.status === 403);
});
