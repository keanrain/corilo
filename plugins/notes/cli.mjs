#!/usr/bin/env node
import path from 'node:path';
import { constants } from 'node:fs';
import { access, lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';

const packageRoot = fileURLToPath(new URL('./', import.meta.url));
const require = createRequire(import.meta.url);
const pinnedHarness = '0.2.2-rc.1';
const fail = message => { throw new Error(message); };
const within = (parent, child) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

export function supportedNode(version) {
  const [major, minor] = version.split('.').map(Number);
  return Number.isInteger(major) && (major > 24 || major === 24 && minor >= 9);
}

// Check every existing component without following links. Missing directories are
// allowed for initialization; checking never creates a knowledge/state directory.
async function directory(input, label) {
  if (typeof input !== 'string' || !path.isAbsolute(input) || input.includes('\0')) fail(`${label} must be an absolute path.`);
  const normalized = path.resolve(input);
  if (normalized === path.parse(normalized).root) fail(`${label} cannot be the filesystem root.`);
  let current = path.parse(normalized).root;
  let existing = current;
  for (const part of normalized.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    const stat = await lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat) break;
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(current) !== current) fail(`${label} cannot contain links or non-directory components.`);
    existing = current;
  }
  await access(existing, constants.R_OK | constants.W_OK).catch(() => fail(`${label} is not readable/writable by this user.`));
  return normalized;
}

async function locations(root, stateRoot, configPath) {
  root = await directory(root, 'Notes root');
  stateRoot = await directory(stateRoot, 'State root');
  if (within(root, stateRoot) || within(stateRoot, root)) fail('Notes root and state root must be separate, non-overlapping directories.');
  if (!path.isAbsolute(configPath) || configPath.includes('\0')) fail('Config must be an absolute path.');
  configPath = path.resolve(configPath);
  await directory(path.dirname(configPath), 'Config parent');
  if (within(root, configPath) || within(stateRoot, configPath)) fail('Keep the config outside the notes and state directories.');
  return { root, stateRoot, configPath };
}

async function runtime() {
  if (!supportedNode(process.versions.node)) fail('Node.js >=24.9.0 is required.');
  const manifest = require.resolve('@deepseek-ai/dsh/package.json');
  const harness = JSON.parse(await readFile(manifest, 'utf8'));
  if (harness.version !== pinnedHarness) fail(`This plugin requires DeepSeek Harness ${pinnedHarness}. Reinstall the pinned package dependencies.`);
  const entry = path.join(path.dirname(manifest), 'lib/bin.js');
  await access(entry, constants.R_OK).catch(() => fail('The pinned Harness launcher is missing. Reinstall package dependencies.'));
  const client = path.join(packageRoot, 'lib/client.js');
  const bundle = await readFile(client, 'utf8').catch(() => fail('Client bundle is missing. From the source checkout run npm run build; installed tarballs must include lib/client.js.'));
  if (!bundle.includes('window.__ModuleLoader__.load') || !bundle.includes('@corilo/dsh-notes')) fail('Client bundle is not in the supported Harness module format.');
  return { entry, node: process.versions.node, harness: harness.version };
}

async function readConfig(configPath) {
  if (!path.isAbsolute(configPath)) fail('Config must be an absolute path.');
  await directory(path.dirname(path.resolve(configPath)), 'Config parent');
  const stat = await lstat(configPath).catch(() => fail('Config does not exist. Run corilo-notes init first.'));
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 65536) fail('Config must be a regular, unlinked file no larger than 64 KiB.');
  const document = parseDocument(await readFile(configPath, 'utf8'), { uniqueKeys: true });
  if (document.errors.length) fail('Config is not valid YAML/JSON.');
  let data;
  try { data = document.toJS({ maxAliasCount: 10 }); } catch { fail('Config YAML aliases exceed the supported limit.'); }
  const entry = data?.[0]?.insert?.[0];
  if (!Array.isArray(data) || data.length !== 1 || !data[0] || typeof data[0] !== 'object' || Array.isArray(data[0]) || Object.keys(data[0]).join() !== 'insert' ||
      !Array.isArray(data[0].insert) || data[0].insert.length !== 1 || entry?.id !== 'corilo-notes' ||
      entry.name !== path.join(packageRoot, 'index.mjs') || Object.keys(entry).some(key => !['id', 'name', 'config'].includes(key)) ||
      !entry.config || Object.keys(entry.config).some(key => !['root', 'stateRoot'].includes(key))) {
    fail('This command accepts a single Corilo notes overlay for this installed package. Regenerate it with corilo-notes init.');
  }
  if (!entry.config.stateRoot) fail('Config needs an external stateRoot for history and recovery. Regenerate a new overlay with --state-root.');
  return locations(entry.config.root, entry.config.stateRoot, configPath);
}

