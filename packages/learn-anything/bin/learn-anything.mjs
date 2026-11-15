#!/usr/bin/env node
// learn-anything launcher: prepares a dedicated dsh profile with the
// learn-anything bundle and the「学习导师」preset as default (and the session-log /
// plugin-inventory uploads off), then serves the DeepSeek Harness Web UI with the
// current folder registered and opened as the workspace: run it in the folder that
// holds your learning materials.
//
//   npx @corilo/learn-anything [--port 8080] [--no-open] [--reinstall] [--from <spec>]
//
//   --from <spec>  install the plugin from this spec instead of the registry, e.g. a local
//                  package for testing: npx -y ./x.tgz --from ./x.tgz (add --reinstall for a
//                  newer build of the same version)
//
// Environment:
//   DSH_HOME             dsh data root (default ~/.dsh); the profile lives in profiles/learn-anything
//   LEARN_ANYTHING_DSH   path to a dsh bin to use instead of `npx @deepseek-ai/dsh@<pinned>`
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PNPM_VERSION = '10'
const PROFILE = 'learn-anything'
const MIN_NODE = [24, 9]

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
const DSH_VERSION = pkg.engines.dsh
const isWin = process.platform === 'win32'

function fail(message) {
  console.error(`learn-anything: ${message}`)
  process.exit(1)
}

function checkNode() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
    fail(`需要 Node.js >= ${MIN_NODE.join('.')}，当前是 ${process.versions.node}`)
  }
}

function dshHome() {
  const env = process.env.DSH_HOME?.trim()
  if (!env) return join(homedir(), '.dsh')
  return env === '~' ? homedir() : env.startsWith('~/') || env.startsWith('~\\') ? join(homedir(), env.slice(2)) : resolve(env)
}

/** The dsh command line: a local bin when given, otherwise the pinned npm release. */
function dshCommand() {
  const local = process.env.LEARN_ANYTHING_DSH
  if (local) return [process.execPath, [local]]
  return [isWin ? 'npx.cmd' : 'npx', ['-y', `@deepseek-ai/dsh@${DSH_VERSION}`]]
}

/**
 * `dsh plugin` runs pnpm from PATH. When pnpm is missing, put a shim that
 * forwards to `npx pnpm@<major>` in front of PATH for the child processes.
 */
function ensurePnpm(env) {
  const probe = spawnSync(isWin ? 'pnpm.cmd' : 'pnpm', ['--version'], { env, stdio: 'ignore', shell: isWin })
  if (probe.status === 0) return env
  const shimDir = join(dshHome(), 'learn-anything', 'bin')
  mkdirSync(shimDir, { recursive: true })
  if (isWin) writeFileSync(join(shimDir, 'pnpm.cmd'), `@npx -y pnpm@${PNPM_VERSION} %*\r\n`)
  else writeFileSync(join(shimDir, 'pnpm'), `#!/bin/sh\nexec npx -y pnpm@${PNPM_VERSION} "$@"\n`, { mode: 0o755 })
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  return { ...env, [key]: `${shimDir}${isWin ? ';' : ':'}${env[key] ?? ''}` }
}

