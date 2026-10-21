import http from 'node:http';
import { once } from 'node:events';

class RelayError extends Error {
  constructor(status) { super('Model request unavailable'); this.status=status; }
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value,min,max) => Number.isInteger(value) && value>=min && value<=max;
const fields = new Set(['model','messages','stream','stream_options','max_tokens','temperature','top_p','tools','tool_choice','thinking','reasoning_effort']);
function validate(body, models) {
  if (!object(body) || Object.keys(body).some(key=>!fields.has(key)) || !models.has(body.model) ||
      !integer(body.max_tokens,1,1048576) || typeof body.stream!=='boolean' || !Array.isArray(body.messages) || !body.messages.length)
    throw new RelayError(400);
  if (body.stream_options!==undefined && (!object(body.stream_options) || Object.keys(body.stream_options).some(k=>k!=='include_usage') || body.stream_options.include_usage!==true)) throw new RelayError(400);
  if (body.temperature!==undefined && (typeof body.temperature!=='number' || body.temperature<0 || body.temperature>2)) throw new RelayError(400);
  if (body.top_p!==undefined && (typeof body.top_p!=='number' || body.top_p<0 || body.top_p>1)) throw new RelayError(400);
  if (body.tools!==undefined && (!Array.isArray(body.tools) || body.tools.some(t=>!object(t) || t.type!=='function' || !object(t.function)))) throw new RelayError(400);
  if (body.tool_choice!==undefined && !['auto','none','required'].includes(body.tool_choice) &&
      !(object(body.tool_choice) && body.tool_choice.type==='function' && typeof body.tool_choice.function?.name==='string')) throw new RelayError(400);
  if (body.thinking!==undefined && (!object(body.thinking) || Object.keys(body.thinking).some(k=>k!=='type') || !['enabled','disabled'].includes(body.thinking.type))) throw new RelayError(400);
  if (body.reasoning_effort!==undefined && !['none','minimal','low','medium','high','xhigh','max'].includes(body.reasoning_effort)) throw new RelayError(400);
  const messageFields=new Set(['role','content','name','tool_calls','tool_call_id','reasoning_content']);
  for (const message of body.messages) {
    if (!object(message) || Object.keys(message).some(k=>!messageFields.has(k)) ||
        !['system','user','assistant','tool'].includes(message.role) ||
        !(message.content===null || typeof message.content==='string' || Array.isArray(message.content))) throw new RelayError(400);
    // DeepSeek text-only input: never let an upstream fetch arbitrary image URLs.
    if (Array.isArray(message.content) && message.content.some(c=>!object(c) || c.type!=='text' || typeof c.text!=='string' || Object.keys(c).some(k=>!['type','text'].includes(k)))) throw new RelayError(400);
    if (message.reasoning_content!==undefined && typeof message.reasoning_content!=='string') throw new RelayError(400);
  }
  return body;
}
function jsonError(res,status) {
  if(res.destroyed || res.writableEnded)return;
  if(res.headersSent) { res.end('data: {"error":{"message":"Model request unavailable","type":"relay_error"}}\n\n'); return; }
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','Connection':'close'});
  res.end(JSON.stringify({error:{message:'Model request unavailable',type:'relay_error'}}));
}

