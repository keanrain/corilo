import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { initialize, initializeDirectory, inspect, maintain } from '../cli.mjs';
import { NotesStore } from '../storage.mjs';

const exec = promisify(execFile);
const packageRoot = fileURLToPath(new URL('../', import.meta.url));

test('CLI creates a private reviewable overlay without touching notes and rejects unsafe/rebound configuration', async t => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'corilo-config-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'notes'), stateRoot = path.join(base, 'state'), configPath = path.join(base, 'notes.patch.json');
  await initialize({ root, stateRoot, configPath });
  await assert.rejects(access(root), { code: 'ENOENT' });
  await assert.rejects(access(stateRoot), { code: 'ENOENT' });
  const original = await readFile(configPath, 'utf8');
  assert.equal(JSON.parse(original)[0].insert[0].config.stateRoot, stateRoot);
  assert.equal((await inspect(configPath)).state, 'initializes-on-start');
  await assert.rejects(initialize({ root, stateRoot, configPath }), /already exists/);
  assert.equal(await readFile(configPath, 'utf8'), original);
  await assert.rejects(initialize({ root, stateRoot: path.join(root, 'state'), configPath: path.join(base, 'nested.json') }), /non-overlapping/);
  await assert.rejects(initialize({ root, stateRoot, configPath: path.join(root, 'config.json') }), /outside/);
  await assert.rejects(initialize({ root: 'relative', stateRoot, configPath }), /absolute/);
  await mkdir(root);
  await symlink(root, path.join(base, 'linked-notes'));
  await assert.rejects(initialize({ root: path.join(base, 'linked-notes'), stateRoot, configPath }), /links/);
  await mkdir(stateRoot);
  const marker = { format: 'corilo-notes-state-v1', rootId: createHash('sha256').update(root).digest('hex') };
  await writeFile(path.join(stateRoot, 'corilo-notes-state.json'), JSON.stringify(marker));
  assert.equal((await inspect(configPath)).state, 'bound');
  await writeFile(path.join(stateRoot, 'corilo-notes-state.json'), JSON.stringify({ ...marker, rootId: '0'.repeat(64) }));
  await assert.rejects(inspect(configPath), /different notes root/);
});

test('single-directory setup preserves existing configuration and maintenance preserves real notes/history', async t => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'corilo-simple-setup-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const instance = path.join(base, 'instance');
  await exec(process.execPath, [path.join(packageRoot, 'cli.mjs'), 'init', '--directory', instance]);
  const result = await inspect(path.join(instance, 'notes.patch.json'));
  assert.equal(result.root, path.join(instance, 'notes'));
  const original = await readFile(result.configPath, 'utf8');
  await assert.rejects(access(result.root), { code: 'ENOENT' });
  await assert.rejects(maintain(result.configPath), /not been initialized/);
  await assert.rejects(initializeDirectory(path.join(base, 'instance')), /already exists/);
  assert.equal(await readFile(result.configPath, 'utf8'), original);
  const store = await NotesStore.open(result.root, {}, { stateRoot: result.stateRoot });
  await store.save({ path: 'keep.md', text: 'all versions remain', expected: null });
  const before = await store.history('keep.md');
  assert.deepEqual(await maintain(result.configPath), { packed: true, historyPruned: false });
  assert.deepEqual(await store.history('keep.md'), before);
  assert.equal((await store.read('keep.md')).text, 'all versions remain');
});

