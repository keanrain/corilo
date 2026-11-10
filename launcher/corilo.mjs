#!/usr/bin/env node
// Source-checkout launcher: compose the two independent plugins, then delegate
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
  if (typeof input !== 'string' || !path.isAbsolute(input) || input.includes('\0')) fail('实例目录必须是绝对路径。');
  const resolved = path.resolve(input);
  if (resolved === path.parse(resolved).root) fail('不能使用文件系统根目录作为实例目录。');
  let current = path.parse(resolved).root, nearest = current, missing = false;
  for (const part of resolved.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    const stat = await lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat) { missing = true; break; }
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(current) !== current) fail('实例路径不能包含链接或非目录。');
    nearest = current;
  }
  if (existing && missing) fail('实例目录不存在，请先运行 init。');
  await access(nearest, constants.R_OK | constants.W_OK).catch(() => fail('实例目录或其已有父目录不可读写。'));
  return resolved;
}
async function layout(input, existing = false) {
  const instance = await directory(input, { existing });
  if (inside(checkout, instance) || inside(instance, checkout)) fail('实例资料必须与源码仓库分开，请选择仓库外的目录。');
  const result = {
    instance, notes: path.join(instance, 'notes'), state: path.join(instance, 'state'), todos: path.join(instance, 'todos'),
    harness: path.join(instance, 'runtime/harness'), agents: path.join(instance, 'runtime/agents'),
    workspace: path.join(instance, 'workspace'), notesConfig: path.join(instance, 'notes.patch.json'), config: path.join(instance, 'corilo.patch.json'),
  };
  for (const key of ['notes', 'state', 'todos', 'harness', 'agents', 'workspace']) await directory(result[key]);
  return result;
}
const environment = locations => ({ ...process.env, DSH_HOME: locations.harness, DSH_AGENTS_HOME: locations.agents });
const overlay = (locations, legacy = false) => [{ insert: [
  { id: 'corilo-notes', name: path.join(notesRoot, 'index.mjs'), config: { root: locations.notes, ...(legacy ? { stateRoot: locations.state } : {}) } },
  { id: 'corilo-todos', name: path.join(todosRoot, 'index.mjs'), config: { root: locations.todos, notesRoot: locations.notes } },
] }, { id: 'workspace-controller', config: { documentsDirectory: locations.workspace } }];
async function bundledClient(packageRoot, name) {
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  const bundle = await readFile(path.join(packageRoot, 'lib/client.js'), 'utf8').catch(() => fail(`缺少 ${name} 页面，请运行 npm --prefix plugins/${name} run build。`));
  if (!bundle.includes('window.__ModuleLoader__.load') || !bundle.includes(manifest.name)) fail(`${name} 页面构建格式不兼容，请重新构建。`);
  return manifest;
}
async function dependencies() {
  for (const [root, name] of [[notesRoot, 'notes'], [todosRoot, 'todos']]) {
    const require = createRequire(path.join(root, 'package.json'));
    try { require.resolve('@deepseek-ai/dsh/package.json'); }
    catch { fail(`缺少 ${name} 依赖，请运行 npm --prefix plugins/${name} ci --ignore-scripts。`); }
    await bundledClient(root, name);
  }
}
async function runNotes(command, locations) {
  try {
    return await exec(process.execPath, [notesCli, command, ...(command === 'init' ? ['--directory', locations.instance] : ['--config', locations.notesConfig])], {
      cwd: locations.instance, env: environment(locations), maxBuffer: 1024 * 1024,
    });
  } catch (error) { fail(error.stderr?.trim() || '笔记预检失败，请按插件快速指南检查 Node 和目录。'); }
}
async function config(locations) {
  const stat = await lstat(locations.config).catch(() => fail('缺少组合配置，请先运行 init；已有实例不会自动迁移。'));
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 65536) fail('组合配置必须是普通独立文件，且不超过 64 KiB。');
  let data;
  try { data = JSON.parse(await readFile(locations.config, 'utf8')); } catch { fail('组合配置无效，请保留原文件并核对。'); }
  if (!isDeepStrictEqual(data, overlay(locations)) && !isDeepStrictEqual(data, overlay(locations, true))) fail('组合配置与当前源码/实例路径不匹配；不自动迁移或执行其他插件。');
}

