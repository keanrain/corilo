/* Files.md lifecycle adapter for the Harness-owned filesystem and Agent. */
clearInterval(window.saver);
window.coriloMediaAllowed=url=>{try{const parsed=new URL(url,location.href);return ['blob:','data:'].includes(parsed.protocol)||parsed.origin===location.origin&&['http:','https:'].includes(parsed.protocol);}catch{return false;}};
const coriloOpenWindow=window.open.bind(window);
window.open=(url,target)=>{const parsed=new URL(url,location.href);if(!['http:','https:','mailto:'].includes(parsed.protocol))return null;return coriloOpenWindow(parsed.href,target||'_blank','noopener,noreferrer');};

let coriloReady = false, coriloSaving = null, coriloNavigation = Promise.resolve(), coriloReloading = null;
let coriloNavigating = false, coriloPaused = false, coriloChatAttempt = null, coriloCopying = false;
const coriloBlocked = new Map();
const coriloPanel = document.createElement('aside'); coriloPanel.id = 'corilo-workspace-status';
coriloPanel.innerHTML = '<button id="corilo-files" aria-label="工作区文件">文件</button><span id="corilo-status" role="status">正在打开工作区…</span><button id="corilo-agent">Agent</button><div id="corilo-error" role="alert"></div><div id="corilo-resolution" hidden><button id="corilo-verify">核对文件</button><button id="corilo-copy">保存副本</button><button id="corilo-retry">重试保存</button></div><div id="corilo-latest" hidden><textarea aria-label="文件最新内容" readonly></textarea><button id="corilo-adopt">采用文件内容</button></div>';
document.body.append(coriloPanel);
const $c = id => document.getElementById(id);
const dirty = () => [editor, editor2].some(cm => cm?.path && !cm.isClean()) || Boolean(coriloSaving) || Boolean(chatInput?.value);
function report() { parent.postMessage({type:'corilo-workspace-state',dirty:dirty()||coriloBlocked.size>0||Boolean(coriloUnknownWrite)},location.origin); }
function coriloError(error, cm = currentEditor) {
    $c('corilo-status').textContent = '当前修改尚未确认保存';
    $c('corilo-error').textContent = error?.message || String(error);
    $c('corilo-resolution').hidden = !cm?.path;
    $c('corilo-copy').hidden = isChat;
    $c('corilo-verify').hidden = isChat && !coriloUnknownWrite;
    $c('corilo-retry').hidden = isChat || Boolean(error?.unknown) || error?.status === 409;
    report();
}
function coriloSaved() {
    $c('corilo-status').textContent = dirty() ? '未保存' : '已保存到主机';
    if (!coriloBlocked.size && !coriloUnknownWrite) { $c('corilo-error').textContent = ''; $c('corilo-resolution').hidden = true; $c('corilo-latest').hidden = true; }
    report();
}
const plainText = cm => { const text = cm.getValue(), line = text.split('\n')[0];return line.startsWith('# ')?text.slice(line.length+(text.includes('\n')?1:0)):text; };
syncCurrentFile = async (explicit = false) => {
    if (!coriloReady || coriloPaused) return;
    if (coriloSaving) return coriloSaving;
    coriloSaving = (async () => {
        for (const cm of [editor, editor2]) {
            if (!cm?.path || cm.isClean()) continue;
            if (cm.state.coriloComposing) throw new Error('请等待输入法组字结束后再操作');
            const blocked = coriloBlocked.get(cm);
            if (blocked && (!explicit || blocked.unknown || blocked.status === 409)) throw blocked;
            const snapshot = cm.getValue(), generation = cm.changeGeneration(), oldPath = cm.path, handle = cm.coriloFileHandle;
            if (!handle) throw new Error('文件句柄不存在，当前输入仍保留');
            const header = snapshot.split('\n')[0], newPath = joinPath(toDirPath(oldPath), fromHeaderToFilename(header));
            try {
                const writer = await handle.createWritable(); await writer.write(plainText(cm)); await writer.close();
                if (header.startsWith('# ') && newPath !== oldPath) {
                    cm.coriloRename={from:oldPath,to:newPath};
                    await coriloJSON('/api/fs/rename', {from:oldPath,to:newPath,expected:handle.etag});
                    cm.coriloRename=null;
                    const old = getMemFile(oldPath);removeMemFile(oldPath);addMemFile(newPath,{...old,path:newPath,handle:await getFileHandle(newPath)});
                    cm.path=newPath;handle.path=newPath;handle.name=toFilename(newPath);await renderSidebar();
                }
                coriloBlocked.delete(cm);
                if(cm.isClean(generation))cm.markClean();
            } catch(error) {coriloBlocked.set(cm,error);coriloError(error,cm);throw error;}
        }
    })();
    try { await coriloSaving; } finally { coriloSaving=null; coriloSaved(); }
};
const upstreamOpenChat = openChat, upstreamOpenChatModal = openChatModal, upstreamSendToChat = sendToChat;
openChat = async (...args) => { await syncCurrentFile(); await upstreamOpenChat(...args); report(); };
openChatModal = async (...args) => { await syncCurrentFile(); await upstreamOpenChatModal(...args); report(); };
sendToChat = async (...args) => { const input=chatInput.value;try{await upstreamSendToChat(...args);coriloChatAttempt=null;coriloSaved();}catch(error){coriloChatAttempt=input;coriloError(error);} };
const upstreamOpenFile = openFile;
openFile = (...args) => {
    const task = coriloNavigation.then(async()=>{
        await syncCurrentFile();coriloNavigating=true;
        for(const cm of [editor,editor2])cm?.setOption('readOnly',true);
        try {
            await upstreamOpenFile(...args);
            const cm=args[2]==='editor2-textarea'?editor2:editor;
            const loaded=getMemFile(cm.path)?.handle;
            if(loaded){cm.coriloFileHandle=new CoriloFile(cm.path);cm.coriloFileHandle.etag=loaded.etag;}
        }finally{coriloNavigating=false;for(const cm of [editor,editor2])cm?.setOption('readOnly',Boolean(coriloReloading));report();}
    });
    coriloNavigation=task.catch(()=>{});return task;
};
async function coriloReload() {
    if(!coriloReady || coriloReloading || coriloNavigating || coriloSaving || dirty() || coriloBlocked.size)return;
    coriloReloading=(async()=>{
        await coriloNavigation;
        for(const cm of [editor,editor2])cm?.setOption('readOnly',true);
        files=await loadLocalFiles(coriloRoot);await renderSidebar();
        for(const [cm,element] of [[editor,'editor-textarea'],[editor2,'editor2-textarea']]){
            if(cm.path&&getMemFile(cm.path))await openFile(cm.path,false,element);
            else if(cm.path){cm.path=undefined;cm.setValue('');cm.markClean();}
        }
    })();
    try{await coriloReloading;}finally{coriloReloading=null;for(const cm of [editor,editor2])cm?.setOption('readOnly',coriloNavigating);report();}
}
$c('corilo-files').onclick=()=>toggleSidebar();
$c('corilo-agent').onclick=async()=>{
    try{await syncCurrentFile();if(dirty())throw Error('请先保存当前输入，再交给 Agent');parent.postMessage({type:'corilo-workspace-agent'},location.origin);}catch(error){coriloError(error);}
};
$c('corilo-retry').onclick=()=>syncCurrentFile(true).catch(coriloError);
$c('corilo-verify').onclick=async()=>{
    const cm=currentEditor;if(!cm?.path)return;
    try{
        if(coriloChatAttempt!==null&&coriloUnknownWrite){
            const request=coriloUnknownWrite.request;
            const result=await coriloJSON('/api/fs/read?path='+encodeURIComponent(request.path));
            const confirmed=result.data===request.data;
            if(!confirmed&&!confirm('文件已有不同内容。放弃尚未确认的这次录入，保留文件现状？'))return;
            coriloUnknownWrite=null;if(chatInput.value===coriloChatAttempt)chatInput.value='';coriloChatAttempt=null;
            await renderMessages();coriloSaved();return;
        }
        let verifiedPath=cm.coriloFileHandle?.path||cm.path, result;
        if(cm.coriloRename){
            try{result=await coriloJSON('/api/fs/read?path='+encodeURIComponent(cm.coriloRename.to));verifiedPath=cm.coriloRename.to;}
            catch(error){if(error.status!==404)throw error;}
        }
        if(!result)result=await coriloJSON('/api/fs/read?path='+encodeURIComponent(verifiedPath));
        const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(coriloDecode(result.data));
        if(text===plainText(cm)){
            if(coriloUnknownWrite?.request.path===verifiedPath)coriloUnknownWrite=null;
            cm.coriloFileHandle.etag=result.etag;
            if(cm.coriloRename&&verifiedPath!==cm.coriloRename.to){
                const error=Object.assign(Error('正文已核对，文件名尚未更新；可明确重试保存'),{status:400});coriloBlocked.set(cm,error);coriloError(error,cm);return;
            }
            cm.path=verifiedPath;cm.coriloFileHandle.path=verifiedPath;cm.coriloFileHandle.name=toFilename(verifiedPath);cm.coriloRename=null;
            coriloBlocked.delete(cm);cm.markClean();coriloSaved();
        }else{
            $c('corilo-latest').hidden=false;$c('corilo-latest').querySelector('textarea').value=text;
            $c('corilo-adopt').onclick=()=>{
                if(!confirm('放弃当前输入，采用刚刚读取的文件内容？'))return;
                cm.path=verifiedPath;cm.coriloFileHandle.path=verifiedPath;cm.coriloFileHandle.name=toFilename(verifiedPath);cm.coriloRename=null;if(coriloUnknownWrite?.request.path===verifiedPath)coriloUnknownWrite=null;cm.setValue(toHeader(toFilename(cm.path))+'\n'+text);cm.coriloFileHandle.etag=result.etag;cm.markClean();coriloBlocked.delete(cm);coriloSaved();
            };
        }
    }catch(error){coriloError(error);}
};
$c('corilo-copy').onclick=async()=>{
    const cm=currentEditor;if(!cm?.path||coriloCopying)return;
    const generation=cm.changeGeneration(),wasReadOnly=cm.getOption('readOnly'),originalPath=cm.coriloFileHandle?.path||cm.path;coriloCopying=true;cm.setOption('readOnly',true);
    try{
        const copied=await coriloJSON('/api/fs/copy',{text:plainText(cm)});
        const result={value:copied};
        const file=await getFileHandle('/'+result.value.path);
        if(!cm.isClean(generation))throw Error('副本已保存，但编辑器又有新输入，请继续核对或再次保存副本');
        cm.path='/'+result.value.path;cm.coriloFileHandle=file;file.etag=result.value.version;if(coriloUnknownWrite?.request.path===originalPath)coriloUnknownWrite=null;
        cm.setValue(toHeader(toFilename(cm.path))+'\n'+result.value.text);cm.markClean();coriloBlocked.delete(cm);await coriloReload();await openFile(cm.path);coriloSaved();
    }catch(error){coriloError(error);}
    finally{coriloCopying=false;cm.setOption('readOnly',wasReadOnly||coriloNavigating||Boolean(coriloReloading));}
};
init=async()=>{
    const response=await fetch('../identity',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:'{}'});
    const result=await response.json();if(!result.ok||!result.value.workspaceId)throw Error('工作区身份未确认');coriloWorkspaceId=result.value.workspaceId;
    isMemFS=false;files=await loadLocalFiles(coriloRoot);initChat();chatInput.addEventListener('input',report);await renderSidebar();coriloReady=true;
    for(const cm of [editor,editor2]){
        cm.on('change',report);
        cm.getInputField().addEventListener('compositionstart',()=>{cm.state.coriloComposing=true;});
        cm.getInputField().addEventListener('compositionend',()=>{cm.state.coriloComposing=false;});
        cm.addKeyMap({'Ctrl-S':()=>syncCurrentFile(true).catch(coriloError),'Cmd-S':()=>syncCurrentFile(true).catch(coriloError)});
    }
    const first=Object.keys(files).find(name=>name.endsWith('.md')&&name!=='Chat.md');
    if(first)await openFile('/'+first);else await openChat();
    coriloSaved();
    window.saver=setInterval(()=>{if(!coriloBlocked.size)syncCurrentFile().catch(coriloError);},1000);
};
window.addEventListener('beforeunload',event=>{if(dirty()||coriloBlocked.size){event.preventDefault();event.returnValue='';}});
window.addEventListener('unhandledrejection',event=>{coriloError(event.reason);event.preventDefault();});
window.addEventListener('focus',()=>coriloReload().catch(coriloError));
window.addEventListener('blur',()=>syncCurrentFile().catch(coriloError));
window.addEventListener('message',event=>{if(event.source===parent&&event.origin===location.origin&&event.data?.type==='corilo-workspace-visible')void coriloReload().catch(coriloError);});