test('npm tarball installs outside the checkout with production dependencies and its CLI boots published Harness', { timeout: 180000 }, async t => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'corilo-distribution-'));
  let child;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await new Promise(resolve => child.once('exit', resolve));
    }
    await rm(base, { recursive: true, force: true });
  });
  const env = { ...process.env, npm_config_cache: process.env.npm_config_cache || path.join(base, 'npm-cache') };
  const packed = await exec('npm', ['pack', '--json', '--pack-destination', base], { cwd: packageRoot, env, maxBuffer: 8 * 1024 * 1024 });
  const report = JSON.parse(packed.stdout)[0];
  const files = report.files.map(file => file.path);
  for (const file of ['cli.mjs', 'index.mjs', 'api.mjs', 'storage.mjs', 'library.mjs', 'history.mjs', 'recovery-tools.mjs', 'lib/client.js', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'QUICKSTART.zh-CN.md']) assert.ok(files.includes(file), `Missing runtime file: ${file}`);
  assert.ok(files.every(file => !/^(client\/|test\/|node_modules\/|\.env|.*\.patch\.json$)/.test(file)), 'Distribution excludes sources/tests/user configs');
  const installRoot = path.join(base, 'independent-install');
  await mkdir(installRoot);
  await writeFile(path.join(installRoot, 'package.json'), JSON.stringify({ name: 'notes-consumer', private: true }));
  await exec('npm', ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--prefer-offline', path.join(base, report.filename)], { cwd: installRoot, env, maxBuffer: 8 * 1024 * 1024, timeout: 120000 });
  const cli = path.join(installRoot, 'node_modules/@corilo/dsh-notes/cli.mjs');
  const installed = JSON.parse(await readFile(path.join(installRoot, 'node_modules/@corilo/dsh-notes/package.json'), 'utf8'));
  assert.equal(installed.dependencies['@deepseek-ai/dsh'], '0.2.2-rc.1');
  assert.equal(installed.license, 'MIT');
  await assert.rejects(access(path.join(installRoot, 'node_modules/esbuild')), { code: 'ENOENT' });
  const root = path.join(base, 'notes'), state = path.join(base, 'state'), config = path.join(base, 'notes.patch.json');
  await exec(process.execPath, [cli, 'init', '--root', root, '--state-root', state, '--config', config], { cwd: installRoot, env });
  const checked = await exec(process.execPath, [cli, 'check', '--config', config], { cwd: installRoot, env });
  assert.equal(JSON.parse(checked.stdout).harness, '0.2.2-rc.1');
  for (const directory of ['home', 'user-home', 'config']) await mkdir(path.join(base, directory));
  child = spawn(process.execPath, [cli, 'start', '--config', config, '--port', '0'], {
    cwd: installRoot, env: { ...env, HOME: path.join(base, 'user-home'), XDG_CONFIG_HOME: path.join(base, 'config'), DSH_HOME: path.join(base, 'home') }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', part => { output += part; if (output.length > 262144) child.kill('SIGKILL'); });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  let address;
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, 'Installed launcher exited before readiness');
    address = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(output)?.[1];
    if (address) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(address, 'Installed tarball did not launch the real Harness Web profile');
  assert.equal((await fetch(address)).status, 401);
  assert.equal((await fetch(address + 'api/corilo-notes/list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  // Proof that the package's host loaded and initialized its separately bound
  // recovery state, rather than merely booting an empty Harness profile.
  const marker = JSON.parse(await readFile(path.join(state, 'corilo-notes-state.json'), 'utf8'));
  assert.equal(marker.rootId, createHash('sha256').update(root).digest('hex'));
  child.kill('SIGTERM');
  const result = await Promise.race([exited, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Installed launcher did not stop')), 10000); timer.unref(); })]);
  assert.equal(result.code, 0, 'CLI forwards shutdown to Harness cleanly');
  // The packaged ripgrep optional binary must work even with install scripts
  // disabled. Search the real installed store, not a source-tree dependency.
  const proof = await exec(process.execPath, ['--input-type=module', '-e', `
    import {pathToFileURL} from 'node:url';
    const {NotesStore}=await import(pathToFileURL(process.argv[1]));
    const store=await NotesStore.open(process.argv[2],{}, {stateRoot:process.argv[3]});
    await store.capture('独立安装的蓝鲸正文');
    console.log(JSON.stringify(await store.search({query:'蓝鲸'})));
  `, path.join(installRoot, 'node_modules/@corilo/dsh-notes/storage.mjs'), root, state], { cwd: installRoot, env });
  assert.ok(JSON.parse(proof.stdout).items.some(item => item.kind === 'content' && item.text.includes('蓝鲸')));
  const compacted = await exec(process.execPath, [cli, 'maintain', '--config', config], { cwd: installRoot, env });
  assert.equal(JSON.parse(compacted.stdout).historyPruned, false);
});
