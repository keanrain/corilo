/** A deliberately conservative, line-based architecture index; not a language parser.
 * Signatures carry file/line provenance and are never evaluated. Multiline declarations
 * are collected up to a small bound; comments and strings may still cause false positives.
 */
export function extractSymbols(text, path) {
  const extension = path.split('.').pop().toLowerCase()
  const patterns = {
    js: /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function\s*\*?\s+\w+|class\s+\w+)|^\s*export\s+(?:const|let|var|\{|\*)/,
    ts: /^\s*(?:export\s+(?:default\s+)?)?(?:(?:declare|abstract|async)\s+)*(?:function\s*\*?\s+\w+|class\s+\w+|interface\s+\w+|type\s+\w+)|^\s*export\s+(?:const|let|var|\{|\*)/,
    py: /^\s*(?:async\s+)?(?:def|class)\s+\w+/,
    rs: /^\s*pub(?:\([^)]*\))?\s+(?:(?:async|unsafe)\s+)*(?:fn|struct|enum|trait|type|mod)\s+\w+/,
    go: /^\s*(?:func\s+(?:\([^)]*\)\s*)?\w+|type\s+\w+\s+(?:struct|interface))/,
  }
  const pattern = patterns[extension === 'tsx' ? 'ts' : ['jsx', 'mjs', 'cjs'].includes(extension) ? 'js' : extension]
  if (!pattern) return []
  const lines = text.split(/\r?\n/)
  const symbols = []
  for (let i = 0; i < lines.length && symbols.length < 80; i++) {
    if (!pattern.test(lines[i])) continue
    let signature = lines[i].trim()
    if (/\(/.test(signature) && !/\)/.test(signature)) {
      for (let j = i + 1; j < Math.min(lines.length, i + 8) && signature.length < 500; j++) {
        signature += ` ${lines[j].trim()}`
        if (/\)/.test(lines[j])) break
      }
    }
    // Omit executable function bodies while retaining parameter/object type signatures.
    signature = signature.replace(/\)\s*(?::\s*[^{]+)?\s*\{.*$/, (match) => match.slice(0, match.indexOf('{')).trim()).replace(/\s*=>.*$/, ' => …')
    symbols.push(`${path}:${i + 1} ${signature.slice(0, 500)}`)
  }
  return symbols
}