export async function initialize(input) {
  const locations = await layout(input);
  await dependencies();
  for (const filename of [locations.config, locations.notesConfig]) {
    if (await lstat(filename).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) fail('配置已存在，不会覆盖。请直接运行 check/start；旧实例需按原指南管理。');
  }
  await mkdir(locations.instance, { recursive: true, mode: 0o700 });
  await runNotes('init', locations);
  await writeFile(locations.config, JSON.stringify(overlay(locations), null, 2) + '\n', { flag: 'wx', mode: 0o600 }).catch(() => fail('组合配置创建失败；notes.patch.json 已保留。未删除或覆盖任何资料，请核对实例后重试。'));
  return locations;
}
export async function inspect(input) {
  const locations = await layout(input, true);
  await dependencies(); await config(locations);
  const checked = JSON.parse((await runNotes('check', locations)).stdout);
  if (checked.root !== locations.notes || checked.stateRoot && checked.stateRoot !== locations.state || checked.harnessHome !== locations.harness || checked.agentsHome !== locations.agents) {
    fail('笔记配置路径与统一实例不匹配，请保留原配置并核对。');
  }
  const todo = JSON.parse(await readFile(path.join(todosRoot, 'package.json'), 'utf8'));
  if (todo.dependencies['@deepseek-ai/dsh'] !== checked.harness) fail('两个插件声明的 Harness 版本不一致，请恢复固定依赖。');
  return { ...locations, node: checked.node, harnessVersion: checked.harness, git: checked.git, noteState: checked.state, todosValidation: 'on-start', client: 'built' };
}
export async function start(input, port = '3000') {
  const locations = await inspect(input);
  if (!/^\d+$/.test(String(port)) || Number(port) > 65535) fail('端口必须为 0–65535 的整数。');
  const require = createRequire(path.join(notesRoot, 'package.json'));
  const entry = path.join(path.dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'lib/bin.js');
  const child = spawn(process.execPath, [entry, 'web', '--patch', locations.config, '--no-open', '--port', String(port)], { cwd: locations.instance, env: environment(locations), stdio: 'inherit' });
  const forward = signal => { if (child.exitCode === null && child.signalCode === null) child.kill(signal); };
  const interrupt = () => forward('SIGINT'), terminate = () => forward('SIGTERM');
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  try {
    return await new Promise((resolve, reject) => {
      child.once('error', () => reject(new Error('固定 Harness 启动失败，请检查安装。')));
      child.once('exit', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : 143)));
    });
  } finally { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); }
}
const usage = `Corilo 笔记与待办（源码统一入口）
node launcher/corilo.mjs init --directory /absolute/corilo-instance
node launcher/corilo.mjs check --directory /absolute/corilo-instance
node launcher/corilo.mjs start --directory /absolute/corilo-instance [--port 3000]

初始化只创建配置，不覆盖旧实例或迁移凭据。直接记录无需模型密钥。
`;
export async function main(args) {
  if (!args.length || args.length === 1 && ['--help', '-h'].includes(args[0])) { process.stdout.write(usage); return; }
  const [command, ...rest] = args;
  if (!['init', 'check', 'start'].includes(command)) fail('命令无效，请运行 --help。');
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index], value = rest[index + 1];
    if (!['--directory', ...(command === 'start' ? ['--port'] : [])].includes(key) || key in options || !value || value.startsWith('--')) fail('参数缺失、重复或无效，请运行 --help。');
    options[key] = value;
  }
  if (!options['--directory']) fail('请提供 --directory 绝对实例路径。');
  if (command === 'init') {
    const locations = await initialize(options['--directory']);
    process.stdout.write(`已创建笔记与待办配置：${locations.config}\n使用相同目录运行 start 即可。\n`);
  } else if (command === 'check') process.stdout.write(JSON.stringify({ ok: true, ...await inspect(options['--directory']) }, null, 2) + '\n');
  else process.exitCode = await start(options['--directory'], options['--port']);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main(process.argv.slice(2)).catch(error => { process.stderr.write(`Corilo: ${error.message}\n`); process.exitCode = 1; });