async function stateBinding(root, stateRoot) {
  const markerPath = path.join(stateRoot, 'corilo-notes-state.json');
  const stat = await lstat(markerPath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!stat) {
    const contents = await readdir(stateRoot).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    if (contents.length) fail('State directory is not empty and has no Corilo binding. Choose a new empty directory.');
    return 'initializes-on-start';
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024) fail('State binding must be a regular, unlinked file.');
  let marker;
  try { marker = JSON.parse(await readFile(markerPath, 'utf8')); } catch { fail('State binding is invalid. Do not overwrite it; choose the matching notes/state directories.'); }
  const rootId = createHash('sha256').update(root).digest('hex');
  if (marker.format !== 'corilo-notes-state-v1' || marker.rootId !== rootId) fail('State directory belongs to a different notes root. Choose its matching root or a new empty state directory.');
  return 'bound';
}

async function gitVersion() {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    child.stdout.on('data', bytes => { if (output.length < 1024) output += bytes; });
    child.once('error', () => reject(new Error('Git >=2.36 is required for local note history. Install Git using your operating system package manager.')));
    child.once('exit', code => {
      const match = /^git version (\d+)\.(\d+)/.exec(output);
      if (code !== 0 || !match) { reject(new Error('Git could not run. Check the system Git installation.')); return; }
      if (Number(match[1]) < 2 || Number(match[1]) === 2 && Number(match[2]) < 36) { reject(new Error('Git >=2.36 is required for durable local note history.')); return; }
      resolve(output.trim());
    });
  });
}

export async function initialize({ root, stateRoot, configPath }) {
  await runtime();
  const resolved = await locations(root, stateRoot, configPath);
  await gitVersion();
  await stateBinding(resolved.root, resolved.stateRoot);
  const overlay = [{ insert: [{ id: 'corilo-notes', name: path.join(packageRoot, 'index.mjs'), config: { root: resolved.root, stateRoot: resolved.stateRoot } }] }];
  await writeFile(resolved.configPath, JSON.stringify(overlay, null, 2) + '\n', { flag: 'wx', mode: 0o600 }).catch(error => {
    if (error.code === 'EEXIST') fail('Config already exists; it was not changed. Choose another --config path.');
    fail('Could not create config. Its parent directory must already exist and be writable.');
  });
  return resolved;
}

export async function inspect(configPath) {
  const installed = await runtime();
  const resolved = await readConfig(configPath);
  const git = await gitVersion();
  const state = await stateBinding(resolved.root, resolved.stateRoot);
  return { ...resolved, node: installed.node, harness: installed.harness, git, state, client: 'built', entry: installed.entry };
}

async function start(configPath, port) {
  const checked = await inspect(configPath);
  const args = [checked.entry, 'web', '--patch', checked.configPath, '--no-open'];
  if (port !== undefined) args.push('--port', port);
  const child = spawn(process.execPath, args, { stdio: 'inherit' });
  const forward = signal => { if (child.exitCode === null && child.signalCode === null) child.kill(signal); };
  const interrupt = () => forward('SIGINT');
  const terminate = () => forward('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', () => reject(new Error('Could not start the pinned Harness launcher.')));
      child.once('exit', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : 143)));
    });
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
  }
}

const usage = `Corilo Notes (Harness ${pinnedHarness})\n\ncorilo-notes init --root /absolute/notes --state-root /absolute/state --config /absolute/notes.patch.json\ncorilo-notes check --config /absolute/notes.patch.json\ncorilo-notes start --config /absolute/notes.patch.json [--port 3000]\n\ninit creates only the config and never overwrites it. Keep notes, state and config separate.\nstart runs the pinned Harness Web launcher; use its authenticated URL. No model key is needed for direct notes.\n`;

export async function main(args) {
  if (!args.length || args.length === 1 && ['--help', '-h'].includes(args[0])) { process.stdout.write(usage); return; }
  const [command, ...rest] = args;
  const allowed = command === 'init' ? ['--root', '--state-root', '--config'] : command === 'start' ? ['--config', '--port'] : command === 'check' ? ['--config'] : [];
  if (!allowed.length) fail('Unknown command. Use corilo-notes --help.');
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i], value = rest[i + 1];
    if (!allowed.includes(key) || key in options || !value || value.startsWith('--')) fail('Unknown, duplicate or missing option. Use corilo-notes --help.');
    options[key] = value;
  }
  if (!options['--config']) fail('--config is required and must be an absolute path.');
  if (options['--port'] !== undefined && (!/^\d+$/.test(options['--port']) || Number(options['--port']) > 65535)) fail('--port must be an integer from 0 through 65535.');
  if (command === 'init') {
    if (!options['--root'] || !options['--state-root']) fail('init requires --root and --state-root absolute paths.');
    const result = await initialize({ root: options['--root'], stateRoot: options['--state-root'], configPath: options['--config'] });
    process.stdout.write(`Created notes overlay: ${result.configPath}\nRun corilo-notes check --config ${JSON.stringify(result.configPath)} before starting.\n`);
  } else if (command === 'check') {
    const { entry, ...report } = await inspect(options['--config']);
    process.stdout.write(JSON.stringify({ ok: true, ...report }, null, 2) + '\n');
  } else await start(options['--config'], options['--port']);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(`Corilo Notes: ${error.message}\n`); process.exitCode = 1; });
}
