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
import { RunModelOutlet } from '../cloud/run-model-outlet.mjs';
import { DockerEngine, DockerWorkers } from '../cloud/docker-workers.mjs';
import { ExecutionController } from '../cloud/execution-controller.mjs';
import { startHost } from '../host/server.mjs';

if (!process.env.CORILO_TEST_DATABASE_URL || !process.env.CORILO_TEST_WORKER_IMAGE)
  throw new Error('Disposable PostgreSQL and immutable worker image required');

const waitFor = async (promise, label) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), 30000); })]); }
  finally { clearTimeout(timer); }
};
const unixPost = (socketPath, token, body) => new Promise((resolve, reject) => {
  const request = http.request({ socketPath, path: '/v1/chat/completions', method: 'POST', headers: {
    'Content-Type': 'application/json', Authorization: 'Bearer ' + token,
  } }, response => {
    response.resume(); response.once('end', () => resolve(response.statusCode)); response.once('error', reject);
  });
  request.once('error', reject); request.setTimeout(2000, () => request.destroy(new Error('Socket request timed out')));
  request.end(JSON.stringify(body));
});
async function textFiles(root) {
  let text = '';
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const filename = path.join(root, entry.name);
    if (entry.isDirectory()) text += await textFiles(filename);
    else if (entry.isFile()) text += await fs.readFile(filename, 'utf8');
  }
  return text;
}

