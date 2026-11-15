import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NotesStore } from '../storage.mjs';
import { WorkspaceStore } from '../workspace-store.mjs';
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'corilo-filesmd-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const notes=await NotesStore.open(root);return{root,notes,store:await WorkspaceStore.open(notes)};}
test('workspace and Agent Markdown tools share disk, queue, exact versions and stale-write protection',async t=>{
 const {root,notes,store}=await fixture(t);
 await store.create('folder','directory');
 const created=await store.create('folder/Note.md','file');
 const saved=await store.write('folder/Note.md',Buffer.from('\uFEFF原话\r\n- [ ] task\r\n'),created.version);
 const read=await notes.read('folder/Note.md');assert.equal(read.version,saved.etag);assert.equal(read.text,'\uFEFF原话\r\n- [ ] task\r\n');
 await notes.save({path:read.path,text:'Agent 修改',expected:read.version});
 await assert.rejects(store.write(read.path,Buffer.from('stale'),saved.etag),{status:409});
 const after=await store.read(read.path);assert.equal(after.data.toString(),'Agent 修改');
 await store.rename(read.path,'Moved.md',after.etag);assert.equal((await notes.read('Moved.md')).text,'Agent 修改');
 await assert.rejects(store.read(read.path),{status:404});
 const copy=await store.copy('复制原话');assert.equal((await notes.read(copy.path)).text,'复制原话');
 const listing=await store.list('');assert.ok(listing.some(x=>x.name==='Moved.md'));
 const version=await store.versionOf('Moved.md');await store.remove('Moved.md',false,version);await assert.rejects(fs.access(path.join(root,'Moved.md')));
});
test('workspace supports Files.md settings and binary media without modifying Markdown or existing targets',async t=>{
 const {store,notes}=await fixture(t);
 const media=await store.create('media','directory');assert.equal(media.kind,'directory');
 const image=await store.create('media/Test.png','file'), bytes=Buffer.from([0,255,4,0,128]);
 await store.write('media/Test.png',bytes,image.version);assert.deepEqual((await store.read('media/Test.png')).data,bytes);
 const config=await store.create('config.json','file');await store.write('config.json',Buffer.from('{"theme":"dark"}'),config.version);
 assert.equal((await store.read('config.json')).data.toString(),'{"theme":"dark"}');
 const first=await notes.save({path:'a.md',text:'A',expected:null}),second=await notes.save({path:'b.md',text:'B',expected:null});
 await assert.rejects(store.rename('a.md','b.md',first.version),{status:409});assert.equal((await notes.read('b.md')).version,second.version);
});
test('workspace refuses hidden/traversal/link/special paths, stale tree operations, cancellation and replaced roots',async t=>{
 const {root,notes,store}=await fixture(t);
 for(const target of ['../outside.md','.config/secret.md','a//b.md','bad\\file.md','bad\ud800.md'])await assert.rejects(store.stat(target),{status:400});
 await store.create('folder','directory');const old=await store.versionOf('folder');await notes.save({path:'folder/child.md',text:'kept',expected:null});
 await assert.rejects(store.remove('folder',true,old),{status:409});await assert.rejects(store.rename('folder','renamed',old),{status:409});
 await fs.symlink(path.join(root,'folder/child.md'),path.join(root,'link.md'));await assert.rejects(store.read('link.md'),{status:400});
 await fs.link(path.join(root,'folder/child.md'),path.join(root,'hard.md'));await assert.rejects(store.read('hard.md'),{status:400});
 const aborted=new AbortController();aborted.abort();await assert.rejects(store.create('not-created.md','file',aborted.signal));await assert.rejects(fs.access(path.join(root,'not-created.md')));
 await fs.writeFile(path.join(root,'large.md'),Buffer.alloc(1024*1024+1));await assert.rejects(store.read('large.md'),{status:413});
 await fs.rename(root,root+'-old');t.after(()=>fs.rm(root+'-old',{recursive:true,force:true}));await fs.mkdir(root);
 await assert.rejects(store.create('wrong-root.md','file'),{status:409});
});

test('pinned Files.md assets match the recorded upstream hashes and keep their license notices',async()=>{
 const {fileURLToPath}=await import('node:url');const {createHash}=await import('node:crypto');
 const base=fileURLToPath(new URL('../vendor/filesmd/',import.meta.url));
 const source=JSON.parse(await fs.readFile(path.join(base,'SOURCE.json'),'utf8'));
 assert.equal(source.commit,'9e948ba6071e320c41c866f92817cf96f9bb7ba6');
 for(const [file,expected] of Object.entries(source.sha256)){const data=await fs.readFile(path.join(base,file));assert.equal(createHash('sha256').update(data).digest('hex'),expected,file);}
});
