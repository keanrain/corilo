import { spawn } from 'node:child_process'
import { mkdtemp, rm, readdir, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function gitSource(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('repository URL must be an HTTPS Git URL') }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error('repository URL must use HTTPS without credentials, query, or fragment')
  }
  return url.href
}

async function directoryBytes(path) {
  let total = 0
  for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) total += await directoryBytes(child)
    else if (entry.isFile()) total += (await lstat(child).catch(() => null))?.size ?? 0
    if (total > 64 * 1024 * 1024) break
  }
  return total
}

// Git is only a downloader here: no checkout hooks, submodules, inherited Git
// configuration, credentials, protocol helpers or interactive prompts.
export async function withGitRepository(value, operation) {
  const source = gitSource(value)
  const temporary = await mkdtemp(join(tmpdir(), 'learn-repo-'))
  const directory = join(temporary, 'repo')
  const networkEnv = Object.fromEntries(['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'all_proxy', 'no_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'GIT_SSL_CAINFO'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]))
  const run = (args, monitor = false) => new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always',
      '-c', 'credential.helper=', '-c', 'core.hooksPath=/dev/null', '-c', 'http.followRedirects=false', ...args], {
      env: { ...networkEnv, PATH: process.env.PATH, HOME: temporary, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let output = ''
    let failure
    child.stdout.on('data', (bytes) => { output = (output + bytes).slice(-4096) })
    const timeout = setTimeout(() => { failure = new Error('repository download exceeded 60 seconds'); child.kill('SIGKILL') }, 60000)
    let checking = false
    const interval = monitor ? setInterval(async () => {
      if (checking) return
      checking = true
      try {
        if (await directoryBytes(temporary) > 64 * 1024 * 1024) {
          failure = new Error('repository download exceeded 64 MiB'); child.kill('SIGKILL')
        }
      } finally { checking = false }
    }, 100) : null
    const cleanup = () => { clearTimeout(timeout); clearInterval(interval) }
    child.on('error', (error) => { cleanup(); reject(error) })
    child.on('close', (code) => { cleanup(); code === 0 && !failure ? resolve(output.trim()) : reject(failure ?? new Error('repository download failed; check the HTTPS URL and access')) })
  })
  try {
    await run(['clone', '--depth=1', '--single-branch', '--no-tags', '--no-recurse-submodules', '--', source, directory], true)
    if (await directoryBytes(temporary) > 64 * 1024 * 1024) throw new Error('repository download exceeded 64 MiB')
    const commit = await run(['-C', directory, 'rev-parse', 'HEAD'])
    return await operation(directory, { url: source, commit })
  } finally { await rm(temporary, { recursive: true, force: true }) }
}
