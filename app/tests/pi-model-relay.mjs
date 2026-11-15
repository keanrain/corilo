import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Accounts } from '../cloud/accounts.mjs';
import { Runs } from '../cloud/runs.mjs';
import { ModelGrants } from '../cloud/model-grants.mjs';
import { startModelRelay } from '../cloud/model-relay.mjs';
import { PiAgent } from '../host/agent.mjs';

if (!process.env.CORILO_TEST_DATABASE_URL) throw new Error('Disposable PostgreSQL required');

test('actual Pi native configuration and default write tool through scoped relay with synthetic SSE upstream', { timeout: 45000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corilo-pi-relay-'));
  const accounts = new Accounts(process.env.CORILO_TEST_DATABASE_URL);
  const runs = new Runs(accounts.pool, { maxRunning: 1, maxQueued: 2, leaseSeconds: 60, maxRunSeconds: 120 });
  const grants = new ModelGrants(accounts.pool);
  let relay, agent, claim;
  const seen = [];
  const upstreamErrors = [];
  const upstream = http.createServer(async (req, res) => {
    try {
      assert.equal(req.url, '/chat/completions');
      assert.equal(req.headers.authorization, 'Bearer synthetic-platform-secret');
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks)); seen.push(body);
      assert.equal(body.model, 'deepseek-flash');
      assert.equal(body.stream, true);
      assert.equal(body.max_tokens, 1024);
      assert.deepEqual(body.stream_options, { include_usage: true });
      assert.ok(body.tools.some(tool => tool.function?.name === 'write'));
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const emit = (delta, finish_reason = null) => res.write('data: ' + JSON.stringify({
        id: 'synthetic-completion', object: 'chat.completion.chunk', created: 1, model: body.model,
        choices: [{ index: 0, delta, finish_reason }],
      }) + '\n\n');
      if (seen.length === 1) {
        emit({ role: 'assistant', reasoning_content: 'Synthetic planning.' });
        const args = JSON.stringify({ path: 'from-agent.md', content: 'Written by the actual default Pi tool.\n' });
        emit({ tool_calls: [{ index: 0, id: 'call_write_1', type: 'function', function: { name: 'write', arguments: args.slice(0, 30) } }] });
        emit({ tool_calls: [{ index: 0, function: { arguments: args.slice(30) } }] });
        emit({}, 'tool_calls');
      } else {
        assert.equal(seen.length, 2, 'no unexpected retry or extra model call');
        assert.ok(body.messages.some(message => message.role === 'tool' && message.tool_call_id === 'call_write_1'));
        assert.ok(body.messages.some(message => message.role === 'assistant' && message.reasoning_content === 'Synthetic planning.'));
        assert.equal(await fs.readFile(path.join(root, 'knowledge/from-agent.md'), 'utf8'), 'Written by the actual default Pi tool.\n');
        emit({ role: 'assistant', content: 'Saved from-agent.md.' }); emit({}, 'stop');
      }
      res.write('data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 32, completion_tokens: 16, total_tokens: 48 } }) + '\n\n');
      res.end('data: [DONE]\n\n');
    } catch (error) {
      upstreamErrors.push(error);
      if (!res.headersSent) res.writeHead(500); res.end();
    }
  });
  t.after(async () => {
    await agent?.close();
    if (claim) { await grants.revokeRun(claim.id); await runs.finish(claim.id, claim.token, 'completed').catch(() => {}); }
    await relay?.close();
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
    await accounts.close(); await fs.rm(root, { recursive: true, force: true });
  });
  await accounts.migrate();
  const email = randomUUID() + '@example.test';
  const owner = await accounts.session(await accounts.login({ subject: randomUUID(), email }, await accounts.invite(email)));
  const conversationId = await runs.conversation(owner.id);
  await runs.submit(owner.id, { conversationId, key: 'pi-relay', prompt: 'Save a synthetic note.' });
  claim = await runs.claim();
  const grant = await grants.issue(claim, { model: 'deepseek-flash', maxRequests: 2, maxOutputTokens: 2048, maxTokensPerRequest: 1024, ttlSeconds: 60 });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  relay = await startModelRelay({ grants, allowedModels: ['deepseek-flash'], apiKey: 'synthetic-platform-secret', upstreamUrl: `http://127.0.0.1:${upstream.address().port}/chat/completions`,
    maxRequestBytes: 1024 * 1024, maxResponseBytes: 1024 * 1024, maxDurationMs: 10000, maxConcurrent: 2, checkIntervalMs: 50 });
  const knowledge = path.join(root, 'knowledge'), config = path.join(root, 'pi');
  await fs.mkdir(knowledge); await fs.mkdir(config);
  // These are Pi's standard files; the only exposed credential is this run's grant.
  await fs.writeFile(path.join(config, 'settings.json'), JSON.stringify({ defaultProvider: 'deepseek', defaultModel: 'deepseek-flash', defaultThinkingLevel: 'off', cacheWarming: 'off' }));
  await fs.writeFile(path.join(config, 'auth.json'), JSON.stringify({ deepseek: { type: 'api_key', key: grant.token } }), { mode: 0o600 });
  await fs.writeFile(path.join(config, 'models.json'), JSON.stringify({ providers: { deepseek: { baseUrl: relay.origin + '/v1', modelOverrides: { 'deepseek-flash': { maxTokens: 1024 } } } } }));
  agent = new PiAgent({ root: knowledge }, path.join(root, 'state'), config);
  await agent.init(); await agent.prompt('Save a synthetic note.');
  assert.deepEqual(upstreamErrors, []);
  assert.equal(seen.length, 2);
  assert.ok(agent.messages().some(message => message.role === 'assistant' && message.text === 'Saved from-agent.md.'));
  const usage = (await accounts.pool.query('SELECT reserved_requests,reserved_output_tokens FROM corilo_private.model_grants WHERE run_id=$1', [claim.id])).rows[0];
  assert.equal(usage.reserved_requests, 2); assert.equal(Number(usage.reserved_output_tokens), 2048);
  await assert.rejects(grants.reserve(grant.token, { model: 'deepseek-flash', maxTokens: 1 }), error => error.status === 429);
  assert.ok(!JSON.stringify(seen).includes(grant.token), 'grant does not leak into provider request body');
});