test('production Docker Pi worker uses per-run Unix model outlet without general network and revokes on stop', { timeout: 120000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corilo-wm-'));
  const accounts = new Accounts(process.env.CORILO_TEST_DATABASE_URL);
  const runs = new Runs(accounts.pool, { maxRunning: 2, maxQueued: 4, leaseSeconds: 60, maxRunSeconds: 180 });
  const grants = new ModelGrants(accounts.pool), bindings = new Map(), allRuns = [];
  const secret = 'synthetic-platform-' + randomUUID();
  const seen = [], upstreamErrors = [], engineErrors = [], exitStates = [];
  let mode = 'write', signalStarted, signalClosed;
  const streamStarted = new Promise(resolve => { signalStarted = resolve; });
  const streamClosed = new Promise(resolve => { signalClosed = resolve; });
  const upstream = http.createServer(async (request, response) => {
    try {
      assert.equal(request.url, '/chat/completions');
      assert.equal(request.headers.authorization, 'Bearer ' + secret);
      const parts = []; for await (const part of request) parts.push(part);
      const body = JSON.parse(Buffer.concat(parts)); seen.push(body);
      assert.equal(body.model, 'deepseek-flash'); assert.equal(body.max_tokens, 1024);
      assert.equal(body.stream, true);
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const emit = (delta, finish_reason = null) => response.write('data: ' + JSON.stringify({
        id: 'synthetic-container', object: 'chat.completion.chunk', model: body.model,
        choices: [{ index: 0, delta, finish_reason }],
      }) + '\n\n');
      if (mode === 'hold') {
        response.once('close', signalClosed);
        emit({ role: 'assistant', content: 'Synthetic stream waiting for stop.' }); signalStarted(); return;
      }
      if (seen.length === 1) {
        assert.ok(body.tools.some(tool => tool.function?.name === 'write'));
        const args = JSON.stringify({ path: 'from-container.md', content: 'Written by production Pi inside Docker.\n' });
        emit({ role: 'assistant', reasoning_content: 'Synthetic tool planning.' });
        emit({ tool_calls: [{ index: 0, id: 'container_write', type: 'function', function: { name: 'write', arguments: args.slice(0, 25) } }] });
        emit({ tool_calls: [{ index: 0, function: { arguments: args.slice(25) } }] });
        emit({ tool_calls: [{ index: 1, id: 'container_boundary', type: 'function', function: { name: 'bash', arguments: JSON.stringify({command: 'test ! -e /pi/auth.json && test ! -e /pi/models.json && test ! -e /var/run/docker.sock && test "$(ls /sys/class/net)" = lo && printf boundary-ok'}) } }] });
        emit({}, 'tool_calls');
      } else {
        assert.equal(seen.length, 2, 'exactly two model calls for write and reply');
        assert.ok(body.messages.some(message => message.role === 'tool' && message.tool_call_id === 'container_write'));
        assert.ok(body.messages.some(message => message.role === 'tool' && message.tool_call_id === 'container_boundary' && JSON.stringify(message.content).includes('boundary-ok')));
        emit({ role: 'assistant', content: 'Saved from-container.md.' }); emit({}, 'stop');
      }
      response.end('data: [DONE]\n\n');
    } catch (error) {
      upstreamErrors.push(error); if (!response.headersSent) response.writeHead(500); response.end();
    }
  });
  let host, controller, outlet, peerClaim;
  const engine = new DockerEngine();
  const inspectedEngine = { request: async (method, route, data) => {
    if (route.startsWith('/containers/create')) {
      assert.equal(data.Entrypoint, undefined, 'uses image production entrypoint');
      assert.equal(data.HostConfig.NetworkMode, 'none');
      assert.equal(data.HostConfig.ReadonlyRootfs, true);
      const socket = data.HostConfig.Mounts.filter(mount => mount.Target === '/run/corilo/model.sock');
      assert.equal(socket.length, 1); assert.equal(socket[0].ReadOnly, true);
      assert.ok(!data.HostConfig.Mounts.some(mount => mount.Target === '/pi'), 'model runs do not mount unrelated native credentials');
      assert.ok(!JSON.stringify(data).includes(secret));
    }
    try {
      const result=await engine.request(method, route, data);
      if(route.endsWith('/json') && result?.State && !result.State.Running)exitStates.push({exitCode:result.State.ExitCode,oom:result.State.OOMKilled,error:result.State.Error});
      return result;
    } catch(error) { engineErrors.push({method,route,status:error.status,message:error.message});throw error; }
  } };
  const workers = new DockerWorkers({ engine: inspectedEngine, image: process.env.CORILO_TEST_WORKER_IMAGE,
    dataRoot: root, journalRoot: path.join(root, 'control'), uid: process.getuid(), gid: process.getgid(),
    memoryMiB: 512, cpuMillis: 1000, pids: 64, tmpMiB: 32 });
  t.after(async () => {
    await controller?.close();
    for (const id of allRuns) await workers.stop(id).catch(() => {});
    if (peerClaim) { await grants.revokeRun(peerClaim.id); await runs.finish(peerClaim.id, peerClaim.token, 'stopped').catch(() => {}); }
    await outlet?.close(); await host?.close();
    upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
    await accounts.close(); await fs.rm(root, { recursive: true, force: true });
  });
  await accounts.migrate();
  const createOwner = async () => {
    const email = randomUUID() + '@example.test';
    return accounts.session(await accounts.login({ subject: randomUUID(), email }, await accounts.invite(email)));
  };
  const owner = await createOwner(), conversationId = await runs.conversation(owner.id);
  const base = path.join(root, owner.vault_id), state = path.join(base, 'state/conversations', conversationId);
  await fs.mkdir(state, { recursive: true });
  host = await startHost({ mode: 'cloud-files', vault: path.join(base, 'knowledge'), configDir: path.join(base, 'state'), piAgentDir: path.join(base, 'pi') });
  const settings = JSON.stringify({ defaultThinkingLevel: 'off', cacheWarming: 'off' });
  await fs.writeFile(path.join(base, 'pi/settings.json'), settings);
  await fs.writeFile(path.join(base, 'pi/auth.json'), JSON.stringify({ unrelated: {type:'api_key',key:'synthetic-unrelated-credential'} }));
  await fs.writeFile(path.join(base, 'pi/models.json'), JSON.stringify({providers:{}}));
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  outlet = new RunModelOutlet({ grants, socketRoot: path.join(root, 'outlets'),
    limits: { model: 'deepseek-flash', maxRequests: 3, maxOutputTokens: 3072, maxTokensPerRequest: 1024, ttlSeconds: 120 },
    relayOptions: { apiKey: secret, allowedModels: ['deepseek-flash'], upstreamUrl: `http://127.0.0.1:${upstream.address().port}/chat/completions`,
      maxRequestBytes: 1024 * 1024, maxResponseBytes: 1024 * 1024, maxDurationMs: 60000, maxConcurrent: 2, checkIntervalMs: 30 } });
  const capturedOutlet = {
    prepare: async claim => { const binding = await outlet.prepare(claim); bindings.set(claim.id, binding); return binding; },
    revoke: id => outlet.revoke(id), close: () => outlet.close(),
  };
  controller = new ExecutionController({ runs, workers, hostFor: async () => host, modelOutlet: capturedOutlet, pollMs: 30 });
  await controller.init();
  const normal = await runs.submit(owner.id, { conversationId, key: 'model-write', prompt: 'Save a synthetic note.' }); allRuns.push(normal.id);
  assert.equal((await controller.executeNext()).state, 'completed', JSON.stringify({upstream:upstreamErrors.map(error => error.message),engineErrors,exitStates,calls:seen.length}));
  assert.deepEqual(upstreamErrors, []); assert.equal(seen.length, 2);
  assert.ok(!JSON.stringify(seen).includes(bindings.get(normal.id).token), 'task token absent from provider payload');
  assert.equal(await fs.readFile(path.join(base, 'knowledge/from-container.md'), 'utf8'), 'Written by production Pi inside Docker.\n');
  const reservation = (await accounts.pool.query('SELECT reserved_requests,reserved_output_tokens,revoked_at FROM corilo_private.model_grants WHERE run_id=$1', [normal.id])).rows[0];
  assert.equal(reservation.reserved_requests, 2); assert.equal(Number(reservation.reserved_output_tokens), 2048); assert.ok(reservation.revoked_at);
  assert.equal((await workers.status(normal.id)).present, false); assert.equal(host.activeRunId(), null);
  await assert.rejects(grants.assertActive(bindings.get(normal.id).token), error => error.status === 401);
  assert.ok(!(await textFiles(base)).includes(secret), 'platform secret absent from knowledge, Pi configuration and persisted sessions');
  assert.ok(!(await textFiles(state)).includes(bindings.get(normal.id).token), 'ordinary Pi session does not persist the task credential');
  assert.equal(await fs.readFile(path.join(base, 'pi/settings.json'), 'utf8'), settings, 'source Pi settings unchanged');
  await assert.rejects(fs.stat(path.join(root, 'control', normal.id, 'request.json')), { code: 'ENOENT' });

  // A second user's valid grant cannot be used through the first run's socket.
  const peer = await createOwner(), peerConversation = await runs.conversation(peer.id);
  await runs.submit(peer.id, { conversationId: peerConversation, key: 'peer', prompt: 'synthetic peer' });
  peerClaim = await runs.claim();
  const peerGrant = await grants.issue(peerClaim, { model: 'deepseek-flash', maxRequests: 1, maxOutputTokens: 1024, maxTokensPerRequest: 1024, ttlSeconds: 120 });
  mode = 'hold';
  const held = await runs.submit(owner.id, { conversationId, key: 'model-stop', prompt: 'Wait until stopped.' }); allRuns.push(held.id);
  const task = controller.executeNext();
  await waitFor(streamStarted, 'container did not reach model stream');
  const current = bindings.get(held.id);
  assert.equal(await unixPost(current.socketPath, peerGrant.token, { model: 'deepseek-flash', messages: [{ role: 'user', content: 'wrong run' }], stream: true, max_tokens: 1 }), 401);
  assert.equal(Number((await accounts.pool.query('SELECT reserved_requests FROM corilo_private.model_grants WHERE run_id=$1', [peerClaim.id])).rows[0].reserved_requests), 0);
  assert.equal(seen.length, 3, 'cross-run token rejected before upstream');
  const requestText = await fs.readFile(path.join(root, 'control', held.id, 'request.json'), 'utf8');
  assert.ok(!requestText.includes(secret)); assert.ok(requestText.includes(current.token));
  const capture = await fetch(host.origin + '/api/capture', { method: 'POST', headers: { 'X-Corilo-Token': host.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'must remain blocked' }) });
  assert.equal(capture.status, 409);
  await runs.stop(owner.id, held.id);
  assert.equal((await waitFor(task, 'worker did not stop')).state, 'stopped');
  await waitFor(streamClosed, 'upstream stream not aborted');
  assert.equal((await workers.status(held.id)).present, false); assert.equal(host.activeRunId(), null);
  await assert.rejects(grants.assertActive(current.token), error => error.status === 401);
  assert.ok(!(await textFiles(base)).includes(secret)); assert.deepEqual(upstreamErrors, []);
});
