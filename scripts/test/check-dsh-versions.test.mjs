import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDshVersions, packageDirectories, pinnedSourceFiles } from '../check-dsh-versions.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const reference = checkDshVersions(repository).version;
const drift = '0.0.0-test-drift';
const files = [
  ...packageDirectories.flatMap((directory) => [`${directory}/package.json`, `${directory}/package-lock.json`]),
  ...pinnedSourceFiles, 'packages/learn-anything/market/index.json',
];
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'corilo-dsh-pins-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(join(repository, file), join(root, file));
  }
  const edit = (file, mutate) => {
    const path = join(root, file);
    const value = JSON.parse(readFileSync(path, 'utf8'));
    mutate(value);
    writeFileSync(path, JSON.stringify(value));
  };
  return { root, edit, errors: () => checkDshVersions(root).errors.join('\n') };
}

test('current independent manifests, locks, source pins and market agree', () => {
  assert.deepEqual(checkDshVersions(repository).errors, []);
});

test('dependency range cannot silently replace an exact pin', (t) => {
  const f = fixture(t);
  f.edit('plugins/notes/package.json', (value) => { value.dependencies['@deepseek-ai/dsh'] = `^${reference}`; });
  assert.match(f.errors(), /plugins\/notes\/package.json dependencies.@deepseek-ai\/dsh: expected/);
});

test('stale lock root metadata is rejected even when resolution still matches', (t) => {
  const f = fixture(t);
  f.edit('plugins/todos/package-lock.json', (value) => { value.packages[''].dependencies['@deepseek-ai/dsh-tools'] = drift; });
  assert.match(f.errors(), /packages\[""\] dependencies.@deepseek-ai\/dsh-tools: expected/);
});

test('nested resolved DSH drift is rejected but unrelated nested versions are allowed', (t) => {
  const f = fixture(t);
  f.edit('packages/learn-anything/package-lock.json', (value) => {
    value.packages['node_modules/@deepseek-ai/dsh-tools/node_modules/unrelated'] = { version: '1.2.3' };
  });
  assert.equal(f.errors(), '');
  f.edit('packages/learn-anything/package-lock.json', (value) => {
    value.packages['node_modules/example/node_modules/@deepseek-ai/dsh-tools'] = { version: drift };
  });
  assert.match(f.errors(), /node_modules\/example\/node_modules\/@deepseek-ai\/dsh-tools.version: expected/);
});

test('missing resolved direct package is reported', (t) => {
  const f = fixture(t);
  f.edit('plugins/notes/package-lock.json', (value) => { delete value.packages['node_modules/@deepseek-ai/dsh']; });
  assert.match(f.errors(), /node_modules\/@deepseek-ai\/dsh.version: expected.*found undefined/);
});

test('CLI and launcher compatibility assertions cannot retain an old version', (t) => {
  const f = fixture(t);
  for (const file of ['plugins/notes/cli.mjs', 'launcher/test/cli.test.mjs']) {
    const path = join(f.root, file);
    writeFileSync(path, readFileSync(path, 'utf8').replaceAll(reference, drift));
  }
  const errors = f.errors();
  assert.match(errors, /plugins\/notes\/cli.mjs:\d+: expected/);
  assert.match(errors, /launcher\/test\/cli.test.mjs:\d+: expected/);
});

test('source pins reject tags, ranges and misspellings rather than skipping them', (t) => {
  for (const invalid of ['latest', 'next', `>=${reference}`, 'mistyped-pin']) {
    const f = fixture(t);
    for (const file of ['plugins/notes/cli.mjs', 'plugins/notes/test/upgrade.mjs']) {
      const path = join(f.root, file);
      writeFileSync(path, readFileSync(path, 'utf8').replaceAll(reference, invalid));
    }
    const errors = f.errors();
    assert.match(errors, /plugins\/notes\/cli.mjs:\d+: expected/, invalid);
    assert.match(errors, /plugins\/notes\/test\/upgrade.mjs:\d+: expected/, invalid);
  }
});

test('current market version must match; historical compatibility remains independent', (t) => {
  const f = fixture(t);
  f.edit('packages/learn-anything/market/index.json', (value) => {
    value.plugins[0].versions.push({ version: '0.0.0', engines: { dsh: '0.1.0' } });
  });
  assert.equal(f.errors(), '');
  f.edit('packages/learn-anything/market/index.json', (value) => { value.plugins[0].versions[0].engines.dsh = drift; });
  assert.match(f.errors(), /market\/index.json .* engines.dsh: expected/);
});

test('invalid reference pin and unreadable lock fail closed', (t) => {
  const f = fixture(t);
  f.edit('packages/learn-anything/package.json', (value) => { value.engines.dsh = 'latest'; });
  assert.match(f.errors(), /engines.dsh must pin an exact version/);
  const g = fixture(t);
  writeFileSync(join(g.root, 'plugins/todos/package-lock.json'), '{');
  assert.match(g.errors(), /plugins\/todos\/package-lock.json: invalid JSON/);
});
