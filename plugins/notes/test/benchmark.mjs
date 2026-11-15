// Synthetic real-file/Git benchmark; never opens a user knowledge directory.
import {NotesStore} from '../storage.mjs';
import {seedTrash} from './git-fixture.mjs';
import {execFileSync} from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {performance} from 'node:perf_hooks';
const base=await fs.mkdtemp(path.join(os.tmpdir(),'corilo-perf-review-'));
const rows=[];
try {
 const store=await NotesStore.open(path.join(base,'notes'),{},{stateRoot:path.join(base,'state')});
 for(let i=0;i<200;i++)await fs.writeFile(path.join(store.root,`note-${i}.md`),'a'.repeat(4096));
 await store.save({path:'bench.md',text:'initial',expected:null});
 let fixture=await seedTrash(store,100);
 await store.recovery.run(['update-ref','--stdin'],fixture.ids.map(id=>`delete refs/corilo/trash/${id}`).join('\n')+'\n',256);
 await store.recovery.run(['pack-refs','--all'],undefined,256);
 const originalRun=store.recovery.run.bind(store.recovery), originalCheck=store.recovery.check.bind(store.recovery);
 let gitCalls=0, checks=0;
 store.recovery.run=(...args)=>{gitCalls++;return originalRun(...args)};
 store.recovery.check=(...args)=>{checks++;return originalCheck(...args)};
 async function countEntries(root){let n=0;for(const e of await fs.readdir(root,{withFileTypes:true})){n++;if(e.isDirectory())n+=await countEntries(path.join(root,e.name))}return n}
 async function timed(name, task, runs=3){const samples=[];let counts;for(let i=0;i<runs;i++){gitCalls=checks=0;const t=performance.now();await task(i);samples.push(performance.now()-t);counts={gitCalls,checks}} samples.sort((a,b)=>a-b);return{name,ms:Number(samples[Math.floor(samples.length/2)].toFixed(2)),samples:samples.map(n=>Number(n.toFixed(2))),...counts}}
 async function measure(scale){
  const row={scale,stateEntries:await countEntries(store.recovery.stateRoot),operations:[]};
  row.operations.push(await timed('list 201 notes / 800KiB',()=>store.list()));
  row.operations.push(await timed('browse metadata page100',()=>store.browse()));
  row.operations.push(await timed('literal body search <=100 results',()=>store.search({query:'a'})));
  row.operations.push(await timed('read small note',()=>store.read('bench.md')));
  row.operations.push(await timed('save changed note',async i=>{const n=await store.read('bench.md');return store.save({path:n.path,text:`${scale}-v${i}`,expected:n.version})}));
  row.operations.push(await timed('history latest100',()=>store.history(fixture.path)));
  row.operations.push(await timed('trash page <=100',()=>store.listTrash()));
  gitCalls=checks=0;
  const start=performance.now();let historyMs, readMs;
  const h=store.history(fixture.path).then(()=>{historyMs=performance.now()-start});
  const r=store.read('bench.md').then(()=>{readMs=performance.now()-start});
  await Promise.all([h,r]);
  row.queue={historyMs:Number(historyMs.toFixed(2)),readBehindHistoryMs:Number(readMs.toFixed(2)),gitCalls,checks};
  rows.push(row);
 }
 await measure('0 trash / packed baseline');
 fixture=await seedTrash(store,1000);
 await measure('1000 trash / packed refs+objects');
 const refs=(await store.recovery.run(['for-each-ref','--format=%(refname) %(objectname)'],undefined,262144)).toString().trim().split('\n');
 for(const ref of refs){const [name,id]=ref.split(' ');const file=path.join(store.recovery.repo,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,id+'\n',{mode:0o600});}
 await fs.rm(path.join(store.recovery.repo,'packed-refs'));
 await measure('1000 trash / loose refs, packed objects');
 console.log(JSON.stringify({environment:{node:process.version,git:execFileSync('git',['--version'],{encoding:'utf8'}).trim(),filesystemType:(await fs.statfs(base)).type,notes:201,noteBytes:200*4096},rows},null,2));
} finally {await fs.rm(base,{recursive:true,force:true})}
