import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { access, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as launcher from '../corilo.mjs';
import * as compatibility from '../../scripts/corilo.mjs';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../corilo.mjs', import.meta.url));
const legacyCli = fileURLToPath(new URL('../../scripts/corilo.mjs', import.meta.url));
const checkout = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
async function fixture(t, { cleanup = true } = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'corilo-startup-'));
  if (cleanup) t.after(() => rm(base, { recursive: true, force: true }));
  const instance = path.join(base, "personal instance's data");
  const env = { ...process.env, HOME: path.join(base, 'user-home'), DSH_HOME: path.join(base, 'unrelated-home'), DSH_AGENTS_HOME: path.join(base, 'unrelated-agents') };
  await mkdir(env.HOME);
  const run = (command, directory = instance) => exec(process.execPath, [cli, command, '--directory', directory], { cwd: base, env });
  return { base, instance, env, run };
}

test('legacy entry forwards exports, help, errors and existing instance configuration', async t => {
  for (const name of ['initialize', 'inspect', 'start', 'main']) assert.equal(compatibility[name], launcher[name]);
  const { base, instance, env, run } = await fixture(t);
  const legacy = args => exec(process.execPath, [legacyCli, ...args], { cwd: base, env });
  assert.equal((await legacy(['--help'])).stdout, (await exec(process.execPath, [cli, '--help'], { cwd: base, env })).stdout);
  const invalid = async entry => {
    try { await exec(process.execPath, [entry, 'invalid-command'], { cwd: base, env }); }
    catch (error) { return { code: error.code, stderr: error.stderr }; }
    assert.fail('Invalid commands must fail');
  };
  assert.deepEqual(await invalid(legacyCli), await invalid(cli));
  await legacy(['init', '--directory', instance]);
  const config = await readFile(path.join(instance, 'corilo.patch.json'));
  assert.deepEqual(JSON.parse((await legacy(['check', '--directory', instance])).stdout), JSON.parse((await run('check')).stdout));
  assert.deepEqual(await readFile(path.join(instance, 'corilo.patch.json')), config);
  for (const location of ['notes', 'state', 'todos', 'runtime', 'workspace']) await assert.rejects(access(path.join(instance, location)), { code: 'ENOENT' });
});

test('one-directory setup and read-only preflight preserve data and reject altered configs or unsafe paths', async t => {
  const { base, instance, env, run } = await fixture(t);
  await run('init');
  const combined = path.join(instance, 'corilo.patch.json');
  const notes = path.join(instance, 'notes.patch.json');
  const initial = await readFile(combined), initialNotes = await readFile(notes);
  const report = JSON.parse((await run('check')).stdout);
  assert.equal(report.ok, true);
  assert.equal(report.harness, path.join(instance, 'runtime/harness'));
  assert.equal(report.agents, path.join(instance, 'runtime/agents'));
  assert.equal(report.harnessVersion, '0.2.2-rc.1');
  assert.equal(report.todosValidation, 'on-start');
  if (process.platform !== 'win32') assert.equal((await lstat(combined)).mode & 0o777, 0o600);
  for (const location of ['notes', 'state', 'todos', 'runtime', 'workspace']) await assert.rejects(access(path.join(instance, location)), { code: 'ENOENT' });
  await assert.rejects(access(env.DSH_HOME), { code: 'ENOENT' });
  await assert.rejects(run('init'), /配置已存在/);
  assert.deepEqual(await readFile(combined), initial);
  assert.deepEqual(await readFile(notes), initialNotes);
  const modified = JSON.parse(initial); modified[0].insert.push({ id: 'unexpected', name: '/unknown/code.mjs' });
  await writeFile(combined, JSON.stringify(modified));
  await assert.rejects(run('check'), /不匹配/);
  await writeFile(combined, initial);
  const changedNotes = JSON.parse(initialNotes);
  changedNotes[0].insert[0].config.root = path.join(base, 'another-notes');
  changedNotes[0].insert[0].config.stateRoot = path.join(base, 'another-state');
  await writeFile(notes, JSON.stringify(changedNotes));
  await assert.rejects(run('check'), /笔记配置路径/);
  await writeFile(notes, initialNotes);
  await mkdir(path.join(instance, 'state'));
  await writeFile(path.join(instance, 'state/corilo-notes-state.json'), JSON.stringify({ format: 'corilo-notes-state-v1', rootId: '0'.repeat(64) }));
  await assert.rejects(run('check'), /different notes root/);
  await assert.rejects(run('init', checkout), /源码仓库分开/);
  await assert.rejects(run('init', 'relative'), /绝对路径/);
  const linked = path.join(base, 'linked-instance');
  await symlink(instance, linked);
  await assert.rejects(run('init', linked), /链接/);
  const separate = path.join(base, 'other-instance'); await mkdir(separate);
  await symlink(instance, path.join(separate, 'todos'));
  await assert.rejects(run('init', separate), /链接/);
  await assert.rejects(access(path.join(separate, 'notes.patch.json')), { code: 'ENOENT' });
});

