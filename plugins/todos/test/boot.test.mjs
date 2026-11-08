import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { TodoStore } from '../storage.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));

test('published Harness Web loads the todo plugin and persists real pipeline mutations', { timeout: 60000 }, async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'corilo-todos-boot-'));
  let child, output = '';
  try {
    const proof = path.join(base, 'proof.json'), observer = path.join(base, 'observer.mjs'), root = path.join(base, 'todos');
    const pipeline = fileURLToPath(new URL('../node_modules/@deepseek-ai/dsh-tools/lib/pipeline.js', import.meta.url));
    await writeFile(observer, `
      import {writeFile} from 'node:fs/promises';
      import {randomUUID} from 'node:crypto';
      import {ToolExecutionPipeline} from ${JSON.stringify(pipeline)};
      export const inject=['tools'];
      export async function apply(ctx){
        const names=['corilo_todos_list','corilo_todos_read','corilo_todos_create','corilo_todos_update','corilo_todos_export'];
        for(let n=0;!names.every(name=>ctx.tools.get(name));n++){
          if(n>100)throw new Error('Personal todo tools did not activate');
          await new Promise(resolve=>setTimeout(resolve,50));
        }
        const pipeline=new ToolExecutionPipeline(ctx);let id=0;
        const call=async(name,args)=>{
          const p=await pipeline.prepare({callId:String(++id),name,arguments:args,signal:new AbortController().signal});
          const result=await pipeline.complete(p.exec,p.kind==='dispatch'?await pipeline.dispatch(p.exec):p);
          if(result.isError)throw new Error('Personal todo tool failed');return result.value;
        };
        const args={requestId:randomUUID(),title:'真实宿主个人待办',body:'只使用虚构资料',notePath:'资料/背景.md'};
        const created=await call('corilo_todos_create',args);
        const retry=await call('corilo_todos_create',args);
        const done=await call('corilo_todos_update',{requestId:randomUUID(),id:created.id,expected:created.version,patch:{status:'done'}});
        const listed=await call('corilo_todos_list',{status:'all'});
        await writeFile(${JSON.stringify(proof)},JSON.stringify({names,id:done.id,title:done.title,status:done.status,sameId:retry.id===created.id,count:listed.items.length}));
      }
    `);
    const patch = path.join(base, 'todos.patch.yml');
    await writeFile(patch, JSON.stringify([{ insert: [
      { id: 'corilo-todos', name: path.join(packageRoot, 'index.mjs'), config: { root } },
      { id: 'corilo-todos-test-observer', name: observer },
    ] }]));
    child = spawn(process.execPath, [path.join(packageRoot, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--patch', patch, '--no-open', '--port', '0'], {
      cwd: base, env: { ...process.env, HOME: path.join(base, 'user-home'), XDG_CONFIG_HOME: path.join(base, 'config'), DSH_HOME: path.join(base, 'home'), DSH_AGENTS_HOME: path.join(base, 'agents') }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    for (const stream of [child.stdout, child.stderr]) stream.on('data', part => { output += part; if (output.length > 131072) child.kill('SIGKILL'); });
    let evidence, address;
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Harness exited during todo plugin boot');
      evidence = await readFile(proof, 'utf8').then(JSON.parse).catch(() => null);
      address = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(output)?.[1];
      if (evidence && address) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(evidence, 'Published host did not execute the todo pipeline');
    assert.ok(address, 'Published Web profile did not start');
    assert.equal(evidence.names.length, 5);
    assert.equal(evidence.title, '真实宿主个人待办');
    assert.equal(evidence.status, 'done');
    assert.equal(evidence.sameId, true); assert.equal(evidence.count, 1);
    assert.equal((await fetch(address)).status, 401);
    assert.equal((await fetch(address + 'api/corilo-todos/list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
    child.kill('SIGTERM');
    let timer;
    try { const result = await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Harness shutdown timed out')), 10000); })]); assert.equal(result.code, 0); }
    finally { clearTimeout(timer); }
    const reopened = await TodoStore.open(root);
    try { assert.equal((await reopened.get(evidence.id)).status, 'done'); }
    finally { await reopened.close(); }
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await new Promise(resolve => child.once('exit', resolve)); }
    await rm(base, { recursive: true, force: true });
  }
});
