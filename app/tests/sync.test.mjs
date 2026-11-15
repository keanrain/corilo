import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Vault } from '../host/vault.mjs';
import { GitSync, git, verifyGitHub } from '../host/sync.mjs';

async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'corilo-sync-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const remote=path.join(root,'remote.git'); await git(root,['init','--bare','--initial-branch=main',remote]);
  const a=new Vault(path.join(root,'a')); await a.init();
  await fs.writeFile(path.join(a.root,'note.md'),'base\n'); await a.checkpoint('seed');
  const make=async (vault,name)=>{const sync=new GitSync(vault,path.join(root,name),async(_,url)=>url); await sync.init(); await sync.bind(remote); return sync;};
  const sa=await make(a,'config-a'); await sa.run();
  const b=new Vault(path.join(root,'b')); await git(root,['clone',remote,b.root]); await b.init();
  const sb=await make(b,'config-b');
  return {root,remote,a,b,sa,sb,make};
}
const read=(vault,name='note.md')=>fs.readFile(path.join(vault.root,name),'utf8');
const write=(vault,value,name='note.md')=>fs.writeFile(path.join(vault.root,name),value);

test('two libraries merge, retry offline, persist connection and unbind without deleting files', async t=>{
  const {root,remote,a,b,sa,sb}=await fixture(t);
  await write(a,'from a','a.md'); await sa.run();
  await write(b,'from b','b.md'); await sb.run(); await sa.run();
  assert.equal(await read(a,'b.md'),'from b'); assert.equal(await read(b,'a.md'),'from a');
  assert.equal(sa.state().phase,'synced');
  await fs.rename(remote,remote+'.offline'); await write(a,'offline');
  await assert.rejects(sa.run()); assert.equal(await read(a),'offline');
  assert.equal((await a.git(['status','--porcelain'])).trim(),''); assert.equal(sa.state().phase,'error');
  await fs.rename(remote+'.offline',remote); await sa.run(); await sb.run(); assert.equal(await read(b),'offline');
  const restarted=new GitSync(a,path.join(root,'config-a'),async(_,url)=>url); await restarted.init();
  assert.equal(restarted.state().url,remote); assert.equal(restarted.state().phase,'pending');
  await restarted.unbind(); assert.equal(await read(a),'offline'); assert.equal(restarted.state().phase,'unbound');
});

test('text conflicts stay outside library; preserve both and sync result', async t=>{
  const {a,b,sa,sb}=await fixture(t);
  await write(a,'*.remote-*\n','.gitignore'); await sa.run(); await sb.run();
  await write(a,'version a\n'); await sa.run(); await write(b,'version b\n');
  const conflict=await sb.run(); assert.equal(conflict.phase,'conflict');
  assert.equal(await read(b),'version b\n'); assert.equal(conflict.conflicts[0].remote.text,'version a\n');
  assert.equal((await b.git(['ls-files','-u'])).trim(),'');
  await sb.run({id:conflict.conflictId,choices:{'note.md':{kind:'both'}}}); await sa.run();
  assert.equal(await read(a),'version b\n');
  const copy=(await fs.readdir(a.root)).find(n=>n.startsWith('note.remote-'));
  assert.equal(await read(a,copy),'version a\n');
});

test('stale conflict decisions never overwrite newer local edits; fresh merge can resolve manually', async t=>{
  const {a,b,sa,sb}=await fixture(t);
  await write(a,'remote'); await sa.run(); await write(b,'local'); const old=await sb.run();
  await write(b,'new local');
  await assert.rejects(sb.run({id:old.conflictId,choices:{'note.md':{kind:'remote'}}}),/本机内容已变化/);
  assert.equal(await read(b),'new local');
  const fresh=await sb.run();
  await sb.run({id:fresh.conflictId,choices:{'note.md':{kind:'manual',text:'combined'}}}); await sa.run();
  assert.equal(await read(a),'combined');
});

