import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, access, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));

test('deployment preflight reports native homes without creating them and rejects data/config overlap', async t => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'corilo-deploy-check-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const instance = path.join(base, 'instance'), config = path.join(instance, 'notes.patch.json');
  const env = { ...process.env, DSH_HOME: path.join(base, 'private-harness'), DSH_AGENTS_HOME: path.join(base, 'private-agents') };
  const run = (args, overrides = {}) => exec(process.execPath, [cli, ...args], { cwd: base, env: { ...env, ...overrides } });
  await run(['init', '--directory', instance]);
  const before = await readFile(config);
  const withoutGit = JSON.parse((await run(['check', '--config', config], { PATH: path.join(base, 'no-executables') })).stdout);
  assert.equal(withoutGit.state, 'disabled', 'core notes preflight needs no Git binary');
  const report = JSON.parse((await run(['check', '--config', config])).stdout);
  assert.equal(report.harnessHome, env.DSH_HOME);
  assert.equal(report.agentsHome, env.DSH_AGENTS_HOME);
  assert.equal(report.workingDirectory, base);
  assert.equal(report.state, 'disabled');
  for (const directory of [env.DSH_HOME, env.DSH_AGENTS_HOME, path.join(instance, 'notes'), path.join(instance, 'state')]) {
    await assert.rejects(access(directory), { code: 'ENOENT' });
  }
  for (const overrides of [
    { DSH_HOME: path.join(instance, 'notes', 'host') },
    { DSH_HOME: instance },
    { DSH_AGENTS_HOME: instance },
  ]) {
    await assert.rejects(run(['check', '--config', config], overrides), /must be separate/);
    await assert.rejects(run(['start', '--config', config], overrides), /must be separate/);
  }
  await mkdir(path.join(instance, 'notes'));
  const linked = path.join(base, 'linked-agents');
  await symlink(path.join(instance, 'notes'), linked);
  await assert.rejects(run(['check', '--config', config], { DSH_AGENTS_HOME: linked }), /must be separate/);
  await assert.rejects(run(['check', '--config', config], { DSH_HOME: linked }), /must be separate/);
  await mkdir(env.DSH_HOME);
  const homeAlias = path.join(base, 'home-alias');
  await symlink(env.DSH_HOME, homeAlias);
  const aliased = JSON.parse((await run(['check', '--config', config], { DSH_HOME: homeAlias })).stdout);
  assert.equal(aliased.harnessHome, env.DSH_HOME, 'native home aliases retain compatibility after physical overlap checks');
  assert.deepEqual(await readFile(config), before);
});
