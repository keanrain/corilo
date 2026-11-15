import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const packageRoot=fileURLToPath(new URL('../',import.meta.url));

test('published dsh web profile loads the external notes plugin and executes its real host pipeline', {timeout:60000}, async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'corilo-dsh-'));
  let child,output='';
  try {
    const proof=path.join(root,'proof.json'),observer=path.join(root,'observer.mjs');
    const pipeline=fileURLToPath(new URL('../node_modules/@deepseek-ai/dsh-tools/lib/pipeline.js',import.meta.url));
    await writeFile(observer,`
      import {writeFile} from 'node:fs/promises';
      import {ToolExecutionPipeline} from ${JSON.stringify(pipeline)};
      export const inject=['tools'];
      export async function apply(ctx){
        const names=['corilo_notes_list','corilo_notes_read','corilo_notes_save','corilo_notes_capture','corilo_notes_create'];
        for(let n=0;!names.every(name=>ctx.tools.get(name));n++){
          if(n>100)throw new Error('Notes tools did not activate');
          await new Promise(resolve=>setTimeout(resolve,50));
        }
        const pipeline=new ToolExecutionPipeline(ctx);let id=0;
        const call=async(name,args)=>{
          const p=await pipeline.prepare({callId:String(++id),name,arguments:args,signal:new AbortController().signal});
          const result=await pipeline.complete(p.exec,p.kind==='dispatch'?await pipeline.dispatch(p.exec):p);
          if(result.isError)throw new Error('Notes tool failed');return result.value;
        };
        await call('corilo_notes_save',{path:'boot.md',text:'Real Harness host',expected:null});
        await call('corilo_notes_create',{});
        const read=await call('corilo_notes_read',{path:'boot.md'});
        const list=await call('corilo_notes_list',{});
        await writeFile(${JSON.stringify(proof)},JSON.stringify({names,text:read.text,paths:list.items.map(x=>x.path)}));
      }
    `);
    const patch=path.join(root,'notes.patch.yml');
    await writeFile(patch,JSON.stringify([{insert:[
      {id:'corilo-notes',name:path.join(packageRoot,'index.mjs'),config:{root:path.join(root,'notes')}},
      {id:'corilo-notes-test-observer',name:observer},
    ]}]));
    child=spawn(process.execPath,[path.join(packageRoot,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',patch,'--no-open','--port','0'],{
      cwd:root,env:{...process.env,HOME:path.join(root,'user-home'),XDG_CONFIG_HOME:path.join(root,'user-config'),DSH_HOME:path.join(root,'home')},stdio:['ignore','pipe','pipe'],
    });
    const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
    for(const stream of [child.stdout,child.stderr])stream.on('data',part=>{output+=part;if(output.length>131072)child.kill('SIGKILL');});
    let evidence,address;
    const deadline=Date.now()+40000;
    while(Date.now()<deadline){
      if(child.exitCode!==null || child.signalCode!==null)throw new Error('Harness exited during plugin boot');
      evidence=await readFile(proof,'utf8').then(JSON.parse).catch(()=>null);
      address=/dsh web: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(output)?.[1];
      if(evidence && address)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(evidence,'Published host did not register/execute notes tools');
    assert.ok(address,'Published Web profile did not start');
    assert.equal(evidence.names.length,5);assert.equal(evidence.text,'Real Harness host');assert.deepEqual(evidence.paths,['boot.md','未命名.md']);
    assert.equal(await readFile(path.join(root,'notes','未命名.md'),'utf8'),'');
    assert.equal((await fetch(address)).status,401,'published Web host requires its own authentication');
    assert.equal(await readFile(path.join(root,'notes','boot.md'),'utf8'),'Real Harness host');
    child.kill('SIGTERM');
    let timer;
    try {const result=await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Harness shutdown timed out')),10000);})]);assert.equal(result.code,0);}
    finally{clearTimeout(timer);}
  } finally {
    if(child && child.exitCode===null && child.signalCode===null){child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));}
    await rm(root,{recursive:true,force:true});
  }
});