test('delete/modify and binary conflicts retain versions', async t=>{
  const {a,b,sa,sb}=await fixture(t);
  await fs.rm(path.join(a.root,'note.md')); await sa.run(); await write(b,'edited');
  let result=await sb.run(); assert.equal(result.conflicts[0].remote,null);
  await sb.run({id:result.conflictId,choices:{'note.md':{kind:'local'}}}); await sa.run(); assert.equal(await read(a),'edited');
  await write(a,Buffer.from([0,1]),'image.bin'); await sa.run(); await sb.run();
  await write(a,Buffer.from([0,2]),'image.bin'); await sa.run(); await write(b,Buffer.from([0,3]),'image.bin');
  result=await sb.run(); assert.equal(result.conflicts[0].local.binary,true);
  await sb.run({id:result.conflictId,choices:{'image.bin':{kind:'both'}}});
  assert.deepEqual(await fs.readFile(path.join(b.root,'image.bin')),Buffer.from([0,3]));
  const other=(await fs.readdir(b.root)).find(n=>n.startsWith('image.remote-'));
  assert.deepEqual(await fs.readFile(path.join(b.root,other)),Buffer.from([0,2]));
});

test('unrelated histories, switched branches and unsafe remote trees are rejected', async t=>{
  const {root,remote,a,b,sa,sb}=await fixture(t);
  const other=new Vault(path.join(root,'other')); await fs.mkdir(other.root); await write(other,'unrelated'); await other.init();
  const so=new GitSync(other,path.join(root,'config-other'),async(_,url)=>url); await so.init();
  await assert.rejects(so.bind(remote),/共同历史/); assert.equal(so.state().phase,'unbound');
  await b.git(['switch','-c','unexpected']); await assert.rejects(sb.run(),/分支已切换/); await b.git(['switch','main']);
  await write(a,'bad','CON.md'); await a.checkpoint('unsafe externally created file');
  await a.git(['push',remote,'HEAD:main']);
  await assert.rejects(sb.run(),/跨平台/); assert.equal(await read(b),'base\n');
  assert.equal(await fs.stat(path.join(b.root,'CON.md')).catch(()=>null),null);
  await assert.rejects(sa.run(),/跨平台/);
});

test('production binding refuses non-GitHub URLs before invoking credentials', async()=>{
  for(const url of ['file:///tmp/secret','https://user:token@github.com/a/b.git','https://github.com/a/b.git?token=secret','--upload-pack=anything']) await assert.rejects(verifyGitHub('/tmp',url),/请输入/);
});

test('concurrent non-force pushes retry against the latest remote history', async t=>{
  const {a,b,sa,sb}=await fixture(t);
  await write(a,'left','left.md'); await write(b,'right','right.md');
  const results=await Promise.all([sa.run(),sb.run()]);
  assert.ok(results.every(r=>r.phase==='synced'));
  await sa.run(); await sb.run();
  for(const vault of [a,b]) { assert.equal(await read(vault,'left.md'),'left'); assert.equal(await read(vault,'right.md'),'right'); }
});

test('GitHub identity/privacy checks use the existing credential helper', async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'corilo-identity-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await git(root,['init']);
  await git(root,['config','--local','--add','credential.helper','']);
  await git(root,['config','--local','--add','credential.helper','!f() { echo username=fixture; echo password=synthetic-token; }; f']);
  let privateRepo=true, name='owner/notes';
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(url,'https://api.github.com/repos/owner/notes');
    assert.equal(options.headers.Authorization,'Bearer synthetic-token');
    return {ok:true,json:async()=>({private:privateRepo,permissions:{push:true},full_name:name})};
  });
  assert.equal(await verifyGitHub(root,'https://github.com/owner/notes.git'),'https://github.com/owner/notes.git');
  privateRepo=false; await assert.rejects(verifyGitHub(root,'https://github.com/owner/notes'),/私有/);
  privateRepo=true; name='owner/renamed'; await assert.rejects(verifyGitHub(root,'https://github.com/owner/notes'),/私有/);
  assert.equal(await textGit(root,['remote']), '');
});
async function textGit(cwd,args){return (await git(cwd,args)).toString().trim();}
