import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Accounts } from '../cloud/accounts.mjs';
import { Runs } from '../cloud/runs.mjs';
import { CloudHosts } from '../cloud/hosts.mjs';
if (!process.env.CORILO_TEST_DATABASE_URL) throw new Error('Disposable PostgreSQL required');

test('file host registry validates run ownership, shares host/gate, bounds capacity and closes pending hosts', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'corilo-hosts-'));
  const accounts = new Accounts(process.env.CORILO_TEST_DATABASE_URL); await accounts.migrate();
  const registry = new CloudHosts({ pool: accounts.pool, dataRoot: root, maxHosts: 1 });
  t.after(async () => { await registry.close(); await accounts.close(); await rm(root, {recursive:true,force:true}); });
  const owner = async () => {
    const email=randomUUID()+'@example.test';
    return accounts.session(await accounts.login({subject:randomUUID(),email},await accounts.invite(email)));
  };
  const a=await owner(), b=await owner();
  const runs=new Runs(accounts.pool,{maxRunning:1,maxQueued:2,leaseSeconds:30,maxRunSeconds:120});
  const conversationId=await runs.conversation(a.id);
  const run=await runs.submit(a.id,{conversationId,key:'host',prompt:'synthetic'});
  const claim={id:run.id,ownerId:a.id,vaultId:a.vault_id,conversationId};
  const [host, same, byRun]=await Promise.all([registry.forAccount(a.id),registry.forAccount(a.id),registry.forRun(claim)]);
  assert.equal(host,same);assert.equal(host,byRun);
  assert.ok((await stat(path.join(root,a.vault_id,'state','conversations',conversationId))).isDirectory());
  await assert.rejects(registry.forRun({...claim,ownerId:b.id}),e=>e.status===404);
  await assert.rejects(registry.forRun({...claim,vaultId:b.vault_id}),e=>e.status===404);
  await assert.rejects(registry.forRun({...claim,conversationId:randomUUID()}),e=>e.status===404);
  await assert.rejects(registry.forAccount(b.id),e=>e.status===503);
  await host.beginRun(run.id);
  const blocked=await fetch(host.origin+'/api/capture',{method:'POST',headers:{'X-Corilo-Token':host.token},body:JSON.stringify({text:'blocked'})});
  assert.equal(blocked.status,409);
  await runs.stop(a.id,run.id);
  await accounts.pool.query('UPDATE corilo_private.accounts SET disabled=true WHERE id=$1',[a.id]);
  await assert.rejects(registry.forAccount(a.id),e=>e.status===403);
  assert.equal(await registry.forRun(claim),host,'disabled owners must remain recoverable');
  await host.checkpointRun(run.id); await host.releaseRun(run.id);
  await registry.close(); await registry.close();
  await assert.rejects(registry.forAccount(a.id),e=>e.status===503);
  await assert.rejects(fetch(host.origin+'/api/state'));

  // Failed opening must release registry capacity; directory links fail before touching descendants.
  const next = new CloudHosts({pool:accounts.pool,dataRoot:root,maxHosts:1});
  t.after(()=>next.close());
  const foreign=path.join(root,'foreign'); await mkdir(foreign);
  await symlink(foreign,path.join(root,b.vault_id));
  await assert.rejects(next.forAccount(b.id),/Unsafe/);
  await assert.rejects(stat(path.join(foreign,'knowledge')),e=>e.code==='ENOENT');
  await rm(path.join(root,b.vault_id));
  const reopened=await next.forAccount(b.id); assert.ok(reopened.origin);
  await next.close();

  const pending = new CloudHosts({pool:accounts.pool,dataRoot:root,maxHosts:1});
  const initializing=pending.host(b.vault_id);
  const closing=pending.close(); await closing;
  assert.equal(pending.close(),closing);
  await assert.rejects(fetch((await initializing).origin+'/api/state'));
});
