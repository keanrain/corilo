import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Accounts, SupabaseIdentity } from '../cloud/accounts.mjs';
import path from 'node:path';
import { Runs } from '../cloud/runs.mjs';
import { CURRENT_SESSION_VERSION } from '@earendil-works/pi-coding-agent';
import { startCloud } from '../cloud/gateway.mjs';
if (!process.env.CORILO_TEST_DATABASE_URL) throw new Error('CORILO_TEST_DATABASE_URL must point to a disposable PostgreSQL database');
const hash = s => createHash('sha256').update(s).digest('hex');

test('cloud invitation, persistence, authorization, files and real browser flow', async t => {
  const accounts = new Accounts(process.env.CORILO_TEST_DATABASE_URL);
  await accounts.migrate(); await accounts.migrate();
  const root = await mkdtemp(tmpdir()+'/corilo-cloud-');
  const prefix = randomUUID();
  const alice = `${prefix}-alice@example.test`, bob = `${prefix}-bob@example.test`;
  const identity = { signIn: async (email, password) => {
    if (![alice,bob].includes(email) || password !== 'synthetic-password') throw Object.assign(new Error('Invalid test identity'),{status:401});
    return { subject: prefix+email, email };
  } };
  let cloud = await startCloud({ accounts, identity, dataRoot:root, publicOrigin:'http://127.0.0.1:0' });
  t.after(async () => { await cloud.close(); await accounts.close(); await rm(root,{recursive:true,force:true}); });
  const request = (route, token='', data, method) => fetch(cloud.address+route, {
    method: method || (data === undefined ? 'GET':'POST'),
    headers: { ...(token ? {Cookie:`__Host-corilo-session=${token}`} : {}), Origin:cloud.address,
      ...(data === undefined ? {} : {'Content-Type':'application/json'}) },
    ...(data === undefined ? {} : {body:JSON.stringify(data)}), redirect:'manual',
  });
  const signIn = async (email, invitation) => {
    const response = await request('/auth/login','',{email,password:'synthetic-password',invitation});
    assert.equal(response.status,200,await response.clone().text());
    const cookie=response.headers.get('set-cookie');
    assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
    return cookie.match(/session=([a-f0-9]{64})/)[1];
  };
  const aInvite=await accounts.invite(alice), bInvite=await accounts.invite(bob);
  assert.equal((await request('/api/state')).status,401);
  assert.equal((await request('/')).headers.get('location'),'/login');
  assert.equal((await request('/auth/login','',{email:bob,password:'synthetic-password',invitation:aInvite})).status,403);
  const expired=await accounts.invite(alice);
  await accounts.pool.query("UPDATE corilo_private.invitations SET expires_at=now()-interval '1 second' WHERE digest=$1",[hash(expired)]);
  assert.equal((await request('/auth/login','',{email:alice,password:'synthetic-password',invitation:expired})).status,403);
  const revoked=await accounts.invite(alice);
  await accounts.pool.query('UPDATE corilo_private.invitations SET revoked=true WHERE digest=$1',[hash(revoked)]);
  await assert.rejects(accounts.login({subject:prefix+alice,email:alice},revoked),e=>e.status===403);
  // Concurrent redemption by the same verified identity creates exactly one account/vault.
  const [a,a2] = await Promise.all([signIn(alice,aInvite),signIn(alice,aInvite)]);
  const b = await signIn(bob,bInvite);
  const aRecord=await accounts.session(a), bRecord=await accounts.session(b);
  assert.equal((await accounts.session(a2)).vault_id,aRecord.vault_id);
  assert.notEqual(aRecord.vault_id,bRecord.vault_id);
  await assert.rejects(accounts.login({subject:prefix+'impostor',email:alice},aInvite),e=>e.status===403);
  const sessions=(await accounts.pool.query('SELECT digest FROM corilo_private.sessions WHERE account_id=$1',[aRecord.id])).rows;
  assert.ok(sessions.every(row=>row.digest!==a && row.digest!==a2));
  assert.equal((await request('/api/capture',a,{text:'Alice private note'})).status,200);
  const aFiles=await (await request('/api/fs/list?path=收集',a)).json();
  const filename='收集/'+aFiles[0].name;
  assert.equal((await request('/api/fs/read?path='+encodeURIComponent(filename),b)).status,404);
  assert.equal((await request('/api/fs/read?path='+encodeURIComponent('../'+aRecord.vault_id+'/knowledge/'+filename),b)).status,400);
  assert.equal((await request('/api/fs/list?vaultId='+aRecord.vault_id,b)).status,200);
  assert.deepEqual(await (await request('/api/fs/list?vaultId='+aRecord.vault_id,b)).json(),[]);
  const read=await request('/api/fs/read?path='+encodeURIComponent(filename),a);
  const etag=read.headers.get('x-corilo-etag');
  const put = (token,value) => fetch(cloud.address+'/api/fs/write?path='+encodeURIComponent(filename),{method:'PUT',headers:{Origin:cloud.address,Cookie:`__Host-corilo-session=${token}`,'If-Match':etag},body:value});
  assert.equal((await put(a,'new content')).status,200);
  assert.equal((await put(a2,'stale content')).status,409);
  assert.equal(await (await request('/api/fs/read?path='+encodeURIComponent(filename),a)).text(),'new content');
  // Another logged-in device must not delete/move the version it read before the save.
  assert.equal((await request('/api/fs/remove',a2,{path:filename,expected:etag})).status,409);
  assert.equal((await request('/api/fs/rename',a2,{from:filename,to:'moved.md',expected:etag})).status,409);
  assert.equal((await request('/api/fs/remove',a2,{path:filename})).status,409);
  assert.equal(await (await request('/api/fs/read?path='+encodeURIComponent(filename),a)).text(),'new content');
  assert.equal((await request('/api/agent/prompt',a,{text:'must not execute'})).status,503);
  assert.equal((await request('/api/sync/run',a,{})).status,503);
  const state=await (await request('/api/state',a)).json();
  assert.equal(state.vault,'我的知识库'); assert.equal(state.capabilities.agent,false);
  // The public observation API never accepts a browser-selected owner or submits work.
  const runs = new Runs(accounts.pool, { maxRunning: 1, maxQueued: 2, leaseSeconds: 30, maxRunSeconds: 120 });
  const conversation = await runs.conversation(aRecord.id);
  const task = await runs.submit(aRecord.id, { conversationId: conversation, key: 'observe', prompt: 'private prompt' });
  assert.equal((await request('/api/conversations')).status,401);
  assert.equal((await request('/api/conversations',a,{})).status,404);
  assert.equal((await request('/api/runs',a,{})).status,404);
  assert.equal((await request('/api/conversations?owner='+aRecord.id,b)).status,400);
  assert.equal((await request('/api/conversations?limit=1&limit=2',a)).status,400);
  assert.deepEqual((await (await request('/api/conversations',b)).json()).items,[]);
  assert.equal((await request('/api/conversations/'+conversation,b)).status,404);
  assert.equal((await request('/api/runs/'+task.id+'/stop',b,{})).status,404);
  assert.equal((await fetch(cloud.address+'/api/runs/'+task.id+'/stop',{method:'POST',headers:{Cookie:`__Host-corilo-session=${a}`}})).status,403);
  const detail = await (await request('/api/conversations/'+conversation,a)).json();
  assert.equal(detail.messagesStatus,'running'); assert.equal(detail.runs[0].state,'queued');
  assert.ok(!JSON.stringify(detail).includes('private prompt'));
  const claimed = await runs.claim(); assert.equal(claimed.id,task.id);
  assert.equal((await (await request('/api/runs/'+task.id+'/stop',a,{})).json()).state,'stopping');
  assert.equal((await (await request('/api/conversations/'+conversation,a2)).json()).runs[0].state,'stopping');
  await runs.reconcile(task.id,async()=>true); // No worker is created in this API fixture.
  assert.equal((await (await request('/api/runs/'+task.id+'/stop',a,{})).json()).state,'stopped');
  const html=await (await request('/',a)).text(); assert.ok(!html.includes('/corilo/sync.js'));
  assert.equal((await fetch(cloud.address+'/api/capture',{method:'POST',headers:{Cookie:`__Host-corilo-session=${a}`,Origin:'https://evil.invalid'},body:'{}'})).status,403);
  assert.equal((await fetch(cloud.address+'/auth/logout',{method:'POST',headers:{Cookie:`__Host-corilo-session=${a}`}})).status,403);
  assert.equal((await request('/auth/logout',a,{})).status,200);
  assert.equal((await request('/api/state',a)).status,401);
  const expiredSession = await accounts.login({subject:prefix+alice,email:alice});
  await accounts.pool.query("UPDATE corilo_private.sessions SET expires_at=now()-interval '1 second' WHERE digest=$1",[hash(expiredSession)]);
  assert.equal((await request('/api/state',expiredSession)).status,401);
  await accounts.pool.query('UPDATE corilo_private.accounts SET disabled=true WHERE id=$1',[bRecord.id]);
  assert.equal((await request('/api/state',b)).status,401);
  assert.equal((await request('/auth/login','',{email:bob,password:'synthetic-password'})).status,403);
  // Restart both the gateway and its vault hosts: database session and disk files survive.
  await cloud.close(); cloud=await startCloud({accounts,identity,dataRoot:root,publicOrigin:'http://127.0.0.1:0'});
  assert.equal(await (await request('/api/fs/read?path='+encodeURIComponent(filename),a2)).text(),'new content');
  // Synthetic native Pi transcript, rendered by the real browser on two devices.
  const sessionDir=path.join(root,aRecord.vault_id,'state','conversations',conversation,'sessions');
  await mkdir(sessionDir,{recursive:true});
  await writeFile(path.join(sessionDir,'fixture.jsonl'),[
    {type:'session',version:CURRENT_SESSION_VERSION,id:randomUUID(),timestamp:new Date().toISOString(),cwd:'/knowledge'},
    {type:'message',id:'user',parentId:null,message:{role:'user',content:'Remember <img src=x onerror="window.historyUnsafe=true">'}},
    {type:'message',id:'assistant',parentId:'user',message:{role:'assistant',content:[{type:'text',text:'Saved synthetic conversation'}]}}
  ].map(x=>JSON.stringify(x)).join('\n')+'\n');
  for (let i=0;i<26;i++) await runs.conversation(aRecord.id);
  const queuedConversation=await runs.conversation(aRecord.id);
  const queuedTask=await runs.submit(aRecord.id,{conversationId:queuedConversation,key:'browser-stop',prompt:'do not execute'});
  // Actual browser login/edit/export/logout. Identity adapter alone is synthetic.
  const result=await promisify(execFile)('python3',['app/tests/browser_cloud.py'],{env:{...process.env,CORILO_TEST_CLOUD_ORIGIN:cloud.address,CORILO_TEST_EMAIL:alice,CORILO_TEST_CONVERSATION:conversation,CORILO_TEST_QUEUED_CONVERSATION:queuedConversation},timeout:60000});
  assert.match(result.stdout,/Cloud browser checks passed/);
  console.log(result.stdout.trim());
  assert.equal((await runs.get(aRecord.id,queuedTask.id)).state,'stopped');
});

