// Test-only entrypoint in the actual worker image, using the pinned Pi default tools.
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import net from 'node:net';
import { createReadTool, createWriteTool, createEditTool, createBashTool } from '/opt/corilo/node_modules/@earendil-works/pi-coding-agent/dist/index.js';
process.on('uncaughtException',async e=>{await fs.writeFile('/state/probe-error.txt',e.stack);process.exit(1);});
const request=JSON.parse(await fs.readFile('/run/corilo/request.json','utf8'));
const bash=createBashTool('/knowledge');
if(request.prompt==='hold') {
  await fs.writeFile('/state/hold-started.txt','started');
  const held=await bash.execute('hold',{command:'(while true; do echo tick >> ticks.txt; sleep 0.05; done) & wait'},undefined);
  await fs.writeFile('/state/hold-ended.json',JSON.stringify(held));
} else {
  const read=await createReadTool('/knowledge').execute('read',{path:'note.md'},undefined);
  assert.ok(read.content.some(c=>c.text?.includes('original')));
  await createEditTool('/knowledge').execute('edit',{path:'note.md',edits:[{oldText:'original',newText:'edited in isolated Pi'}]},undefined);
  await createWriteTool('/knowledge').execute('write',{path:'created.md',content:'real default write'},undefined);
  const result=await bash.execute('bash',{command:'id -u; test ! -e /var/run/docker.sock; test ! -e /tenant; test ! -e /other-user'},undefined);
  assert.ok(result.content.some(c=>c.text?.includes(String(process.getuid()))));
  assert.notEqual(process.getuid(),0);
  await assert.rejects(fs.writeFile('/root-file','no'));
  await assert.rejects(fs.writeFile('/knowledge/.git/config','no'));
  await assert.rejects(fs.unlink('/knowledge/.corilo-host.flock'));
  await assert.rejects(fs.readFile('/other-user/private.md'));
  assert.equal(process.env.DATABASE_URL,undefined);
  assert.equal(process.env.DEEPSEEK_API_KEY,undefined);
  await new Promise((resolve,reject)=> {
    const socket=net.connect({host:'198.51.100.1',port:443});
    socket.setTimeout(1000,()=>{socket.destroy();resolve();});
    socket.once('connect',()=>{socket.destroy();reject(new Error('Unexpected network access'));});
    socket.once('error',()=>resolve());
  });
  await assert.rejects(fs.writeFile('/tmp/fill',Buffer.alloc(10*1024*1024,1)),e=>e.code==='ENOSPC');
  await fs.rm('/tmp/fill',{force:true});
  await fs.writeFile('/state/probe.json',JSON.stringify({defaultTools:true,nonRoot:true,readonlyMetadata:true,networkDenied:true,tmpQuota:true}));
}
