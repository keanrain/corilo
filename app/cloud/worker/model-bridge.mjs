import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const route='/v1/chat/completions';
const fail=(res,status)=> {
  if(res.destroyed || res.writableEnded)return;
  if(res.headersSent) {res.destroy();return;}
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','Connection':'close'});
  res.end('{"error":{"message":"Model connection unavailable"}}');
};

// A single fixed local transport, not an HTTP proxy. The container still has no
// IP egress; its only mounted socket terminates at this run's scoped model relay.
export async function startModelBridge({socketPath='/run/corilo/model.sock',maxRequestBytes=1048576,maxResponseBytes=8388608,maxDurationMs=120000,maxConcurrent=2}={}) {
  if(typeof socketPath!=='string' || !path.isAbsolute(socketPath) || socketPath.includes('\0'))throw new Error('Invalid model socket');
  for(const [value,min,max] of [[maxRequestBytes,1024,16777216],[maxResponseBytes,1024,16777216],[maxDurationMs,50,600000],[maxConcurrent,1,16]])
    if(!Number.isInteger(value) || value<min || value>max)throw new Error('Invalid model transport limit');
  const pending=new Set();let closing=false;
  const server=http.createServer(async(req,res)=> {
    if(closing || pending.size>=maxConcurrent) {fail(res,503);req.resume();return;}
    if(req.method!=='POST' || req.url!==route) {fail(res,404);req.resume();return;}
    if(req.headers['content-type']?.split(';')[0].trim()!=='application/json' || req.headers['content-encoding']) {fail(res,400);req.resume();return;}
    const authorization=req.headers.authorization;
    if(!/^Bearer [a-f0-9]{64}$/.test(authorization || '')) {fail(res,401);req.resume();return;}
    const abort=new AbortController();pending.add(abort);let outgoing,incoming;
    const teardown=()=> {
      outgoing?.destroy();incoming?.destroy();fail(res,504);
      if(!req.complete) {
        if(res.destroyed || res.writableFinished)req.destroy();else res.once('finish',()=>req.destroy());
      }
      const force=setTimeout(()=>res.destroy(),100);force.unref();res.once('close',()=>clearTimeout(force));
    };
    abort.signal.addEventListener('abort',teardown,{once:true});
    const timer=setTimeout(()=>abort.abort(),maxDurationMs);timer.unref();
    res.once('close',()=>{if(!res.writableFinished)abort.abort();});req.once('aborted',()=>abort.abort());
    try {
      const chunks=[];let size=0;
      for await(const chunk of req.iterator({destroyOnReturn:false})) {
        size+=chunk.length;if(size>maxRequestBytes)throw Object.assign(new Error('Too large'),{status:413});
        if(abort.signal.aborted)throw new Error('Aborted');chunks.push(chunk);
      }
      if(abort.signal.aborted)throw new Error('Aborted');
      outgoing=http.request({socketPath,path:route,method:'POST',agent:false,signal:abort.signal,
        headers:{'Content-Type':'application/json','Authorization':authorization,'Content-Length':String(size)}});
      // The response event ends once()'s error listener; later stream cancellation
      // must still consume ClientRequest errors rather than crash the worker.
      outgoing.on('error',()=>{});
      const response=once(outgoing,'response',{signal:abort.signal});
      outgoing.end(Buffer.concat(chunks));[incoming]=await response;
      const type=incoming.headers['content-type']?.split(';')[0].trim();
      if(!['application/json','text/event-stream'].includes(type) || incoming.statusCode>=300 && incoming.statusCode<400)throw new Error('Invalid model response');
      res.writeHead(incoming.statusCode,{'Content-Type':type,'Cache-Control':'no-store'});
      let received=0;
      for await(const chunk of incoming) {
        received+=chunk.length;if(received>maxResponseBytes)throw new Error('Model response too large');
        if(!res.write(chunk))await once(res,'drain',{signal:abort.signal});
      }
      res.end();if(!res.writableFinished)await once(res,'finish',{signal:abort.signal});
    } catch(e) {
      fail(res,e.status===413?413:502);
      if(!res.writableFinished && !res.destroyed)await once(res,'finish',{signal:abort.signal}).catch(()=>{});
    } finally {
      clearTimeout(timer);abort.signal.removeEventListener('abort',teardown);
      outgoing?.destroy();incoming?.destroy();pending.delete(abort);
      if(!req.complete) {if(res.destroyed || res.writableFinished)req.destroy();else res.once('finish',()=>req.destroy());}
    }
  });
  server.on('connect',(_req,socket)=>socket.destroy());server.on('upgrade',(_req,socket)=>socket.destroy());
  server.requestTimeout=maxDurationMs;server.headersTimeout=Math.min(maxDurationMs,30000);server.maxHeadersCount=24;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {origin:'http://127.0.0.1:'+server.address().port,async close(){closing=true;for(const task of pending)task.abort();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}

// Only native Pi files. Never copy an operator auth.json or arbitrary executable
// packages/extensions into the temporary cloud configuration.
export async function prepareModelConfig(model,origin,source='/pi') {
  if(!model || typeof model.model!=='string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(model.model) ||
    !/^[a-f0-9]{64}$/.test(model.token || '') || !Number.isInteger(model.maxTokens) || model.maxTokens<1 || model.maxTokens>1000000)
    throw new Error('Invalid run model configuration');
  const endpoint=new URL(origin);if(endpoint.protocol!=='http:' || endpoint.hostname!=='127.0.0.1' || endpoint.pathname!=='/' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password)throw new Error('Invalid local model endpoint');
  const settings={defaultProvider:'deepseek',defaultModel:model.model,cacheWarming:'off'};
  const prior=await readFile(path.join(source,'settings.json'),'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return {};throw e;});
  // These settings carry plain core behavior only. Extension/package paths and
  // alternative model/auth settings are deliberately not copied into this run.
  if(['off','minimal','low','medium','high','xhigh'].includes(prior.defaultThinkingLevel))settings.defaultThinkingLevel=prior.defaultThinkingLevel;
  if(typeof prior.compaction?.enabled==='boolean')settings.compaction={enabled:prior.compaction.enabled};
  if(typeof prior.retry?.enabled==='boolean')settings.retry={enabled:prior.retry.enabled};
  const dir=await mkdtemp(path.join(os.tmpdir(),'corilo-pi-'));
  await writeFile(path.join(dir,'settings.json'),JSON.stringify(settings),{mode:0o600});
  await writeFile(path.join(dir,'auth.json'),JSON.stringify({deepseek:{type:'api_key',key:model.token}}),{mode:0o600});
  await writeFile(path.join(dir,'models.json'),JSON.stringify({providers:{deepseek:{baseUrl:origin+'/v1',modelOverrides:{[model.model]:{maxTokens:model.maxTokens}}}}}),{mode:0o600});
  return dir;
}
