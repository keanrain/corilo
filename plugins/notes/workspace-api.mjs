import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('./', import.meta.url));
const prefix = '/api/corilo-notes/workspace/';
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.json':'application/json', '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf', '.png':'image/png', '.jpg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp' };
const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
const json = value => Response.json(value, { headers: { 'cache-control':'no-store' } });
const requirePatch = (source, before, after) => {
  if (!source.includes(before)) throw new Error('Pinned Files.md integration no longer matches its source');
  return source.replace(before, after);
};
function transform(name, data) {
  let source = data.toString();
  if (name === 'lib/sidebar.js') {
    source = requirePatch(source, 'span_desc.innerHTML = ret + name + "</span>";', 'span_desc.innerHTML = ret; span_desc.appendChild(document.createTextNode(name));');
    source = requirePatch(source, "span_desc.innerHTML = ret + node.toString() + '</span>';", 'span_desc.innerHTML = ret; span_desc.appendChild(document.createTextNode(node.toString()));');
  }
  if (name === 'files.js') {
    // The host stores exact Linux filenames; do not silently address a
    // different file when an existing name uses decomposed Unicode.
    source = requirePatch(source, "const filename = entry.name.normalize('NFC');", 'const filename = entry.name;');
    source = requirePatch(source, "    path = path.normalize('NFC');", '    // Preserve the exact host filename.');
  }
  if (name === 'lib/fold-image.js') {
    source = source.replaceAll('url = cm.hmdResolveURL(rawurl);', 'url = cm.hmdResolveURL(rawurl); if (!window.coriloMediaAllowed(url)) return null;');
  }
  if (name === 'lib/md.js') {
    for (const variable of ['md', 'existingContent']) {
      source = requirePatch(source, `    } catch (err) {\n        ${variable} = '';\n    }`, `    } catch (err) {\n        if (err.name !== 'NotFoundError') throw err;\n        ${variable} = '';\n    }`);
    }
  }
  if (name === 'app.js') {
    const start = source.indexOf('// Reload files once the app gains focus.'), end = source.indexOf("document.addEventListener('keydown'", start);
    if (start < 0 || end < 0) throw new Error('Pinned Files.md lifecycle patch mismatch');
    source = source.slice(0, start) + source.slice(end);
  }
  if (name === 'index.html') {
    source = source.replace('<title>Files.md</title>', '<title>Corilo · Files.md</title>')
      .replace(/    <link rel="canonical"[^\n]+\n/, '').replace(/    <link rel="manifest"[^\n]+\n/, '')
      .replace(/    <script src="welcome.js[^\n]+\n/, '')
      .replace(/    \/\/ Allow offline mode\.[\s\S]*?\.catch\([^\n]+\n/, '')
      .replace('    init();', '    init().catch(coriloError);');
    source = requirePatch(source, '<script>\n    window.COMMIT_HASH', '<link rel="stylesheet" href="host.css">\n<script src="adapter.js"></script>\n<script src="host.js"></script>\n<script>\n    window.COMMIT_HASH');
  }
  return Buffer.from(source);
}
export async function registerWorkspaceApi(ctx, store) {
  const register = route => ctx.effect(() => ctx.connection.fetch.register(route));
  const walk = async (dir, relative = '') => {
    for (const entry of await fs.readdir(dir, { withFileTypes:true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const name = relative + entry.name;
      if (entry.isDirectory()) { await walk(path.join(dir, entry.name), name + '/'); continue; }
      if (!mime[path.extname(name)] || name === 'offline.js' || name === 'manifest.json' || name === 'welcome.js') continue;
      register({ path: prefix + name, methods:['GET','HEAD'], requestBody:'buffered', async fetch(request) {
        const bytes = await fs.readFile(path.join(dir, entry.name));
        return new Response(request.method === 'HEAD' ? null : transform(name, bytes), { headers:{ 'content-type':mime[path.extname(name)], 'content-security-policy':csp, 'cache-control':'no-store', 'x-content-type-options':'nosniff', 'referrer-policy':'no-referrer' } });
      } });
    }
  };
  await walk(path.join(directory, 'vendor/filesmd/web'));
  for (const name of ['adapter.js','host.js','host.css']) {
    register({ path:prefix+name, methods:['GET'], requestBody:'buffered', async fetch() { return new Response(await fs.readFile(path.join(directory,'workspace',name)), { headers:{'content-type':mime[path.extname(name)],'cache-control':'no-store','x-content-type-options':'nosniff'} }); } });
  }
  // The streaming carrier is bounded here before parsing or allocating a file.
  register({ path:prefix+'fs', methods:['POST'], requestBody:'streaming', async fetch(request) {
    try {
      const reader = request.body?.getReader(); let size = 0; const chunks = [];
      if (!reader) throw Object.assign(new Error('请求正文缺失'),{status:400});
      while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 23 * 1024 * 1024) { await reader.cancel(); throw Object.assign(new Error('文件超过 16 MiB 限制'),{status:413}); } chunks.push(Buffer.from(part.value)); }
      if (request.headers.get('x-corilo-workspace-id') !== store.identity) return json({ ok:false, error:{status:409,message:'工作区已切换，请重新加载页面'} });
      if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return new Response('JSON required',{status:415});
      let args; try { args=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('无效 JSON'),{status:400}); }
      const fields = {copy:['text'],list:['path'],stat:['path'],version:['path'],read:['path'],create:['path','kind'],write:['path','data','expected'],rename:['from','to','expected'],remove:['path','recursive','expected']};
      if (!args || typeof args !== 'object' || Array.isArray(args) || !Object.hasOwn(fields,args.method) || Object.keys(args).some(key=>key!=='method'&&!fields[args.method].includes(key)) || fields[args.method].some(key=> !Object.hasOwn(args,key) || (key==='recursive'? typeof args[key]!=='boolean':typeof args[key]!=='string'))) throw Object.assign(new Error('工作区请求格式无效'),{status:400});
      request.signal.throwIfAborted();
      let value;
      if(args.method==='copy')value=await store.copy(args.text,request.signal);
      else if(args.method==='list')value=await store.list(args.path);
      else if(args.method==='stat')value=await store.stat(args.path);
      else if(args.method==='version')value={version:await store.versionOf(args.path)};
      else if(args.method==='read'){const file=await store.read(args.path);value={...file,data:file.data.toString('base64')};}
      else if(args.method==='create')value=await store.create(args.path,args.kind,request.signal);
      else if(args.method==='write'){
        const bytes=Buffer.from(args.data,'base64');if(bytes.toString('base64')!==args.data)throw Object.assign(new Error('无效文件内容'),{status:400});
        value=await store.write(args.path,bytes,args.expected,request.signal);
      }else if(args.method==='rename')value=await store.rename(args.from,args.to,args.expected,request.signal);
      else value=await store.remove(args.path,args.recursive,args.expected,request.signal);
      return json({ok:true,value});
    } catch(error) {
      const status = error.code==='ENOENT'?404:[400,404,409,413].includes(error.status)?error.status:503;
      return json({ok:false,error:{status,message:status===503?'工作区暂不可用，结果可能未知，请核对文件后再操作':status===404?'文件不存在':error.message,committed:error.committed===true}});
    }
  } });
}
