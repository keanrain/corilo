import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readControllerConfig, inspectControllerPaths } from '../cloud/controller-config.mjs';

const configEnv = root => ({
  DATABASE_URL:'postgresql://synthetic:PRIVATE_DATABASE_SECRET@127.0.0.1:5432/test',
  CORILO_CLOUD_DATA:path.join(root,'data'), CORILO_CONTROLLER_STATE:path.join(root,'journal'),
  CORILO_MODEL_SOCKET_ROOT:path.join(root,'model'), CORILO_HOST_CONTROL_SOCKET:path.join(root,'ipc','h.sock'),
  CORILO_HOST_CONTROL_TOKEN:'a'.repeat(64),
});
const invalid = task => assert.throws(task, error => error.message === 'Invalid recovery controller configuration');

test('recovery configuration rejects missing credentials, overlapping roots and invalid bounds without printing secrets',()=>{
  const env=configEnv('/tmp/corilo-config');const config=readControllerConfig(env);
  assert.equal(config.pollMs,1000);assert.equal(config.retryMs,5000);
  assert.equal(config.journalRoot,env.CORILO_CONTROLLER_STATE);
  assert.equal(Object.hasOwn(config,'admit'),false);
  assert.equal(Object.hasOwn(config,'modelKey'),false);
  for(const key of Object.keys(env)) {const missing={...env};delete missing[key];invalid(()=>readControllerConfig(missing));}
  for(const patch of [
    {DATABASE_URL:'https://secret@example.test'}, {CORILO_HOST_CONTROL_TOKEN:'PRIVATE_TOKEN'},
    {CORILO_CLOUD_DATA:'/'}, {CORILO_CONTROLLER_STATE:env.CORILO_CLOUD_DATA},
    {CORILO_MODEL_SOCKET_ROOT:path.join(env.CORILO_CLOUD_DATA,'model')},
    {CORILO_HOST_CONTROL_SOCKET:path.join(env.CORILO_CONTROLLER_STATE,'h.sock')},
    {CORILO_CONTROLLER_STATE:'/tmp/corilo-config/../journal'},
    {CORILO_CONTROLLER_POLL_MS:'0'}, {CORILO_CONTROLLER_POLL_MS:'5001'},
    {CORILO_CONTROLLER_RETRY_MS:'100'}, {CORILO_CONTROLLER_RETRY_MS:'60001'},
    {CORILO_HOST_CONTROL_SOCKET:'/tmp/'+ 's'.repeat(100)},
  ]) invalid(()=>readControllerConfig({...env,...patch}));
});

test('recovery path preflight reads existing private directories and rejects links/modes without changing them',async t=>{
  if(process.platform!=='linux' || process.getuid()===0)return t.skip('Requires non-root Linux recovery deployment identity');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'corilo-cfg-'));
  const env=configEnv(root),config=readControllerConfig(env);
  for(const directory of [config.dataRoot,config.journalRoot,config.socketRoot,path.dirname(config.hostSocket)])
    await fs.mkdir(directory,{mode:0o700});
  const listener=net.createServer(socket=>socket.end());
  await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(config.hostSocket,resolve);});
  await fs.chmod(config.hostSocket,0o600);
  t.after(async()=>{await new Promise(resolve=>listener.close(resolve));await fs.rm(root,{recursive:true,force:true});});
  await inspectControllerPaths(config);
  await fs.chmod(config.journalRoot,0o755);
  await assert.rejects(inspectControllerPaths(config));
  assert.equal((await fs.stat(config.journalRoot)).mode&0o777,0o755,'preflight never fixes permissions silently');
  await fs.chmod(config.journalRoot,0o700);
  await fs.rename(config.socketRoot,config.socketRoot+'-real');await fs.symlink(config.socketRoot+'-real',config.socketRoot);
  await assert.rejects(inspectControllerPaths(config));
  assert.equal((await fs.lstat(config.socketRoot)).isSymbolicLink(),true);
  await fs.unlink(config.socketRoot);await fs.rename(config.socketRoot+'-real',config.socketRoot);
  await fs.rm(config.socketRoot,{recursive:true});
  await assert.rejects(inspectControllerPaths(config));
  await assert.rejects(fs.stat(config.socketRoot),error=>error.code==='ENOENT','preflight must not create missing paths');
});