// Trusted, internal-only service. No browser route, user-selected upstream, retries,
// credential discovery or worker networking is enabled by constructing this relay.
export async function startModelRelay({grants,apiKey,allowedModels,upstreamUrl='https://api.deepseek.com/chat/completions',
  maxRequestBytes,maxResponseBytes,maxDurationMs,maxConcurrent,checkIntervalMs=250,fetchImpl=fetch}={}) {
  if(!grants?.reserve || !grants?.assertActive || typeof apiKey!=='string' || !apiKey || /[\r\n]/.test(apiKey) ||
      !Array.isArray(allowedModels) || !allowedModels.length || allowedModels.length>32 || allowedModels.some(m=>typeof m!=='string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(m))) throw new Error('Explicit relay credentials, grants and models required');
  for(const [value,min,max] of [[maxRequestBytes,1024,16777216],[maxResponseBytes,1024,16777216],[maxDurationMs,100,600000],[maxConcurrent,1,256],[checkIntervalMs,20,5000]])
    if(!integer(value,min,max))throw new Error('Explicit bounded relay limits required');
  const upstream=new URL(upstreamUrl);
  // Alternate endpoints are trusted constructor configuration for local protocol tests.
  if(upstream.username || upstream.password || upstream.hash || upstream.search ||
      !(upstream.protocol==='https:' || upstream.protocol==='http:' && ['127.0.0.1','[::1]','localhost'].includes(upstream.hostname))) throw new Error('Unsafe model upstream');
  const models=new Set(allowedModels), pending=new Set();
  let closing=false;
  const server=http.createServer(async(req,res)=> {
    if(closing || pending.size>=maxConcurrent) { jsonError(res,503);req.resume();return; }
    if(req.method!=='POST' || req.url!=='/v1/chat/completions') { jsonError(res,404);req.resume();return; }
    if(req.headers['content-type']?.split(';')[0].trim()!=='application/json' || req.headers['content-encoding']) { jsonError(res,400);req.resume();return; }
    const match=/^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '');
    if(!match) { jsonError(res,401);req.resume();return; }
    const token=match[1], abort=new AbortController();pending.add(abort);
    const timeout=setTimeout(()=>abort.abort(),maxDurationMs);timeout.unref();
    const disconnected=()=>{ if(!res.writableEnded)abort.abort(); };
    res.once('close',disconnected);req.once('aborted',disconnected);
    let poll,reader;
    const aborted=()=>{
      // A timed-out upload may never end. Close its readable side too, otherwise
      // the body iterator retains a concurrent slot after the 504 was sent.
      if(!req.complete) {
        if(res.destroyed || res.writableFinished)req.destroy();
        else res.once('finish',()=>req.destroy());
      }
      jsonError(res,504);
      const forceClose=setTimeout(()=>res.destroy(),100);forceClose.unref();
      res.once('close',()=>clearTimeout(forceClose));
    };abort.signal.addEventListener('abort',aborted,{once:true});
    try {
      const chunks=[];let bytes=0;
      for await(const chunk of req.iterator({destroyOnReturn:false})) {
        bytes+=chunk.length;if(bytes>maxRequestBytes)throw new RelayError(413);
        if(abort.signal.aborted)throw new RelayError(504);chunks.push(chunk);
      }
      let body;try { body=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new RelayError(400); }
      validate(body,models);
      try { await grants.reserve(token,{model:body.model,maxTokens:body.max_tokens}); }
      catch(e) { throw new RelayError([400,401,403,429].includes(e.status)?e.status:503); }
      if(abort.signal.aborted)throw new RelayError(504);
      let checking=false;
      poll=setInterval(async()=> {
        if(checking)return;checking=true;
        try { await grants.assertActive(token); } catch { abort.abort(); } finally { checking=false; }
      },checkIntervalMs);poll.unref();
      const upstreamResponse=await fetchImpl(upstream,{method:'POST',redirect:'error',signal:abort.signal,
        headers:{'Content-Type':'application/json','Accept':body.stream?'text/event-stream':'application/json','Authorization':'Bearer '+apiKey},body:JSON.stringify(body)});
      if(!upstreamResponse.ok || !upstreamResponse.body) { await upstreamResponse.body?.cancel();throw new RelayError(502); }
      const type=upstreamResponse.headers.get('content-type')?.split(';')[0].trim();
      if(type!==(body.stream?'text/event-stream':'application/json')) { await upstreamResponse.body.cancel();throw new RelayError(502); }
      reader=upstreamResponse.body.getReader();let size=0,buffer='',doneMarker=false;const decoder=new TextDecoder('utf-8',{fatal:true}),whole=[];
      const write=async data=> { if(abort.signal.aborted)throw new RelayError(504);if(!res.write(data))await once(res,'drain',{signal:abort.signal}); };
      while(true) {
        const chunk=await reader.read();if(chunk.done)break;
        size+=chunk.value.byteLength;if(size>maxResponseBytes)throw new RelayError(502);
        if(!body.stream) { whole.push(Buffer.from(chunk.value));continue; }
        buffer+=decoder.decode(chunk.value,{stream:true});
        let boundary;
        while((boundary=/\r?\n\r?\n/.exec(buffer))) {
          const frame=buffer.slice(0,boundary.index);buffer=buffer.slice(boundary.index+boundary[0].length);
          if(frame.split(/\r?\n/).some(line=>/^event:\s*error\s*$/.test(line)))throw new RelayError(502);
          const data=frame.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
          if(!data)continue;
          if(doneMarker)throw new RelayError(502);
          if(data==='[DONE]') { doneMarker=true;continue; }
          let parsed;try { parsed=JSON.parse(data); } catch { throw new RelayError(502); }
          // Provider HTTP-200 error events must not disclose its diagnostics/keys.
          if(!object(parsed) || parsed.error || !Array.isArray(parsed.choices))throw new RelayError(502);
          if(!res.headersSent)res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'});
          await write('data: '+JSON.stringify(parsed)+'\n\n');
        }
      }
      if(body.stream) {
        buffer+=decoder.decode();
        if(buffer.trim() || !doneMarker)throw new RelayError(502);
        if(!res.headersSent)res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'});
        await write('data: [DONE]\n\n');res.end();
      } else {
        let parsed;try {parsed=JSON.parse(Buffer.concat(whole).toString('utf8'));}catch{throw new RelayError(502);}
        if(!object(parsed) || parsed.error || !Array.isArray(parsed.choices))throw new RelayError(502);
        if(abort.signal.aborted)throw new RelayError(504);
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(parsed));
      }
      if(!res.writableFinished)await once(res,'finish',{signal:abort.signal});
    } catch(e) {
      jsonError(res,e instanceof RelayError?e.status:502);
      if(!res.writableFinished && !res.destroyed)await once(res,'finish',{signal:abort.signal}).catch(()=>{});
    }
    finally {
      clearTimeout(timeout);clearInterval(poll);abort.signal.removeEventListener('abort',aborted);
      abort.abort();await reader?.cancel().catch(()=>{});pending.delete(abort);
      if(!req.complete) {
        if(res.destroyed || res.writableFinished)req.destroy();else res.once('finish',()=>req.destroy());
      }
    }
  });
  server.requestTimeout=maxDurationMs;server.headersTimeout=Math.min(maxDurationMs,30000);server.maxHeadersCount=32;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {origin:'http://127.0.0.1:'+server.address().port,async close(){closing=true;for(const task of pending)task.abort();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
