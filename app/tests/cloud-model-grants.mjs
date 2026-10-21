import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Accounts } from '../cloud/accounts.mjs';
import { Runs } from '../cloud/runs.mjs';
import { ModelGrants } from '../cloud/model-grants.mjs';
if (!process.env.CORILO_TEST_DATABASE_URL) throw new Error('Disposable PostgreSQL required');
const allowance = {model:'deepseek-flash',maxRequests:2,maxOutputTokens:100,maxTokensPerRequest:60,ttlSeconds:90};
const status = code => error => error.status === code;

test('model grants persist atomic reservation limits and reject revoked or inactive execution identities',async t=> {
  const accounts=new Accounts(process.env.CORILO_TEST_DATABASE_URL);t.after(()=>accounts.close());
  await accounts.migrate();await accounts.migrate();
  const runs=new Runs(accounts.pool,{maxRunning:1,maxQueued:2,leaseSeconds:30,maxRunSeconds:120});
  const grants=new ModelGrants(accounts.pool);
  const email=randomUUID()+'@example.test';
  const owner=await accounts.session(await accounts.login({subject:randomUUID(),email},await accounts.invite(email)));
  const conversationId=await runs.conversation(owner.id);
  const claimNext=async()=> {
    await runs.submit(owner.id,{conversationId,key:randomUUID(),prompt:'synthetic'});
    return runs.claim();
  };
  const claim=await claimNext();
  for(const forged of [{token:'0'.repeat(64)},{ownerId:randomUUID()},{vaultId:randomUUID()},{conversationId:randomUUID()}])
    await assert.rejects(grants.issue({...claim,...forged},allowance),status(401));
  await assert.rejects(grants.issue(claim,{}),status(400));
  const issued=await grants.issue(claim,allowance);
  assert.equal(typeof issued.token,'string');
  assert.ok(issued.expiresAt instanceof Date);
  const stored=(await accounts.pool.query('SELECT * FROM corilo_private.model_grants WHERE run_id=$1',[claim.id])).rows[0];
  assert.notEqual(stored.digest,issued.token);
  assert.ok(!JSON.stringify(await runs.events(owner.id,claim.id)).includes(issued.token));
  await assert.rejects(grants.issue(claim,allowance),status(409),'reissuing cannot reset allowance');
  await assert.rejects(grants.reserve('0'.repeat(64),{model:allowance.model,maxTokens:10}),status(401));
  await assert.rejects(grants.reserve(issued.token,{model:'deepseek-v4-pro',maxTokens:10}),status(403));
  await assert.rejects(grants.reserve(issued.token,{model:allowance.model,maxTokens:61}),status(429));
  await assert.rejects(grants.reserve(issued.token,{model:allowance.model,maxTokens:0}),status(400));
  const competing=await Promise.allSettled(Array.from({length:8},()=>grants.reserve(issued.token,{model:allowance.model,maxTokens:60})));
  assert.equal(competing.filter(r=>r.status==='fulfilled').length,1,'aggregate output budget is atomic');
  assert.ok(competing.filter(r=>r.status==='rejected').every(r=>r.reason.status===429));
  const reservation=competing.find(r=>r.status==='fulfilled').value;
  assert.deepEqual({runId:reservation.runId,ownerId:reservation.ownerId,vaultId:reservation.vaultId},
    {runId:claim.id,ownerId:owner.id,vaultId:owner.vault_id});
  // New pool/service cannot refund an unknown result or reset its grant.
  const reopened=new Accounts(process.env.CORILO_TEST_DATABASE_URL);t.after(()=>reopened.close());
  const resumed=new ModelGrants(reopened.pool);
  await resumed.reserve(issued.token,{model:allowance.model,maxTokens:40});
  await assert.rejects(resumed.reserve(issued.token,{model:allowance.model,maxTokens:1}),status(429));
  assert.equal((await resumed.assertActive(issued.token)).runId,claim.id,'admitted stream stays valid after allowance exhausts');
  const usage=(await accounts.pool.query('SELECT reserved_requests,reserved_output_tokens FROM corilo_private.model_grants WHERE run_id=$1',[claim.id])).rows[0];
  assert.deepEqual(usage,{reserved_requests:2,reserved_output_tokens:'100'});
  assert.equal(Number((await accounts.pool.query('SELECT count(*) FROM corilo_private.model_reservations WHERE run_id=$1',[claim.id])).rows[0].count),2);
  await runs.stop(owner.id,claim.id);
  await assert.rejects(grants.assertActive(issued.token),status(401));
  await assert.rejects(grants.reserve(issued.token,{model:allowance.model,maxTokens:1}),status(401));
  await runs.finish(claim.id,claim.token,'stopped');

  for(const cause of ['revoke','expiry','lease','deadline','disabled','terminal']) {
    const current=await claimNext(), grant=await grants.issue(current,allowance);
    if(cause==='revoke') {await grants.revokeRun(current.id);await grants.revokeRun(current.id);}
    if(cause==='expiry')await accounts.pool.query("UPDATE corilo_private.model_grants SET expires_at=clock_timestamp()-interval '1 second' WHERE run_id=$1",[current.id]);
    if(cause==='lease')await accounts.pool.query("UPDATE corilo_private.runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[current.id]);
    if(cause==='deadline')await accounts.pool.query("UPDATE corilo_private.runs SET deadline_at=clock_timestamp()-interval '1 second' WHERE id=$1",[current.id]);
    if(cause==='disabled')await accounts.pool.query('UPDATE corilo_private.accounts SET disabled=true WHERE id=$1',[owner.id]);
    if(cause==='terminal')await runs.finish(current.id,current.token,'completed');
    await assert.rejects(grants.assertActive(grant.token),status(401),cause);
    await assert.rejects(grants.reserve(grant.token,{model:allowance.model,maxTokens:1}),status(401),cause);
    if(cause!=='terminal')await runs.finish(current.id,current.token,'failed');
    if(cause==='disabled')await accounts.pool.query('UPDATE corilo_private.accounts SET disabled=false WHERE id=$1',[owner.id]);
  }
  const requestLimited=await claimNext();
  const requestGrant=await grants.issue(requestLimited,{...allowance,maxRequests:1,maxOutputTokens:1000});
  await grants.reserve(requestGrant.token,{model:allowance.model,maxTokens:1});
  await assert.rejects(grants.reserve(requestGrant.token,{model:allowance.model,maxTokens:1}),status(429),'request cap independent of output cap');
  await runs.finish(requestLimited.id,requestLimited.token,'completed');
  const short=await claimNext();
  const longGrant=await grants.issue(short,{...allowance,ttlSeconds:86400});
  const deadline=(await accounts.pool.query('SELECT deadline_at FROM corilo_private.runs WHERE id=$1',[short.id])).rows[0].deadline_at;
  assert.equal(longGrant.expiresAt.getTime(),deadline.getTime(),'grant cannot outlive run deadline');
  await runs.finish(short.id,short.token,'completed');
});
