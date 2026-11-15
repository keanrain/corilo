/**
 * Material ingest: PDF, EPUB, plain text / Markdown, and code repositories become
 * blocks of at most ~BLOCK_CHARS characters under `.learn/materials/<id>/`, so the tutor
 * reads only the blocks it needs and cites them by id (e.g. `m-ab12#7`).
 * @module learn-anything/ingest
 */
import { readFile, stat, readdir } from 'node:fs/promises'
import { join, resolve, relative, extname, basename, isAbsolute, posix } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { createHash } from 'node:crypto'
import * as store from './store.js'

export const BLOCK_CHARS = 4000
const MAX_FILE_BYTES = 200 * 1024 * 1024
const READ_LIMIT = 24000

/* ---------- text helpers ---------- */

/** Named entities that show up in EPUB text: the HTML 4 set (Latin-1, Greek, math, arrows, typography). */
const ENTITIES = (() => {
  const table = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
  // Runs of names for consecutive code points.
  const runs = {
    0xa0: 'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest ' +
      'Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig ' +
      'agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml',
    0x391: 'Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho - Sigma Tau Upsilon Phi Chi Psi Omega',
    0x3b1: 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf sigma tau upsilon phi chi psi omega',
    0x2002: 'ensp emsp - - - - - thinsp - - zwnj zwj lrm rlm - - - ndash mdash - - - lsquo rsquo sbquo - ldquo rdquo bdquo - dagger Dagger bull - - - hellip',
    0x2190: 'larr uarr rarr darr harr',
    0x21d0: 'lArr uArr rArr dArr hArr',
    0x2200: 'forall - part exist - empty - nabla isin notin - ni - - - prod - sum minus - - - - lowast - - radic - - prop infin - ang',
    0x2227: 'and or cap cup int',
    0x2282: 'sub sup nsub - sube supe',
    0x2308: 'lceil rceil lfloor rfloor',
    0x2660: 'spades - - clubs - hearts diams',
  }
  for (const [start, names] of Object.entries(runs)) {
    names.split(' ').forEach((name, i) => { if (name !== '-') table[name] = String.fromCodePoint(Number(start) + i) })
  }
  const single = {
    OElig: 0x152, oelig: 0x153, Scaron: 0x160, scaron: 0x161, Yuml: 0x178, fnof: 0x192, circ: 0x2c6, tilde: 0x2dc,
    thetasym: 0x3d1, upsih: 0x3d2, piv: 0x3d6, permil: 0x2030, prime: 0x2032, Prime: 0x2033, lsaquo: 0x2039, rsaquo: 0x203a,
    oline: 0x203e, frasl: 0x2044, euro: 0x20ac, image: 0x2111, weierp: 0x2118, real: 0x211c, trade: 0x2122, alefsym: 0x2135,
    crarr: 0x21b5, there4: 0x2234, sim: 0x223c, cong: 0x2245, asymp: 0x2248, ne: 0x2260, equiv: 0x2261, le: 0x2264, ge: 0x2265,
    oplus: 0x2295, otimes: 0x2297, perp: 0x22a5, sdot: 0x22c5, lang: 0x27e8, rang: 0x27e9, loz: 0x25ca,
  }
  for (const [name, code] of Object.entries(single)) table[name] = String.fromCodePoint(code)
  return table
})()

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (all, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all
    }
    // Names are case-sensitive (&Eacute; vs &eacute;); fall back to lower case for sloppy markup like &AMP;.
    return ENTITIES[code] ?? ENTITIES[code.toLowerCase()] ?? all
  })
}

/** Text file bytes → string: UTF-8 (BOM stripped), or GB18030 when the bytes are not valid UTF-8. */
export function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('gb18030').decode(bytes)
  }
}

