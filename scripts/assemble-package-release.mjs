#!/usr/bin/env node
// Assemble already-validated independent packages; this command never publishes.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PRODUCTS } from './prepare-release.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const json = (path) => JSON.parse(readFileSync(path, 'utf8'))
const requiredChecks = ['build', 'package-tests', 'package-content']

export function assemblePackageRelease(input, output, sourceSha, { repo = REPO } = {}) {
  if (!/^[0-9a-f]{40}$/.test(sourceSha ?? '')) throw new Error('A full source commit SHA is required')
  const destination = resolve(output)
  if (existsSync(destination)) throw new Error('Release output already exists')
  const packages = Object.entries(PRODUCTS).map(([product, relative]) => {
    const pkg = json(join(repo, relative, 'package.json'))
    const report = json(join(input, product, 'release.json'))
    if (report.product !== product || report.name !== pkg.name || report.version !== pkg.version || report.published !== false) throw new Error(`Preparation identity mismatch: ${product}`)
    if (typeof report.filename !== 'string' || basename(report.filename) !== report.filename || !report.filename.endsWith('.tgz')) throw new Error('Unsafe package filename')
    if (report.dsh !== '0.2.2-rc.3' || report.node !== '>=24.9.0' || !Number.isInteger(report.fileCount) || report.fileCount < 1 || !requiredChecks.every((check) => report.checks?.includes(check))) throw new Error(`Incomplete preparation: ${product}`)
    const bytes = readFileSync(join(input, product, report.filename))
    if (digest(bytes) !== report.sha256) throw new Error(`Package checksum mismatch: ${product}`)
    const changes = readFileSync(join(input, product, 'RELEASE_NOTES.md'), 'utf8')
    return { product, name: pkg.name, version: pkg.version, filename: report.filename, sha256: report.sha256, fileCount: report.fileCount, checks: requiredChecks, bytes, changes }
  })
  if (new Set(packages.map((pkg) => pkg.filename)).size !== packages.length) throw new Error('Duplicate package filenames')
  const rows = packages.map((pkg) => `| ${pkg.name} | ${pkg.version} | ${pkg.filename} |`).join('\n')
  const introduction = `# Corilo independent packages / 独立插件分发包\n\nSource commit / 源码提交: ${sourceSha}\n\n| Package / 包 | Version / 版本 | Asset / 附件 |\n|---|---|---|\n${rows}\n\nRequires Node.js ≥24.9.0 and DSH exactly 0.2.2-rc.3. Each package installs independently.\n要求 Node.js ≥24.9.0、DSH 精确版本 0.2.2-rc.3；三个包独立安装。\n`
  const install = `${introduction}\n## Install / 安装\n\nDownload the selected .tgz and SHA256SUMS. In a new installation directory, initialize npm and install the exact host version before adding a package:\n下载所需 .tgz 和 SHA256SUMS。在新的安装目录初始化 npm，并固定宿主版本：\n\n\`\`\`sh\nnpm init -y\nnpm install --save-exact --ignore-scripts @deepseek-ai/dsh@0.2.2-rc.3\nnpm install --save-exact --ignore-scripts /absolute/path/to/selected-package.tgz\nnpm ls @deepseek-ai/dsh\n\`\`\`\n\nInstalling the package alone does not enable it. Follow its bundled README and patch example to configure DSH. Notes includes QUICKSTART.zh-CN.md and QUICKSTART.en.md. The tutor requires an existing DSH installation and stays separate from the default notes + todos composition. These are plugins, not a standalone Corilo installer; production dependencies are downloaded by npm.\n安装依赖后仍需按包内 README 和 patch 示例配置 DSH。笔记包附带中英快速指南；导师供已有 DSH 用户使用，不加入默认 notes + todos 组合。这些是插件包，运行依赖由 npm 下载。\n\nFor a new notes-only instance, the notes package also provides:\n仅创建新的单笔记实例时，笔记包提供：\n\n\`\`\`sh\nnpx --no-install corilo-notes init --directory /absolute/new-corilo-instance\nnpx --no-install corilo-notes start --config /absolute/new-corilo-instance/notes.patch.json\n\`\`\`\n\nBefore upgrading an existing installation, save input, stop services, and back up its data and configuration. Do not initialize over an existing instance or automatically migrate data.\n升级已有实例前先保存输入、停服并备份资料与配置；不要覆盖初始化或自动迁移。\n\nTo verify every downloaded release asset, place them together and run \`sha256sum -c SHA256SUMS\`. For a single package, select its matching line from SHA256SUMS.\n所有附件下载到同一目录后可运行 \`sha256sum -c SHA256SUMS\`；仅下载单包时核对校验文件中对应的一行。\n`
  const notes = `${introduction}\nGitHub prerelease of independently validated plugin archives. No npm publication, user-data migration, or deployment is performed.\n本次为独立插件归档的 GitHub 预发布，不执行 npm 发布、用户数据迁移或部署。\n\nAssets include installation instructions, per-product change logs, SHA256 checksums, and a source/package manifest. Build, package tests, and content checks run for each product; notes also requires a real restic backup/restore drill.\n附件包含安装说明、各产品变更记录、SHA256 校验和与源码/包清单。每个产品执行构建、包测试和内容检查；笔记还要求真实 restic 备份恢复测试。\n\nLive models, physical phones, and target deployment are not established by these release checks. See INSTALL.md and each package README for installation and compatibility limits.\n这些发布检查不代表真实模型、物理手机或目标部署验收；安装及兼容边界见 INSTALL.md 和各包 README。\n`
  mkdirSync(dirname(destination), { recursive: true })
  const stage = mkdtempSync(join(dirname(destination), '.assemble-release-'))
  try {
    const files = new Map([
      ['INSTALL.md', Buffer.from(install)],
      ['RELEASE_NOTES.md', Buffer.from(notes)],
      ['release-manifest.json', Buffer.from(JSON.stringify({ sourceSha, dsh: '0.2.2-rc.3', node: '>=24.9.0', channel: 'github-prerelease', npmPublished: false, packages: packages.map(({ bytes, changes, ...identity }) => identity) }, null, 2) + '\n')],
    ])
    for (const pkg of packages) {
      files.set(pkg.filename, pkg.bytes)
      files.set(`${pkg.product}-CHANGELOG.md`, Buffer.from(pkg.changes))
    }
    for (const [name, bytes] of files) writeFileSync(join(stage, name), bytes)
    writeFileSync(join(stage, 'SHA256SUMS'), [...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => `${digest(bytes)}  ${name}\n`).join(''))
    renameSync(stage, destination)
    return { directory: destination, sourceSha, packages: packages.map(({ bytes, changes, ...identity }) => identity) }
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 5) throw new Error('Usage: assemble-package-release.mjs <prepared-root> <new-output-directory> <source-sha>')
    console.log(JSON.stringify(assemblePackageRelease(...process.argv.slice(2)), null, 2))
  } catch (error) {
    console.error(`Release assembly failed: ${error.message}`)
    process.exitCode = 1
  }
}
