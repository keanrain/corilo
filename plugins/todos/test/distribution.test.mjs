import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const packageRoot = fileURLToPath(new URL('../', import.meta.url));

test('standalone todo tarball installs production dependencies and boots real Harness outside checkout', { timeout: 180000 }, async t => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'corilo-todos-package-'));
  let child;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL'); await new Promise(resolve => child.once('exit', resolve));
    }
    await rm(base, { recursive: true, force: true });
  });
  const env = { ...process.env, npm_config_cache: process.env.npm_config_cache || path.join(base, 'cache'), HOME: path.join(base, 'user'), DSH_HOME: path.join(base, 'harness'), DSH_AGENTS_HOME: path.join(base, 'agents'), XDG_CONFIG_HOME: path.join(base, 'config') };
  await mkdir(env.HOME);
  const packed = JSON.parse((await exec('npm', ['pack', '--json', '--pack-destination', base], { cwd: packageRoot, env, maxBuffer: 8 * 1024 * 1024 })).stdout)[0];
  const files = packed.files.map(file => file.path);
  for (const file of ['index.mjs', 'api.mjs', 'core.mjs', 'storage.mjs', 'lib/client.js', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'todos.patch.example.yml']) assert.ok(files.includes(file), `Missing ${file}`);
  assert.ok(files.every(file => !/^(client\/|test\/|node_modules\/|.*\.sqlite|.*\.patch\.json$)/.test(file)));
  const install = path.join(base, 'install'); await mkdir(install);
  await writeFile(path.join(install, 'package.json'), JSON.stringify({ name: 'todos-consumer', private: true }));
  await exec('npm', ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--prefer-offline', path.join(base, packed.filename)], { cwd: install, env, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  await assert.rejects(access(path.join(install, 'node_modules/esbuild')), { code: 'ENOENT' });
  const plugin = path.join(install, 'node_modules/@corilo/dsh-todos');
  const manifest = JSON.parse(await readFile(path.join(plugin, 'package.json'), 'utf8'));
  assert.equal(manifest.dependencies['@deepseek-ai/dsh'], '0.2.2-rc.1');
  const data = path.join(base, 'todos');
  const proof = await exec(process.execPath, ['--input-type=module', '-e', `
    import {pathToFileURL} from 'node:url';
    import {randomUUID} from 'node:crypto';
    const {TodoStore}=await import(pathToFileURL(process.argv[1]));
    const store=await TodoStore.open(process.argv[2]);
    const item=await store.create({requestId:randomUUID(), title:'独立安装的个人待办', body:'非Agent执行计划'});
    const exported=await store.export();
    console.log(JSON.stringify({id:item.id, format:exported.format, count:exported.items.length}));
    store.close();
  `, path.join(plugin, 'storage.mjs'), data], { cwd: install, env });
  assert.equal(JSON.parse(proof.stdout).count, 1);
  assert.equal(JSON.parse(proof.stdout).format, 'corilo-todos-v1');
  const patch = path.join(base, 'todos.patch.json');
  await writeFile(patch, JSON.stringify([{ insert: [{ id: 'corilo-todos', name: path.join(plugin, 'index.mjs'), config: { root: data } }] }]));
  const entry = path.join(install, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
  child = spawn(process.execPath, [entry, 'web', '--patch', patch, '--no-open', '--port', '0'], { cwd: base, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', part => { output += part; if (output.length > 262144) child.kill('SIGKILL'); });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  let address; const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, 'Harness exited before readiness');
    address = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(output)?.[1];
    if (address) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(address, 'Installed plugin failed to boot Harness');
  assert.equal((await fetch(address)).status, 401);
  assert.equal((await fetch(address + 'api/corilo-todos/list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  child.kill('SIGTERM');
  const result = await Promise.race([exited, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Harness did not exit')), 10000); timer.unref(); })]);
  assert.equal(result.code, 0);
});