/** XHTML chapter → readable text, keeping paragraph and heading breaks. */
export function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<head[\s\S]*?<\/head>/gi, '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<(h[1-6])[^>]*>/gi, '\n\n## ')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section|pre|table)>/gi, '\n\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t\u00a0\u2002-\u200a]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Split one section into blocks at paragraph boundaries. */
export function chunk(text, max = BLOCK_CHARS) {
  const parts = []
  let current = ''
  for (const para of text.split(/\n{2,}/)) {
    if (current && current.length + para.length + 2 > max) {
      parts.push(current)
      current = ''
    }
    if (para.length > max) {
      for (let i = 0; i < para.length; i += max) parts.push(para.slice(i, i + max))
    } else {
      current = current ? `${current}\n\n${para}` : para
    }
  }
  if (current.trim()) parts.push(current)
  return parts
}

/** Sections `[{title, text, loc?}]` → numbered blocks. */
function toBlocks(sections) {
  const blocks = []
  for (const section of sections) {
    const parts = chunk(section.text)
    parts.forEach((text, i) => {
      // Name a split block after the first subheading it contains, so long chapters stay navigable.
      const sub = parts.length > 1 ? [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim()).find((h) => h !== section.title) : undefined
      blocks.push({
        n: blocks.length + 1,
        title: parts.length > 1 ? `${section.title}（${i + 1}/${parts.length}）${sub ? ` · ${sub}` : ''}` : section.title,
        loc: section.loc,
        text,
      })
    })
  }
  return blocks
}

/* ---------- formats ---------- */

export function parseText(text, title) {
  const sections = []
  let current = { title, text: '' }
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading) {
      if (current.text.trim()) sections.push(current)
      current = { title: heading[2].trim(), text: '' }
    } else {
      current.text += line + '\n'
    }
  }
  if (current.text.trim()) sections.push(current)
  return sections.map((s) => ({ ...s, text: s.text.trim() }))
}

function attr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag)
  return m ? decodeEntities(m[2] ?? m[3]) : undefined
}

function stripFragment(href) {
  return decodeURIComponent(href.split('#')[0])
}

/** EPUB → sections in spine order, titled from the nav document or NCX. */
export function parseEpub(bytes) {
  const files = unzipSync(bytes)
  const read = (path) => {
    const entry = files[path]
    if (!entry) throw new Error(`EPUB is missing ${path}`)
    return strFromU8(entry)
  }
  const container = read('META-INF/container.xml')
  const opfPath = attr(/<rootfile\b[^>]*>/i.exec(container)?.[0] ?? '', 'full-path')
  if (!opfPath) throw new Error('EPUB container.xml has no rootfile')
  const opf = read(opfPath)
  const base = posix.dirname(opfPath)
  const at = (href) => posix.normalize(posix.join(base, href))

  const manifest = new Map()
  for (const [tag] of opf.matchAll(/<item\b[^>]*>/gi)) {
    manifest.set(attr(tag, 'id'), { href: attr(tag, 'href'), type: attr(tag, 'media-type'), props: attr(tag, 'properties') ?? '' })
  }
  const title = decodeEntities(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf)?.[1]?.trim() ?? '')

  // Titles by chapter file, from EPUB 3 nav or EPUB 2 NCX.
  const titles = new Map()
  const nav = [...manifest.values()].find((m) => m.props.split(/\s+/).includes('nav'))
  if (nav) {
    const navPath = at(nav.href)
    const navBase = posix.dirname(navPath)
    for (const [, href, label] of read(navPath).matchAll(/<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const file = posix.normalize(posix.join(navBase, stripFragment(href)))
      if (!titles.has(file)) titles.set(file, htmlToText(label))
    }
  }
  const ncx = [...manifest.values()].find((m) => m.type === 'application/x-dtbncx+xml')
  if (!titles.size && ncx) {
    const ncxPath = at(ncx.href)
    const ncxBase = posix.dirname(ncxPath)
    for (const [, point] of read(ncxPath).matchAll(/<navPoint\b[\s\S]*?(<navLabel>[\s\S]*?<content[^>]*>)/gi)) {
      const label = htmlToText(/<text>([\s\S]*?)<\/text>/i.exec(point)?.[1] ?? '')
      const src = attr(/<content[^>]*>/i.exec(point)?.[0] ?? '', 'src')
      if (!src) continue
      const file = posix.normalize(posix.join(ncxBase, stripFragment(src)))
      if (!titles.has(file)) titles.set(file, label)
    }
  }

  const sections = []
  let lastTitle = title || '正文'
  for (const [tag] of opf.matchAll(/<itemref\b[^>]*>/gi)) {
    const item = manifest.get(attr(tag, 'idref'))
    if (!item || !/x?html/.test(item.type ?? '')) continue
    const file = at(stripFragment(item.href))
    if (!files[file]) continue
    const text = htmlToText(read(file))
    if (!text) continue
    const own = titles.get(file)
    const heading = own ?? /^## (.+)$/m.exec(text)?.[1]?.trim()
    lastTitle = heading || lastTitle
    sections.push({ title: lastTitle, text, loc: file })
  }
  if (!sections.length) throw new Error('EPUB has no readable chapters')
  return { title, sections }
}

