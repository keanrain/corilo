#!/usr/bin/env node
import { migrateStore, exportStore, recoverStore } from './migrate.js'

const HELP = `Usage: corilo-learn-store <migrate|export|recover> --workspace <directory> [options]

  migrate              Preview legacy JSON/JSONL import; writes nothing by default
    --apply            Back up and explicitly import into .learn/learner.sqlite
  export --output DIR  Export current SQLite learner records to a NEW directory
  recover              Inspect an interrupted store initialization or migration
    --apply            Explicitly recover verified publication / abort pending import

Stop all services using this workspace before migrate --apply or recover --apply.
Concurrent recovery applies are rejected; process exit releases the recovery lock.
Never delete or replace .learn/.recovery-lock.sqlite while a recovery is running.
Original JSON/JSONL remains unchanged. Materials are not included in this learner-only backup/export.
To roll back after new learning, export current SQLite state to a separate workspace;
do not delete the live database and fall back to stale retained JSON files.
`
try {
  const [action, ...options] = process.argv.slice(2)
  if (!action || action === '--help' || action === '-h') { console.log(HELP); process.exit(0) }
  let workspace, output, apply = false
  for (let i = 0; i < options.length; i++) {
    const key = options[i]
    if (key === '--apply' && !apply) apply = true
    else if (key === '--workspace' && !workspace && options[i + 1] && !options[i + 1].startsWith('--')) workspace = options[++i]
    else if (key === '--output' && !output && options[i + 1] && !options[i + 1].startsWith('--')) output = options[++i]
    else throw new Error('Unknown, duplicate or incomplete option; use --help')
  }
  if (!workspace) throw new Error('--workspace is required')
  if (!['migrate', 'export', 'recover'].includes(action) || (action !== 'export' && output) || (action === 'export' && apply)) throw new Error('Invalid command/options; use --help')
  const result = action === 'migrate' ? await migrateStore(workspace, { apply }) : action === 'export' ? await exportStore(workspace, output) : await recoverStore(workspace, { apply })
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(`Learner store: ${error.message}`)
  process.exitCode = 1
}
