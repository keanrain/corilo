import * as fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';

// Trusted single-host controller. Not instantiated by the public cloud gateway yet.
// hostFor must resolve the claimed vault from the control DB, never browser paths.
export class ExecutionController {
  constructor({ runs, workers, hostFor, modelOutlet = null, pollMs = 250 }) {
    if (!Number.isInteger(pollMs) || pollMs < 20 || pollMs > 5000) throw new Error('Invalid controller poll interval');
    if (modelOutlet && ['prepare','revoke','close'].some(method=>typeof modelOutlet[method]!=='function'))throw new Error('Invalid model outlet');
    Object.assign(this,{runs,workers,hostFor,modelOutlet,pollMs}); this.closed=false; this.running=new Set();
  }
  async init() {
    if (this.lock) throw new Error('Controller already initialized');
    await fs.mkdir(this.workers.journalRoot,{recursive:true,mode:0o700});
    if (await fs.realpath(this.workers.journalRoot) !== this.workers.journalRoot) throw new Error('Unsafe controller state');
    this.lock=await fs.open(path.join(this.workers.journalRoot,'controller.flock'),constants.O_RDWR|constants.O_CREAT|constants.O_NOFOLLOW,0o600);
    try {
      const stat=await this.lock.stat(); if(!stat.isFile() || stat.nlink!==1) throw new Error('Unsafe controller lock');
      await new Promise((resolve,reject)=> {
        const child=spawn('flock',['--exclusive','--nonblock','3'],{stdio:['ignore','ignore','ignore',this.lock.fd]});
        child.once('error',reject); child.once('close',code=>code===0?resolve():reject(new Error('Controller already active')));
      });
    } catch(e) { await this.lock.close(); this.lock=null; throw e; }
  }
  async executeNext() {
    if (!this.lock || this.closed) throw new Error('Controller unavailable');
    const task=this.execute(); this.running.add(task);
    try { return await task; } finally { this.running.delete(task); }
  }
  async execute() {
    const claim=await this.runs.claim(); if(!claim)return null;
    const host=await this.hostFor(claim);
    await host.beginRun(claim.id);
    let failure=false;
    const mayStart=async()=> !this.closed && (await this.runs.heartbeat(claim.id,claim.token)).continue;
    try {
      const model = this.modelOutlet ? await this.modelOutlet.prepare(claim) : undefined;
      await this.workers.start(claim,mayStart,model);
      while (true) {
        if (!await mayStart()) break;
        const state=await this.workers.status(claim.id);
        if (!state.running) { failure=state.exitCode!==0 || state.oomKilled; break; }
        await new Promise(resolve=>setTimeout(resolve,this.pollMs));
      }
    } catch { failure=true; }
    // A failed Docker request has an unknown outcome. Do not release the DB slot
    // or the persistent file gate until stop can prove there is no late worker.
    if (await this.stopRun(claim.id) !== true) throw new Error('Worker termination unconfirmed; vault remains held');
    await host.checkpointRun(claim.id);
    const result=await this.runs.finish(claim.id,claim.token,failure?'failed':this.closed?'stopped':'completed');
    await host.releaseRun(claim.id);
    return result;
  }
  async stopRun(id) {
    let revocationError;
    try { await this.modelOutlet?.revoke(id); } catch (error) { revocationError=error; }
    // Losing the database must not leave a model-enabled worker alive. Still
    // attempt termination, but retain the gate if revocation was not confirmed.
    const stopped=await this.workers.stop(id);
    if(revocationError)throw new Error('Model revocation unconfirmed; vault remains held',{cause:revocationError});
    return stopped;
  }
  // Startup recovery only: old controller must have released the process lock.
  // No prompt replay. Leases that are still live remain occupied until expiration.
  async recover() {
    if(!this.lock || this.closed || this.running.size)throw new Error('Recovery requires an idle controller');
    const results=[];
    for(const run of await this.runs.recoveryCandidates()) {
      const row=(await this.runs.pool.query('SELECT owner_id,vault_id,conversation_id FROM corilo_private.runs WHERE id=$1',[run.id])).rows[0];
      let host;
      try {
        host=await this.hostFor({id:run.id,ownerId:row.owner_id,vaultId:row.vault_id,conversationId:row.conversation_id});
        await host.beginRun(run.id);
      } catch(error) { await this.stopRun(run.id); throw error; }
      const result=await this.runs.reconcile(run.id,async()=> {
        if (await this.stopRun(run.id)!==true)return false;
        await host.checkpointRun(run.id); return true;
      });
      if(result) { await host.releaseRun(run.id); results.push(result); }
    }
    // The DB terminal commit may have succeeded just before controller death and
    // before the file gate was released. Reconcile these journals too, without replay.
    for (const id of await fs.readdir(this.workers.journalRoot)) {
      if(!/^[a-f0-9-]{36}$/.test(id))continue;
      const row=(await this.runs.pool.query("SELECT * FROM corilo_private.runs WHERE id=$1 AND state IN ('completed','failed','stopped','interrupted')",[id])).rows[0];
      if(!row)continue;
      if(await this.stopRun(id)!==true)throw new Error('Terminal worker termination unconfirmed');
      const host=await this.hostFor({id,ownerId:row.owner_id,vaultId:row.vault_id,conversationId:row.conversation_id});
      if(await host.activeRunId()!==id)continue;
      await host.checkpointRun(id);await host.releaseRun(id);results.push({id,state:row.state});
    }
    return results;
  }
  close() {
    if(this.closeTask)return this.closeTask;
    this.closed=true;
    this.closeTask=(async()=> {
      const results=await Promise.allSettled([...this.running]);
      let failed=results.some(result=>result.status==='rejected');
      try { await this.modelOutlet?.close(); } catch { failed=true; }
      // All local start/stop operations have settled before ownership is released.
      // Persistent run slots, journals and file gates remain for recovery on failure.
      try { if(this.lock) { await this.lock.close(); this.lock=null; } } catch { failed=true; }
      if(failed)throw new Error('Controller shutdown unconfirmed; recovery required');
    })();
    return this.closeTask;
  }
}