for (const entry of [cli, legacyCli]) test(`${entry === cli ? 'canonical' : 'legacy'} launcher boots both real plugin APIs, preserves home separation and forwards SIGTERM`, { timeout: 60000 }, async t => {
  const { base, instance, env, run } = await fixture(t, { cleanup: false });
  await run('init');
  let child;
  t.after(async () => {
    if (child) {
      if (process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
      else if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => child.once('exit', resolve));
    }
    await rm(base, { recursive: true, force: true });
  });
  child = spawn(process.execPath, [entry, 'start', '--directory', instance, '--port', '0'], { cwd: checkout, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', part => { output += part; if (output.length > 262144) child.kill('SIGKILL'); });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  let launch;
  for (const deadline = Date.now() + 40000; Date.now() < deadline;) {
    assert.equal(child.exitCode, null, 'Unified host exited before readiness');
    launch = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?[^\s\x1b]+)/.exec(output)?.[1];
    if (launch) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(launch, 'Unified host did not become ready');
  const origin = new URL(launch).origin;
  assert.equal((await fetch(origin)).status, 401);
  const login = await fetch(launch, { redirect: 'manual' });
  assert.ok([302, 303].includes(login.status));
  const cookie = login.headers.getSetCookie()[0]?.split(';')[0];
  assert.ok(cookie, 'Native browser authentication did not issue a cookie');
  const call = async (plugin, method, args, identity) => {
    const response = await fetch(`${origin}/api/corilo-${plugin}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie, ...(identity ? { [plugin === 'notes' ? 'x-corilo-library-id' : 'x-corilo-todos-id']: identity } : {}) }, body: JSON.stringify(args) });
    assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.ok, true); return result.value;
  };
  const notesIdentity = await call('notes', 'identity', {});
  const todoIdentity = await call('todos', 'identity', {});
  const saved = await call('notes', 'capture', { text: '统一入口保存的虚构笔记' }, notesIdentity.id);
  assert.equal((await call('notes', 'read', { path: saved.path }, notesIdentity.id)).text, '统一入口保存的虚构笔记');
  const created = await call('todos', 'create', { requestId: randomUUID(), title: '统一入口的个人待办' }, todoIdentity.id);
  const done = await call('todos', 'update', { requestId: randomUUID(), id: created.id, expected: created.version, patch: { status: 'done' } }, todoIdentity.id);
  assert.equal(done.status, 'done');
  assert.equal((await call('todos', 'list', { status: 'all' }, todoIdentity.id)).items.length, 1);
  assert.equal((await fetch(origin + '/api/corilo-todos/identity', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  child.kill('SIGTERM');
  const result = await Promise.race([exited, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Unified host did not stop')), 15000); timer.unref(); })]);
  assert.equal(result.code, 0);
  await assert.rejects(fetch(origin));
  assert.equal(await readFile(path.join(instance, 'notes', saved.path), 'utf8'), '统一入口保存的虚构笔记');
  await access(path.join(instance, 'todos/todos.sqlite'));
  await access(path.join(instance, 'runtime/harness/.credentials.yaml'));
  await assert.rejects(access(env.DSH_HOME), { code: 'ENOENT' });
  assert.equal(JSON.parse((await run('check')).stdout).noteState, 'bound');
});
