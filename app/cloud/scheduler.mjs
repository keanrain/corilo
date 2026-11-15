// Internal lifecycle only: callers supply the trusted controller and shared file
// gate transport. This is not a public API or an independently deployable daemon.
export async function startScheduler({ controller, concurrency = 1, pollMs = 250, retryMs = 1000, recoveryOnly = false, onError = () => {} }) {
  if (typeof recoveryOnly !== 'boolean') throw new Error('Invalid scheduler recovery mode');
  if (!controller || ['init', 'recover', 'close', ...(recoveryOnly ? [] : ['executeNext'])].some(name => typeof controller[name] !== 'function'))
    throw new Error('Controller lifecycle required');
  for (const [name, value, min, max] of [['concurrency', concurrency, 1, 1000], ['pollMs', pollMs, 20, 5000], ['retryMs', retryMs, 100, 60000]]) {
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid scheduler ${name}`);
  }
  if (retryMs < pollMs || typeof onError !== 'function') throw new Error('Invalid scheduler retry configuration');
  let closing = false, phase = 'starting', active = 0, shutdownFailure = false, closeTask, wake, recoveryTask;
  const report = code => { try { Promise.resolve(onError({ code })).catch(() => {}); } catch { /* Diagnostics cannot change execution ownership. */ } };
  const pause = ms => new Promise(resolve => {
    if (closing) return resolve();
    const timer = setTimeout(done, ms);
    function done() { clearTimeout(timer); if (wake === done) wake = undefined; resolve(); }
    wake = done;
  });
  // init owns the controller's process lock. Failed init does not authorize close
  // against an object whose initialization/ownership was never established.
  await controller.init();
  const loop = (async () => {
    while (!closing) {
      phase = 'recovering';
      try { recoveryTask = Promise.resolve().then(() => controller.recover()); await recoveryTask; }
      catch {
        if (closing) shutdownFailure = true;
        report('recovery_failed'); phase = 'retrying'; await pause(retryMs); continue;
      }
      finally { recoveryTask = undefined; }
      if (closing) break;
      if (recoveryOnly) { phase = 'idle'; await pause(pollMs); continue; }
      phase = 'executing';
      // Conservative batches keep recovery strictly idle. A slow task delays the
      // next admission batch; the database remains the global capacity authority.
      const tasks = [];
      for (let i = 0; i < concurrency && !closing; i++) {
        active++;
        tasks.push(Promise.resolve().then(() => closing ? null : controller.executeNext())
          .finally(() => { active--; }));
      }
      const results = await Promise.allSettled(tasks);
      const failed = results.some(result => result.status === 'rejected');
      if (failed) report('execution_failed');
      if (closing) { shutdownFailure ||= failed; break; }
      phase = failed ? 'retrying' : 'idle';
      await pause(failed ? retryMs : pollMs);
    }
  })();
  return {
    status() { return { phase, active, closing, recoveryOnly }; },
    close() {
      if (closeTask) return closeTask;
      closing = true; phase = 'closing'; wake?.();
      // Mark the controller closed before awaiting the batch, so active workers
      // stop instead of waiting for their normal deadline. No new claims follow.
      closeTask = (async () => {
        // Recovery itself owns external stop/checkpoint work. Let it finish
        // before close releases the process lock, including when recovery fails.
        await recoveryTask?.catch(() => {});
        const outcomes = await Promise.allSettled([Promise.resolve().then(() => controller.close()), loop]);
        const failure = outcomes.find(result => result.status === 'rejected');
        if (failure || shutdownFailure) { phase = 'failed'; report('shutdown_failed'); throw new Error('Scheduler shutdown unconfirmed'); }
        phase = 'closed';
      })();
      return closeTask;
    },
  };
}