test('Supabase identity adapter accepts only confirmed matching provider identities', async t => {
  const original=globalThis.fetch; t.after(()=>{globalThis.fetch=original;});
  const identity=new SupabaseIdentity({url:'https://identity.example.test',publishableKey:'synthetic-publishable-key'});
  let user={id:'test-subject',email:'alice@example.test',email_confirmed_at:'2026-10-21T00:00:00Z'};
  globalThis.fetch=async (url, options)=>{
    assert.equal(url,'https://identity.example.test/auth/v1/token?grant_type=password');
    assert.equal(options.redirect,'error');
    assert.equal(JSON.parse(options.body).email,'alice@example.test');
    return new Response(JSON.stringify({user}),{status:200});
  };
  assert.equal((await identity.signIn('alice@example.test','test')).subject,'https://identity.example.test|test-subject');
  user={...user,email_confirmed_at:null}; await assert.rejects(identity.signIn('alice@example.test','test'),e=>e.status===401);
  user={...user,email_confirmed_at:'yes',email:'other@example.test'}; await assert.rejects(identity.signIn('alice@example.test','test'),e=>e.status===401);
  globalThis.fetch=async()=>{throw new Error('sensitive upstream detail');};
  await assert.rejects(identity.signIn('alice@example.test','test'),e=>e.status===503&&!e.message.includes('sensitive'));
});
