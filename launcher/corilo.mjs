#!/usr/bin/env node
// Source-checkout launcher: compose notes and todos planner (or retain an existing configuration), then delegate
// boot, authentication and model settings to the pinned Harness.
import path from 'node:path';
import { constants } from 'node:fs';
import { access, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawn, execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const checkout = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const notesRoot = path.join(checkout, 'plugins/notes');
const todosRoot = path.join(checkout, 'plugins/todos');
const notesCli = path.join(notesRoot, 'cli.mjs');
const inside = (parent, child) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
const fail = message => { throw new Error(message); };

async function directory(input, { existing = false } = {}) {
  if (typeof input !== 'string' || !path.isAbsolute(input) || input.includes('\0')) fail('Instance directory must be an absolute path.');
  const resolved = path.resolve(input);
  if (resolved === path.parse(resolved).root) fail('The instance directory cannot be the filesystem root.');
  let current = path.parse(resolved).root, nearest = current, missing = false;
  for (const part of resolved.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    const stat = await lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat) { missing = true; break; }
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(current) !== current) fail('The instance path cannot contain links or non-directory components.');
    nearest = current;
  }
  if (existing && missing) fail('The instance directory does not exist. Run init first.');
  await access(nearest, constants.R_OK | constants.W_OK).catch(() => fail('The instance directory or its existing parent is not readable/writable.'));
  return resolved;
}
async function layout(input, existing = false) {
  const instance = await directory(input, { existing });
  if (inside(checkout, instance) || inside(instance, checkout)) fail('Instance data must be separate from the source checkout. Choose a directory outside the repository.');
  const result = {
    instance, notes: path.join(instance, 'notes'), state: path.join(instance, 'state'), todos: path.join(instance, 'todos'),
    harness: path.join(instance, 'runtime/harness'), agents: path.join(instance, 'runtime/agents'),
    workspace: path.join(instance, 'workspace'), notesConfig: path.join(instance, 'notes.patch.json'), config: path.join(instance, 'corilo.patch.json'),
  };
  for (const key of ['notes', 'state', 'todos', 'harness', 'agents', 'workspace']) await directory(result[key]);
  return result;
}
const environment = locations => ({ ...process.env, DSH_HOME: locations.harness, DSH_AGENTS_HOME: locations.agents });
const overlay = (locations, legacy = false, dual = false, planner = false) => [{ insert: [
  { id: 'corilo-notes', name: path.join(notesRoot, 'index.mjs'), config: { root: locations.notes, ...(legacy ? { stateRoot: locations.state } : {}) } },
  ...(dual ? [{ id: 'corilo-todos', name: path.join(todosRoot, 'index.mjs'), config: { root: locations.todos, notesRoot: locations.notes, ...(planner ? { planner: true } : {}) } }] : []),
] }, { id: 'workspace-controller', config: { documentsDirectory: locations.workspace } }];
async function bundledClient(packageRoot, name) {
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  const bundle = await readFile(path.join(packageRoot, 'lib/client.js'), 'utf8').catch(() => fail(`The ${name} client is missing. Run npm --prefix plugins/${name} run build.`));
  if (!bundle.includes('window.__ModuleLoader__.load') || !bundle.includes(manifest.name)) fail(`The ${name} client bundle format is incompatible. Rebuild the client.`);
  return manifest;
}
async function dependencies(dual = false) {
  for (const [root, name] of [[notesRoot, 'notes'], ...(dual ? [[todosRoot, 'todos']] : [])]) {
    const require = createRequire(path.join(root, 'package.json'));
    try { require.resolve('@deepseek-ai/dsh/package.json'); }
    catch { fail(`The ${name} dependencies are missing. Run npm --prefix plugins/${name} ci --ignore-scripts.`); }
    await bundledClient(root, name);
  }
}
async function runNotes(command, locations) {
  try {
    return await exec(process.execPath, [notesCli, command, ...(command === 'init' ? ['--directory', locations.instance] : ['--config', locations.notesConfig])], {
      cwd: locations.instance, env: environment(locations), maxBuffer: 1024 * 1024,
    });
  } catch (error) { fail(error.stderr?.trim() || 'Notes preflight failed. Check Node and the directories using the plugin quick-start guide.'); }
}
async function config(locations) {
  const stat = await lstat(locations.config).catch(() => fail('The combined configuration is missing. Run init first; existing instances are not migrated automatically.'));
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 65536) fail('The combined configuration must be a regular, unlinked file no larger than 64 KiB.');
  let data;
  try { data = JSON.parse(await readFile(locations.config, 'utf8')); } catch { fail('The combined configuration is invalid. Preserve and inspect the original file.'); }
  if (![overlay(locations), overlay(locations, true), overlay(locations, false, true), overlay(locations, true, true), overlay(locations, false, true, true)].some(expected => isDeepStrictEqual(data, expected))) fail('The combined configuration does not match the current checkout or instance paths; no automatic migration or additional plugins will run.');
  return data[0].insert.some(entry => entry.id === 'corilo-todos');
}