/** PDF → sections by outline when it has one, else by groups of pages. */
export async function parsePdf(bytes) {
  const { getDocumentProxy, extractText } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(bytes))
  const { totalPages, text } = await extractText(pdf, { mergePages: false })
  const pages = text.map((t) => t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim())
  if (!pages.some((p) => p.length > 0)) {
    throw new Error('this PDF has no extractable text (likely scanned images); OCR is not supported yet — ask the learner for a text version')
  }
  const starts = await outlineStarts(pdf)
  let sections
  if (starts.length >= 2) {
    sections = starts.map((s, i) => {
      const end = (starts[i + 1]?.page ?? totalPages + 1) - 1
      const last = Math.max(s.page, end)
      return { title: s.title, loc: `p.${s.page}–${last}`, text: pages.slice(s.page - 1, last).join('\n\n') }
    })
    if (starts[0].page > 1) sections.unshift({ title: '前置页', loc: `p.1–${starts[0].page - 1}`, text: pages.slice(0, starts[0].page - 1).join('\n\n') })
  } else {
    sections = []
    for (let i = 0; i < pages.length; i += 5) {
      const last = Math.min(i + 5, pages.length)
      sections.push({ title: `第 ${i + 1}–${last} 页`, loc: `p.${i + 1}–${last}`, text: pages.slice(i, last).join('\n\n') })
    }
  }
  return { title: '', sections: sections.filter((s) => s.text.trim()) }
}

async function outlineStarts(pdf) {
  try {
    const outline = await pdf.getOutline()
    if (!outline?.length) return []
    const starts = []
    for (const item of outline) {
      let dest = item.dest
      if (typeof dest === 'string') dest = await pdf.getDestination(dest)
      if (!Array.isArray(dest) || !dest[0]) continue
      const index = typeof dest[0] === 'number' ? dest[0] : await pdf.getPageIndex(dest[0])
      starts.push({ title: item.title.trim() || `第 ${index + 1} 页`, page: index + 1 })
    }
    return starts.sort((a, b) => a.page - b.page).filter((s, i, all) => i === 0 || s.page !== all[i - 1].page)
  } catch {
    return []
  }
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.learn', 'dist', 'build', 'out', 'target', 'vendor', '.venv', 'venv', '__pycache__', '.next', '.cache', 'coverage', '.idea', '.vscode'])
const MANIFESTS = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'Gemfile', 'composer.json', 'requirements.txt', 'setup.py', 'CMakeLists.txt', 'Makefile']
const DOCS = /^(readme|architecture|contributing|design|overview)(\.[a-z]+)?$/i

