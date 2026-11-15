// Read-only previews of incomplete tool JSON; the Host still validates the final arguments.
export function partialJson(text) {
  let at = 0
  const space = () => { while (/\s/.test(text[at] ?? '') && at < text.length) at++ }
  const string = () => {
    const start = at++
    while (at < text.length) {
      if (text[at] === '"') return JSON.parse(text.slice(start, ++at))
      if (text[at] === '\\') {
        const end = at + (text[at + 1] === 'u' ? 6 : 2)
        if (end > text.length) {
          const prefix = text.slice(start, at)
          at = text.length
          return JSON.parse(prefix + '"')
        }
        at = end
      } else at++
    }
    return JSON.parse(text.slice(start) + '"')
  }
  const value = () => {
    space()
    if (at === text.length) return undefined
    if (text[at] === '"') return string()
    if (text[at] === '{' || text[at] === '[') {
      const object = text[at++] === '{'
      const result = object ? Object.create(null) : []
      const end = object ? '}' : ']'
      space()
      while (at < text.length && text[at] !== end) {
        let key
        if (object) {
          if (text[at] !== '"') throw new Error('Expected key')
          key = string()
          space()
          if (at === text.length) break
          if (text[at++] !== ':') throw new Error('Expected colon')
        }
        const next = value()
        if (next !== undefined) {
          if (object) result[key] = next
          else result.push(next)
        }
        space()
        if (at === text.length || text[at] === end) break
        if (text[at++] !== ',') throw new Error('Expected comma')
        space()
      }
      if (text[at] === end) at++
      return result
    }
    const start = at
    while (at < text.length && !/[\s,\]}]/.test(text[at])) at++
    // A scalar at the boundary might still grow (e.g. 1 → 10).
    return at === text.length ? undefined : JSON.parse(text.slice(start, at))
  }
  try {
    const result = value()
    space()
    return at === text.length ? result : undefined
  } catch {
    return undefined
  }
}

export function outlinePreview(args) {
  if (typeof args?.goal !== 'string') return null
  return {
    view: 'outline', goal: args.goal, status: args.status,
    chapters: (Array.isArray(args.chapters) ? args.chapters : []).map((ch, i) => ({
      id: `ch${i + 1}`, title: typeof ch?.title === 'string' ? ch.title : '',
      kps: (Array.isArray(ch?.kps) ? ch.kps : []).filter((kp) => typeof kp?.title === 'string').map((kp, j) => ({
        id: kp.id ?? `kp${j}`, title: kp.title, kind: kp.kind,
        estMinutes: typeof kp.estMinutes === 'number' ? kp.estMinutes : undefined,
        prerequisites: Array.isArray(kp.prerequisites) ? kp.prerequisites.filter((id) => typeof id === 'string') : [],
      })),
    })),
    resources: (Array.isArray(args.resources) ? args.resources : []).filter((r) => typeof r?.title === 'string').map((r) => ({
      title: r.title, url: typeof r.url === 'string' ? r.url : '', note: typeof r.note === 'string' ? r.note : '',
    })),
  }
}
