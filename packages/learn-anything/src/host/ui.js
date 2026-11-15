/**
 * Host half of the learn-anything Web surface. The browser half ships via
 * exports["./client"], discovered through package.json `dsh.client`; this row
 * only has to be active in the host tree so the client module is served.
 * The tutor's tools live in `@corilo/learn-anything/tools`, mounted inside the preset.
 *
 * Launch workspace: the `learn-anything` launcher sets LEARN_ANYTHING_WORKSPACE to
 * the folder it was run in. That folder is registered as a Workspace (the registry
 * returns the existing one for a known path) and handed to the browser half as the
 * `__LEARN_ANYTHING_LAUNCH__` boot global, which opens it once per launch.
 * @module learn-anything
 */
export const name = 'learn-anything-ui'

const LAUNCH_GLOBAL = '__LEARN_ANYTHING_LAUNCH__'

export function apply(ctx) {
  const dir = process.env.LEARN_ANYTHING_WORKSPACE
  if (!dir) return
  const launchId = `${process.pid}-${Date.now()}`
  ctx.inject(['workspaceRegistry'], async (ctx) => {
    let workspace
    try {
      workspace = await ctx.workspaceRegistry.create(dir)
    } catch (error) {
      console.warn(`learn-anything: 无法把 ${dir} 设为工作区：${error?.message ?? error}`)
      return
    }
    ctx.on('webserver/index-inject', (table) => {
      table.push({ kind: 'global', name: LAUNCH_GLOBAL, value: { launchId, workspaceId: workspace.id } })
    })
  })
}
