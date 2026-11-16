/** Authenticated UI actions resolve paths exclusively through an existing host session. */
import { readTargetMap, saveTargetMap } from './target-edit.js'
import { readOutline, saveOutline } from './tools/course.js'
import { withWorkspaceWrite } from './store.js'

export const name = 'learn-anything-ui'
export function registerLearningApi(ctx, outline) {
  const actions = {
    'target/read': (cwd, args) => readTargetMap(cwd, args.kpId),
    'target/save': saveTargetMap,
    ...(outline ? { 'outline/read': outline.readOutline, 'outline/save': outline.saveOutline } : {}),
  }
  for (const [action, run] of Object.entries(actions)) ctx.effect(() => ctx.connection.fetch.register({
    path: `/api/learn-anything/${action}`, methods: ['POST'], requestBody: 'streaming',
    async fetch(request) {
      const headers = { 'cache-control': 'no-store' }
      if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return new Response('JSON required', { status: 415 })
      let args
      try {
        const reader = request.body?.getReader()
        if (!reader) return new Response('JSON required', { status: 400 })
        const chunks = []; let size = 0
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.byteLength
          if (size > 256000) { await reader.cancel(); return new Response('Request too large', { status: 413 }) }
          chunks.push(Buffer.from(chunk.value))
        }
        args = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch { return new Response('Invalid JSON', { status: 400 }) }
      if (!args || typeof args.sessionId !== 'string') return new Response('Session required', { status: 400 })
      const session = ctx.sessions.get(args.sessionId)
      if (!session?.header.cwd) return new Response('Session unavailable', { status: 404 })
      if (session.header.agentPreset !== 'learn-tutor' || session.header.origin === 'subagent') return new Response('Tutor session required', { status: 403 })
      try {
        const value = await withWorkspaceWrite(session.header.cwd, async () => {
          request.signal.throwIfAborted()
          return run(session.header.cwd, args)
        })
        return Response.json({ ok: true, value }, { headers })
      } catch (error) {
        const status = [400, 409].includes(error.status) ? error.status : 503
        return Response.json({ ok: false, error: { message: status === 503 ? 'Learning notes unavailable. Your draft is retained; reopen to check the saved version.' : error.message } }, { status, headers })
      }
    },
  }))
}
export function apply(ctx) {
  ctx.inject(['connection', 'sessions'], (scope) => registerLearningApi(scope, { readOutline, saveOutline }))
}
