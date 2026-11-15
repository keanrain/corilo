#!/usr/bin/env node
// Read-only compatibility gate. The tutor manifest is the existing shared pin;
// each product still owns its manifest and independent npm lockfile.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageDirectories = ['plugins/notes', 'plugins/todos', 'packages/learn-anything'];
// Register new source files containing fixed DSH pins here; this is deliberately
// an explicit list, not a scan of historical docs, fixtures or vendored code.
export const pinnedSourceFiles = [
  'plugins/notes/cli.mjs',
  'launcher/test/cli.test.mjs',
  'plugins/notes/test/distribution.test.mjs',
  'plugins/notes/test/upgrade.mjs',
  'plugins/todos/test/distribution.test.mjs',
];
const groups = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const isDsh = (name) => /^@deepseek-ai\/dsh(?:-|$)/.test(name);
const exactVersion = /^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/;
const dshEntries = (object = {}) => Object.entries(object).filter(([name]) => isDsh(name));

export function checkDshVersions(root) {
  const errors = [];
  const read = (path) => {
    try { return readFileSync(resolve(root, path), 'utf8'); }
    catch (error) { errors.push(`${path}: ${error.code ?? error.message}`); }
  };
  const json = (path) => {
    const text = read(path);
    if (text === undefined) return;
    try { return JSON.parse(text); }
    catch { errors.push(`${path}: invalid JSON`); }
  };
  const tutor = json('packages/learn-anything/package.json');
  const version = tutor?.engines?.dsh;
  if (typeof version !== 'string' || !exactVersion.test(version)) {
    errors.push('packages/learn-anything/package.json: engines.dsh must pin an exact version');
    return { version, errors };
  }
  const compare = (actual, location) => {
    if (actual !== version) errors.push(`${location}: expected ${version}, found ${JSON.stringify(actual)}`);
  };
  for (const directory of packageDirectories) {
    const manifestPath = `${directory}/package.json`;
    const lockPath = `${directory}/package-lock.json`;
    const manifest = directory === 'packages/learn-anything' ? tutor : json(manifestPath);
    const lock = json(lockPath);
    if (!manifest || !lock) continue;
    const lockRoot = lock.packages?.[''];
    if (!lockRoot) { errors.push(`${lockPath}: missing packages[""] metadata`); continue; }
    for (const group of groups) {
      for (const [name, pin] of dshEntries(manifest[group])) {
        compare(pin, `${manifestPath} ${group}.${name}`);
        compare(lockRoot[group]?.[name], `${lockPath} packages[""] ${group}.${name}`);
        compare(lock.packages?.[`node_modules/${name}`]?.version, `${lockPath} node_modules/${name}.version`);
      }
      for (const [name] of dshEntries(lockRoot[group])) {
        if (!(name in (manifest[group] ?? {}))) errors.push(`${lockPath}: stale ${group}.${name} missing from manifest`);
      }
    }
    if (manifest.engines?.dsh !== undefined) {
      compare(manifest.engines.dsh, `${manifestPath} engines.dsh`);
      compare(lockRoot.engines?.dsh, `${lockPath} packages[""] engines.dsh`);
    }
    // Match the leaf package, not a nested unrelated dependency under a DSH path.
    for (const [path, entry] of Object.entries(lock.packages ?? {})) {
      const name = /(?:^|\/)node_modules\/(@deepseek-ai\/[^/]+)$/.exec(path)?.[1];
      if (name && isDsh(name)) compare(entry.version, `${lockPath} ${path}.version`);
    }
  }
  for (const file of pinnedSourceFiles) {
    const source = read(file);
    if (source === undefined) continue;
    for (const [index, line] of source.split('\n').entries()) {
      if (!/dsh|harness/i.test(line)) continue;
      // Read the pin positions, not only semver-shaped strings: tags/ranges and
      // typos must fail too. Dynamic references elsewhere need no duplicate pin.
      for (const match of line.matchAll(/@deepseek-ai\/dsh@([^'"`\s]+)/g)) {
        compare(match[1], `${file}:${index + 1}`);
      }
      const literal = /(?:\bpinnedHarness\s*=\s*|\b(?:harness|harnessVersion)\s*:\s*|\.(?:harness|harnessVersion)\s*,\s*|\[['"]@deepseek-ai\/dsh['"]\]\s*,\s*|\.version\s*,\s*)(['"`])([^'"`]+)\1/g;
      for (const match of line.matchAll(literal)) compare(match[2], `${file}:${index + 1}`);
    }
  }
  const marketPath = 'packages/learn-anything/market/index.json';
  const market = json(marketPath);
  if (market) {
    const entries = market.plugins?.find((plugin) => plugin.name === tutor.name)?.versions ?? [];
    const current = entries.filter((entry) => entry.version === tutor.version);
    if (current.length !== 1) errors.push(`${marketPath}: expected one entry for ${tutor.name}@${tutor.version}`);
    for (const entry of current) compare(entry.engines?.dsh, `${marketPath} ${tutor.version} engines.dsh`);
    // Historical releases legitimately retain their original compatibility pin.
  }
  return { version, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { version, errors } = checkDshVersions(root);
  if (errors.length) {
    console.error(`DSH compatibility check failed:\n${errors.map((error) => `- ${error}`).join('\n')}`);
    process.exitCode = 1;
  } else console.log(`DSH compatibility pins match ${version} across three packages, locks, CLI/tests and the current market entry.`);
}