/** Code repository → a file tree, its README-like docs, and build manifests. Source files are read with the fs tools. */
export async function parseRepo(dir, { maxFiles = 1500 } = {}) {
  const tree = []
  const docs = []
  const counts = new Map()
  async function walk(rel, depth) {
    if (tree.length >= maxFiles) return
    const entries = (await readdir(join(dir, rel), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (tree.length >= maxFiles) return
      const path = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        tree.push(`${'  '.repeat(depth)}${entry.name}/`)
        await walk(path, depth + 1)
      } else if (entry.isFile()) {
        tree.push(`${'  '.repeat(depth)}${entry.name}`)
        const ext = extname(entry.name).toLowerCase() || entry.name
        counts.set(ext, (counts.get(ext) ?? 0) + 1)
        if ((depth === 0 && (MANIFESTS.includes(entry.name) || DOCS.test(entry.name))) || (depth <= 1 && /^docs?$/.test(rel) && /\.(md|txt|rst)$/i.test(entry.name))) {
          docs.push(path)
        }
      }
    }
  }
  await walk('', 0)
  const langs = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([ext, n]) => `${ext} ×${n}`).join('，')
  const sections = [{ title: '目录结构', loc: '.', text: `文件类型：${langs}\n\n${tree.join('\n')}${tree.length >= maxFiles ? '\n…（已截断）' : ''}` }]
  for (const path of docs.slice(0, 20)) {
    const text = await readFile(join(dir, path)).then(decodeText, () => '')
    if (text.trim()) sections.push(...parseText(text, path).map((s) => ({ ...s, title: s.title === path ? path : `${path} · ${s.title}`, loc: path })))
  }
  return { title: basename(dir), sections }
}

/* ---------- tools ---------- */

function inWorkspace(cwd, path) {
  const abs = isAbsolute(path) ? path : resolve(cwd, path)
  const rel = relative(cwd, abs)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`${path} is outside the workspace ${cwd}. Ask the learner to copy the file into the workspace (or attach it here) and try again.`)
  }
  return abs
}

const KIND_BY_EXT = { '.pdf': 'pdf', '.epub': 'epub', '.txt': 'text', '.md': 'text', '.markdown': 'text', '.rst': 'text' }

async function loadMaterial(cwd, id) {
  const meta = await store.readJson(join(store.paths(cwd).material(id), 'meta.json'), null)
  if (!meta) throw new Error(`unknown material ${JSON.stringify(id)}: see material_list`)
  return meta
}

