// Explicit local tarballs; disposable real DSH, synthetic notes, no model calls.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
const exec = promisify(execFile);
const archives = process.argv.slice(2).map(value => path.resolve(value));
assert.equal(archives.length, 2, 'Usage: node test/upgrade.mjs previous.tgz next.tgz');
for (const archive of archives) await readFile(archive);
const base = await mkdtemp(path.join(os.tmpdir(), 'corilo-dsh-upgrade-'));
const install = path.join(base, 'install'), root = path.join(base, 'notes');
const env = { ...process.env, DSH_HOME: path.join(base, 'harness'), DSH_AGENTS_HOME: path.join(base, 'agents'), XDG_CONFIG_HOME: path.join(base, 'config') };
const hash = value => createHash('sha256').update(value).digest('hex');
let child;
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
  child.kill('SIGTERM');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
  try { assert.equal(await exited, 0, 'Native DSH shuts down cleanly'); } finally { clearTimeout(timeout); }
}
async function start(config) {
  child = spawn(process.execPath, [path.join(install, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', ...(config ? ['--patch', config] : []), '--no-open', '--port', '0'], { cwd: install, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output += data; if (output.length > 262144) child.kill('SIGKILL'); });
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, 'Native DSH exited before readiness: ' + output.replace(/https?:\/\/[^\s]+/g, '[address omitted]'));
    const launch = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?[^\s\x1b]+)/.exec(output)?.[1];
    if (launch) {
      const origin = new URL(launch).origin;
      assert.equal((await fetch(origin)).status, 401);
      const response = await fetch(launch, { redirect: 'manual' });
      const cookie = response.headers.getSetCookie()[0]?.split(';')[0]; assert.ok(cookie);
      return { origin, cookie };
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Native DSH readiness timed out');
}
try {
  await mkdir(install); await mkdir(root);
  await writeFile(path.join(root, 'Existing.md'), '已有清单\n- [ ] 保留资料\n');
  await writeFile(path.join(install, 'package.json'), JSON.stringify({ name: 'corilo-upgrade-consumer', private: true }));
  const npm = args => exec('npm', [...args, '--save-exact', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--prefer-offline'], { cwd: install, env, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  await npm(['install', '@deepseek-ai/dsh@0.2.2-rc.1']);
  await start(); await stop(); // Real independent DSH boots before Corilo is installed.
  const config = path.join(base, 'notes.patch.json'), entry = path.join(install, 'node_modules/@corilo/dsh-notes');
  const evidence = []; let configBytes;
  for (const [index, archive] of archives.entries()) {
    await npm(['install', archive]);
    assert.equal(JSON.parse(await readFile(path.join(install, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8')).version, '0.2.2-rc.1', 'Plugin installation must not upgrade the host');
    if (index === 0) {
      await exec(process.execPath, [path.join(entry, 'cli.mjs'), 'init', '--root', root, '--config', config], { cwd: install, env });
      configBytes = await readFile(config, 'utf8');
    }
    assert.equal(await readFile(config, 'utf8'), configBytes, 'Upgrade preserves overlay');
    const { origin, cookie } = await start(config);
    const request = async (route, body, extra = {}) => {
      const response = await fetch(origin + '/api/corilo-notes/' + route, { method: 'POST', headers: { cookie, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });
      assert.equal(response.status, 200);
      const result = await response.json(); assert.equal(result.ok, true); return result.value;
    };
    const identity = await request('identity', {}); assert.equal(identity.interface, 'filesmd');
    const headers = { 'x-corilo-workspace-id': identity.workspaceId };
    const original = await request('workspace/fs', { method: 'read', path: 'Existing.md' }, headers);
    assert.equal(Buffer.from(original.data, 'base64').toString(), '已有清单\n- [ ] 保留资料\n');
    const asset = await fetch(origin + '/api/corilo-notes/workspace/host.js', { headers: { cookie } });
    assert.equal(asset.status, 200); assert.equal(asset.headers.get('cache-control'), 'no-store');
    const served = await asset.text();
    assert.equal(served, await readFile(path.join(entry, 'workspace/host.js'), 'utf8'), 'Restart serves the installed assets');
    if (index === 0) {
      const created = await request('workspace/fs', { method: 'create', path: 'Upgrade.md', kind: 'file' }, headers);
      await request('workspace/fs', { method: 'write', path: 'Upgrade.md', data: Buffer.from('升级前通过旧包写入').toString('base64'), expected: created.version }, headers);
    } else {
      const retained = await request('workspace/fs', { method: 'read', path: 'Upgrade.md' }, headers);
      assert.equal(Buffer.from(retained.data, 'base64').toString(), '升级前通过旧包写入');
    }
    const pkg = JSON.parse(await readFile(path.join(entry, 'package.json'), 'utf8'));
    evidence.push({ version: pkg.version, archiveSha256: hash(await readFile(archive)), hostSha256: hash(served) });
    await stop();
  }
  assert.notEqual(evidence[0].hostSha256, evidence[1].hostSha256, 'Use distinct builds to prove assets changed');
  console.log(JSON.stringify({ harness: '0.2.2-rc.1', independentHostBoot: true, upgradeRestart: true, overlayPreserved: true, notesPreserved: true, assets: evidence, modelCalls: 0 }, null, 2));
} finally {
  await stop(); await rm(base, { recursive: true, force: true });
}