export async function initialize(input) {
  const locations = await layout(input);
  await dependencies(true);
  for (const filename of [locations.config, locations.notesConfig]) {
    if (await lstat(filename).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) fail('Configuration already exists and will not be overwritten. Run check/start; manage older instances using their original guide.');
  }
  await mkdir(locations.instance, { recursive: true, mode: 0o700 });
  await runNotes('init', locations);
  await writeFile(locations.config, JSON.stringify(overlay(locations, false, true, true), null, 2) + '\n', { flag: 'wx', mode: 0o600 }).catch(() => fail('Could not create the combined configuration; notes.patch.json is preserved. No data was deleted or overwritten. Inspect the instance before retrying.'));
  return locations;
}
export async function inspect(input) {
  const locations = await layout(input, true);
  const dual = await config(locations); await dependencies(dual);
  const checked = JSON.parse((await runNotes('check', locations)).stdout);
  if (checked.root !== locations.notes || checked.stateRoot && checked.stateRoot !== locations.state || checked.harnessHome !== locations.harness || checked.agentsHome !== locations.agents) {
    fail('Notes configuration paths do not match the combined instance. Preserve and inspect the original configuration.');
  }
  if (dual) { const todo = JSON.parse(await readFile(path.join(todosRoot, 'package.json'), 'utf8'));
    if (todo.dependencies['@deepseek-ai/dsh'] !== checked.harness) fail('The two plugins declare different Harness versions. Restore the pinned dependencies.'); }
  return { ...locations, node: checked.node, harnessVersion: checked.harness, git: checked.git, noteState: checked.state, todosValidation: dual ? 'on-start' : 'not-loaded', client: 'built' };
}
export async function start(input, port = '3000') {
  const locations = await inspect(input);
  if (!/^\d+$/.test(String(port)) || Number(port) > 65535) fail('Port must be an integer from 0 through 65535.');
  const require = createRequire(path.join(notesRoot, 'package.json'));
  const entry = path.join(path.dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'lib/bin.js');
  const child = spawn(process.execPath, [entry, 'web', '--patch', locations.config, '--no-open', '--port', String(port)], { cwd: locations.instance, env: environment(locations), stdio: 'inherit' });
  const forward = signal => { if (child.exitCode === null && child.signalCode === null) child.kill(signal); };
  const interrupt = () => forward('SIGINT'), terminate = () => forward('SIGTERM');
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  try {
    return await new Promise((resolve, reject) => {
      child.once('error', () => reject(new Error('Could not start the pinned Harness launcher. Check the installation.')));
      child.once('exit', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : 143)));
    });
  } finally { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); }
}
const usage = `Corilo notes and tasks (source-checkout launcher)
node launcher/corilo.mjs init --directory /absolute/corilo-instance
node launcher/corilo.mjs check --directory /absolute/corilo-instance
node launcher/corilo.mjs start --directory /absolute/corilo-instance [--port 3000]

Initialization only creates configuration; it does not overwrite existing instances or migrate credentials. Direct editing requires no model key.
`;
export async function main(args) {
  if (!args.length || args.length === 1 && ['--help', '-h'].includes(args[0])) { process.stdout.write(usage); return; }
  const [command, ...rest] = args;
  if (!['init', 'check', 'start'].includes(command)) fail('Unknown command. Run --help.');
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index], value = rest[index + 1];
    if (!['--directory', ...(command === 'start' ? ['--port'] : [])].includes(key) || key in options || !value || value.startsWith('--')) fail('Missing, duplicate or invalid option. Run --help.');
    options[key] = value;
  }
  if (!options['--directory']) fail('Provide --directory with an absolute instance path.');
  if (command === 'init') {
    const locations = await initialize(options['--directory']);
    process.stdout.write(`Created notes and tasks configuration: ${locations.config}\nRun start with the same directory.\n`);
  } else if (command === 'check') process.stdout.write(JSON.stringify({ ok: true, ...await inspect(options['--directory']) }, null, 2) + '\n');
  else process.exitCode = await start(options['--directory'], options['--port']);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main(process.argv.slice(2)).catch(error => { process.stderr.write(`Corilo: ${error.message}\n`); process.exitCode = 1; });