function parseBlockRef(ref, fallbackId) {
  const m = /^(?:([A-Za-z0-9._-]+)#)?(\d+)$/.exec(String(ref).trim())
  if (!m) throw new Error(`invalid block ref ${JSON.stringify(ref)}: use "<materialId>#<n>" or a number`)
  const id = m[1] ?? fallbackId
  if (!id) throw new Error(`block ref ${ref} needs a material id`)
  return { id, n: Number(m[2]) }
}

export const ingestMaterial = {
  name: 'ingest_material',
  description:
    'Import a learning material from the workspace — a PDF, EPUB, TXT/Markdown file, or a code repository directory — into numbered blocks. ' +
    'Returns its table of contents with block ids; read blocks with material_read and cite them as sources. Unchanged content reuses its id; changed content gets a new id so existing citations stay valid.',
  parameters: {
    path: { type: 'string', required: true, description: '工作区内的文件或目录路径' },
    title: { type: 'string', description: '材料标题；省略则从文件中读取' },
  },
  async execute(args, env) {
    const abs = inWorkspace(env.cwd, args.path)
    const info = await stat(abs).catch(() => null)
    if (!info) throw new Error(`no such file or directory: ${args.path}`)
    let kind
    let parsed
    if (info.isDirectory()) {
      kind = 'repo'
      parsed = await parseRepo(abs)
    } else {
      kind = KIND_BY_EXT[extname(abs).toLowerCase()]
      if (!kind) throw new Error(`unsupported file type ${extname(abs) || '(none)'}: supported are .pdf, .epub, .txt, .md, and directories (code repositories)`)
      if (info.size > MAX_FILE_BYTES) throw new Error(`file is too large (${Math.round(info.size / 1048576)} MiB, limit ${MAX_FILE_BYTES / 1048576} MiB)`)
      const bytes = await readFile(abs)
      if (kind === 'pdf') parsed = await parsePdf(bytes)
      else if (kind === 'epub') parsed = parseEpub(new Uint8Array(bytes))
      else parsed = { title: '', sections: parseText(decodeText(bytes), basename(abs)) }
    }
    const blocks = toBlocks(parsed.sections)
    if (!blocks.length) throw new Error('no readable text found in this material')

    const relPath = relative(env.cwd, abs) || '.'
    const history = (await listMaterials(env.cwd, { includeHistory: true })).filter((m) => m.path === relPath)
    const hash = blockHash(blocks)
    let existing
    for (const material of history) {
      // Older imports have no hash. Compare their stored blocks without changing their refs.
      const oldHash = material.hash ?? blockHash(await store.readJson(join(store.paths(env.cwd).material(material.id), 'blocks.json'), []))
      if (oldHash === hash) { existing = material; break }
    }
    const id = existing?.id ?? store.newId('m')
    const dir = store.paths(env.cwd).material(id)
    const meta = {
      id, kind, path: relPath, title: args.title || parsed.title || basename(abs),
      chars: blocks.reduce((n, b) => n + b.text.length, 0),
      blocks: blocks.map(({ n, title, loc, text }) => ({ n, title, loc, chars: text.length })),
      hash,
      revision: Math.max(0, ...history.map((m) => m.revision ?? 0)) + 1,
      ingestedAt: env.now().toISOString(),
    }
    if (!existing) await store.writeJson(join(dir, 'blocks.json'), blocks)
    await store.writeJson(join(dir, 'meta.json'), meta)
    return `${existing ? '已重新导入' : '已导入'}「${meta.title}」（${kind}，${blocks.length} 块，约 ${meta.chars} 字），id=${id}。\n\n${tocText(meta)}`
  },
}

function tocText(meta, limit = 200) {
  const rows = meta.blocks.slice(0, limit).map((b) => `- ${meta.id}#${b.n} ${b.title}${b.loc && meta.kind === 'pdf' ? `（${b.loc}）` : ''} · ${b.chars} 字`)
  if (meta.blocks.length > limit) rows.push(`…另有 ${meta.blocks.length - limit} 块`)
  return rows.join('\n')
}

function blockHash(blocks) {
  return createHash('sha256').update(JSON.stringify(blocks)).digest('hex')
}

/** Latest import per path by default; old ids remain available through material_read. */
export async function listMaterials(cwd, { includeHistory = false } = {}) {
  const dir = store.paths(cwd).materialsDir
  const names = await readdir(dir).catch((error) => (error.code === 'ENOENT' ? [] : Promise.reject(error)))
  const metas = []
  for (const name of names) {
    const meta = await store.readJson(join(dir, name, 'meta.json'), null)
    if (meta) metas.push(meta)
  }
  metas.sort((a, b) => (b.revision ?? 0) - (a.revision ?? 0) || b.ingestedAt.localeCompare(a.ingestedAt) || a.id.localeCompare(b.id))
  if (includeHistory) return metas
  const seen = new Set()
  return metas.filter((meta) => {
    if (seen.has(meta.path)) return false
    seen.add(meta.path)
    return true
  })
}

export const materialList = {
  name: 'material_list',
  description: 'List imported materials, or show one material\'s table of contents when materialId is given.',
  parameters: { materialId: { type: 'string', description: '材料 id；给出时返回其目录' } },
  readOnly: true,
  async execute(args, env) {
    if (args.materialId) {
      const meta = await loadMaterial(env.cwd, args.materialId)
      return `「${meta.title}」（${meta.kind}，${meta.path}）\n\n${tocText(meta, 1000)}`
    }
    const metas = await listMaterials(env.cwd)
    if (!metas.length) return '尚未导入材料。'
    return metas.map((m) => `- ${m.id}「${m.title}」${m.kind}，${m.blocks.length} 块，${m.path}`).join('\n')
  },
}

export const materialRead = {
  name: 'material_read',
  description:
    'Read material blocks by reference ("m-xxxx#3", or bare numbers together with materialId). Read only what the current knowledge point needs; ' +
    'base explanations and examples on these blocks and cite their ids.',
  parameters: {
    materialId: { type: 'string', description: '默认材料 id（blocks 里写裸数字时使用）' },
    blocks: { type: 'array', required: true, items: { type: 'string' }, description: '块引用，如 ["m-ab12#3", "m-ab12#4"] 或 ["3","4"]' },
  },
  readOnly: true,
  async execute(args, env) {
    const out = []
    let total = 0
    const cache = new Map()
    for (const ref of args.blocks) {
      const { id, n } = parseBlockRef(ref, args.materialId)
      if (!cache.has(id)) {
        await loadMaterial(env.cwd, id)
        cache.set(id, await store.readJson(join(store.paths(env.cwd).material(id), 'blocks.json'), []))
      }
      const block = cache.get(id).find((b) => b.n === n)
      if (!block) throw new Error(`material ${id} has no block ${n}`)
      if (total + block.text.length > READ_LIMIT && out.length) {
        out.push(`（已达单次读取上限，剩余块请再次调用：${args.blocks.slice(args.blocks.indexOf(ref)).join(', ')}）`)
        break
      }
      total += block.text.length
      out.push(`### ${id}#${n} ${block.title}${block.loc ? `（${block.loc}）` : ''}\n\n${block.text}`)
    }
    return out.join('\n\n---\n\n')
  },
}

export const materialSearch = {
  name: 'material_search',
  description: 'Find blocks matching any keyword in their title or text, ranked by keyword coverage, title matches, then frequency. Returns block ids and snippets; read the blocks before citing them.',
  parameters: {
    query: { type: 'string', required: true, description: '关键词，空格分隔；部分命中也返回，覆盖更多关键词的块优先' },
    materialId: { type: 'string', description: '只搜某个材料' },
    limit: { type: 'integer', description: '最多返回几块，默认 10' },
  },
  readOnly: true,
  async execute(args, env) {
    const terms = [...new Set(args.query.toLowerCase().split(/\s+/).filter(Boolean))]
    if (!terms.length) throw new Error('query is empty')
    const metas = args.materialId ? [await loadMaterial(env.cwd, args.materialId)] : await listMaterials(env.cwd)
    const hits = []
    for (const meta of metas) {
      const blocks = await store.readJson(join(store.paths(env.cwd).material(meta.id), 'blocks.json'), [])
      for (const block of blocks) {
        const lower = block.text.toLowerCase()
        const title = block.title.toLowerCase()
        const matched = terms.filter((t) => lower.includes(t) || title.includes(t))
        if (!matched.length) continue
        const titleMatches = matched.filter((t) => title.includes(t)).length
        const frequency = matched.reduce((n, t) => n + lower.split(t).length - 1, 0)
        const positions = matched.map((t) => lower.indexOf(t)).filter((at) => at >= 0)
        const at = positions.length ? Math.min(...positions) : 0
        const snippet = block.text.slice(Math.max(0, at - 60), at + 120).replace(/\s+/g, ' ')
        hits.push({ ref: `${meta.id}#${block.n}`, title: block.title, coverage: matched.length, titleMatches, frequency, snippet })
      }
    }
    if (!hits.length) return `没有匹配「${terms.join(' ')}」的块。`
    hits.sort((a, b) => b.coverage - a.coverage || b.titleMatches - a.titleMatches || b.frequency - a.frequency || a.ref.localeCompare(b.ref))
    return hits.slice(0, args.limit ?? 10).map((h) => `- ${h.ref} ${h.title}：…${h.snippet}…`).join('\n')
  },
}

/** Check local block refs against the same reader; URLs are checked by the tutor/checker. */
export async function validateSources(cwd, sources = []) {
  const refs = [...new Set(sources.map((source) => source.trim()))]
  for (const ref of refs) {
    if (/^https?:\/\//i.test(ref)) {
      new URL(ref)
    } else {
      await materialRead.execute({ blocks: [ref] }, { cwd })
    }
  }
  return refs
}

export const INGEST_TOOLS = [ingestMaterial, materialList, materialRead, materialSearch]