function runDsh(args, env, options = {}) {
  const [cmd, base] = dshCommand()
  const result = spawnSync(cmd, [...base, ...args], { env, stdio: options.quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit', shell: isWin && cmd.endsWith('.cmd') })
  if (result.status !== 0) fail(`dsh ${args.join(' ')} 失败（exit ${result.status ?? result.signal}）`)
}

/**
 * Install from `--from` when given (a local path is made absolute: dsh runs pnpm in the profile),
 * else from the registry when run from an installed copy, else from this checkout.
 */
function installSpec(from) {
  if (from) return /^[.~/\\]|^[a-z]:/i.test(from) || existsSync(from) ? resolve(from) : from
  return pkgDir.split(sep).includes('node_modules') ? `${pkg.name}@${pkg.version}` : pkgDir
}

// Before 0.1.0 shipped the package was unscoped (`learn-anything` on npm belongs to someone
// else). A profile that still has it would load both bundles and list the presets twice.
const OLD_NAME = 'learn-anything'

function hasOldPackage(profileDir) {
  try {
    return OLD_NAME in (JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')).dependencies ?? {})
  } catch {
    return false
  }
}

function installedVersion(profileDir) {
  try {
    return JSON.parse(readFileSync(join(profileDir, 'node_modules', pkg.name, 'package.json'), 'utf8')).version
  } catch {
    return undefined
  }
}

// The default preset and the privacy rows (session-log / plugin-inventory uploads off) come
// from the bundle's own cordis.patch.yml, so a Plugins-page or market install gets them too.
// Profiles made by earlier launchers still carry the same rows in their profile patch.

// dsh 0.2.0 shipped dsh-schedule as an experimental bundle, which earlier launchers switched
// on together with a profile row disabling `time-context`. 0.2.1 has schedule in the web
// profile and drops the retired bundle itself; the row now matches nothing, so remove it.
const OLD_SCHEDULE_PATCH = `# learn-anything: the review reminder does not need a clock message on every step.
- id: time-context
  disabled: true
`

function dropOldScheduleRow(profileDir) {
  const file = join(profileDir, 'cordis.patch.yml')
  const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (text.includes(OLD_SCHEDULE_PATCH)) writeFileSync(file, text.replace(OLD_SCHEDULE_PATCH, '').trimEnd() + '\n')
}

function main() {
  checkNode()
  const argv = process.argv.slice(2)
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1).filter((l, i, all) => all.slice(0, i + 1).every((x) => x.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
    return
  }
  const reinstall = argv.includes('--reinstall')
  const fromAt = argv.indexOf('--from')
  const from = fromAt >= 0 ? argv[fromAt + 1] : undefined
  if (fromAt >= 0 && !from) fail('--from 后面要跟包的位置，例如 ./corilo-learn-anything-0.1.0.tgz')
  const webArgs = argv.filter((a, i) => a !== '--reinstall' && (fromAt < 0 || (i !== fromAt && i !== fromAt + 1)))

  let env = { ...process.env }
  const profileDir = join(dshHome(), 'profiles', PROFILE)
  if (!existsSync(join(profileDir, 'package.json'))) {
    console.error(`learn-anything: 创建 dsh profile「${PROFILE}」…`)
    runDsh(['--profile', PROFILE, '--from-default-profile', 'web', '--dump-config'], env, { quiet: true })
  }
  // A checkout is installed as a link, so it only needs installing once; a
  // registry copy is reinstalled whenever the launcher's version differs.
  if (hasOldPackage(profileDir)) {
    console.error(`learn-anything: 移除旧包名 ${OLD_NAME}（已改名为 ${pkg.name}）…`)
    env = ensurePnpm(env)
    runDsh(['plugin', '--profile', PROFILE, 'remove', OLD_NAME], env)
  }
  const spec = installSpec(from)
  const installed = installedVersion(profileDir)
  if (reinstall || installed === undefined || (spec !== pkgDir && installed !== pkg.version)) {
    console.error(`learn-anything: 安装插件 ${spec === pkgDir ? `（本地目录 ${pkgDir}）` : spec}…`)
    env = ensurePnpm(env)
    runDsh(['plugin', '--profile', PROFILE, 'add', spec], env)
  }
  dropOldScheduleRow(profileDir)

  // src/host/ui.js registers this folder as a Workspace and the page opens it.
  env.LEARN_ANYTHING_WORKSPACE = process.cwd()
  console.error(`learn-anything: 工作区是当前目录 ${process.cwd()}，页面打开后直接在这里开始学习（学习数据保存在其中的 .learn/）。`)
  const [cmd, base] = dshCommand()
  const child = spawn(cmd, [...base, '--profile', PROFILE, ...webArgs], { env, stdio: 'inherit', shell: isWin && cmd.endsWith('.cmd') })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
}

main()
