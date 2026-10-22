import { parseArgs } from 'node:util';
import { Accounts } from './accounts.mjs';
import { RunRecovery } from './runs.mjs';
import { DockerEngine, DockerWorkerRecovery } from './docker-workers.mjs';
import { ModelGrants } from './model-grants.mjs';
import { RunModelRecovery } from './run-model-outlet.mjs';
import { HostControlClient } from './host-control-client.mjs';
import { ExecutionController } from './execution-controller.mjs';
import { startScheduler } from './scheduler.mjs';
import { readControllerConfig, inspectControllerPaths } from './controller-config.mjs';

let stopRequested = false, requestStop;
const stopping = new Promise(resolve => { requestStop = resolve; });
const signal = () => { stopRequested = true; requestStop(); };
process.on('SIGINT', signal); process.on('SIGTERM', signal);
let accounts, controller, initialized = false, scheduler, phase = 'configuration', failed = false;
const report = code => { failed = true; console.error(code); };
try {
  const { values } = parseArgs({ options: { once: { type: 'boolean' } }, allowPositionals: false });
  const config = readControllerConfig();
  await inspectControllerPaths(config);
  phase = 'startup';
  if (!stopRequested) {
    accounts = new Accounts(config.databaseUrl);
    // pg emits errors from idle clients outside awaited queries. Keep diagnostics
    // sanitized and request the same draining shutdown as an operator signal.
    accounts.pool.on('error', () => { report('controller_database_failed'); signal(); });
    // Existing schema only: migrations are an explicit, separate operator action.
    await accounts.pool.query(`SELECT r.id,r.owner_id,r.vault_id,r.conversation_id,r.state,r.worker_id,
      r.lease_digest,r.lease_until,r.deadline_at,r.reason,a.disabled,g.run_id,g.revoked_at
      FROM corilo_private.runs r JOIN corilo_private.accounts a ON a.id=r.owner_id
      LEFT JOIN corilo_private.model_grants g ON g.run_id=r.id WHERE false`);
    await accounts.pool.query('SELECT run_id,state,reason FROM corilo_private.run_events WHERE false');
    const engine = new DockerEngine('/var/run/docker.sock');
    const version = await engine.request('GET', '/version');
    if (!version || typeof version.ApiVersion !== 'string') throw new Error('Docker unavailable');
    if (!stopRequested) {
      const client = new HostControlClient({ socketPath: config.hostSocket, token: config.hostToken });
      controller = new ExecutionController({ runs: new RunRecovery(accounts.pool),
        workers: new DockerWorkerRecovery({ engine, journalRoot: config.journalRoot }),
        modelOutlet: new RunModelRecovery({ grants: new ModelGrants(accounts.pool), socketRoot: config.socketRoot }),
        hostFor: claim => client.forRun(claim),
      });
      phase = 'recovery';
      if (values.once) {
        await controller.init(); initialized = true;
        if (!stopRequested) {
          await controller.recover();
          console.log('controller_recovery_pass_complete');
        }
      } else {
        scheduler = await startScheduler({ controller, recoveryOnly: true, pollMs: config.pollMs, retryMs: config.retryMs,
          onError: () => report('controller_recovery_failed') });
        // This states that the loop started, not that all dependencies/leases are healthy.
        console.log('controller_recovery_loop_started');
        if (!stopRequested) await stopping;
      }
    }
  }
} catch {
  report(phase === 'configuration' ? 'controller_configuration_failed' : phase === 'startup' ? 'controller_startup_failed' : 'controller_recovery_failed');
} finally {
  // A signal during startup/recovery only latches; it cannot release the process
  // lock or pool while an authorized recovery operation is still in flight.
  try {
    if (scheduler) await scheduler.close();
    else if (initialized) await controller.close();
  } catch { report('controller_shutdown_failed'); }
  try { await accounts?.close(); } catch { report('controller_shutdown_failed'); }
  process.removeListener('SIGINT', signal); process.removeListener('SIGTERM', signal);
  if (failed) process.exitCode = 1;
}
