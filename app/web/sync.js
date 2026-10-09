/* Git binding is separate from Pi's existing model configuration. No credentials enter this page. */
const syncToggle = document.createElement('button'); syncToggle.id='corilo-sync-toggle'; syncToggle.textContent='GitHub 同步'; bar.append(syncToggle);
const syncPanel=document.createElement('section'); syncPanel.id='corilo-sync';
syncPanel.innerHTML=`<strong>GitHub 同步</strong><button id="corilo-sync-close">关闭</button>
<p>使用独立的私有知识库仓库。先用本机 Git 凭据管理器登录 GitHub；此处不保存令牌。配置与对话仍只在本机。</p>
<label>仓库 HTTPS 地址 <input id="corilo-sync-url" placeholder="https://github.com/owner/notes.git"></label>
<label>同步分支 <input id="corilo-sync-branch" value="main"></label>
<div><button id="corilo-sync-bind">连接仓库</button> <button id="corilo-sync-run">立即同步</button> <button id="corilo-sync-unbind">解绑并保留文件</button></div>
<p id="corilo-sync-status" role="status"></p><p id="corilo-sync-error" role="alert"></p><div id="corilo-conflicts"></div>
<button id="corilo-sync-resolve" hidden>按选择合并并同步</button>`;
document.body.append(syncPanel);
syncToggle.onclick=()=>syncPanel.classList.toggle('open');
$c('corilo-sync-close').onclick=()=>syncPanel.classList.remove('open');
let coriloSyncState=null, coriloConflictId=null, coriloSyncRequest=false, coriloSyncError='';
const conflictInputs=new Map();
window.coriloRenderSync=state=>{
    coriloSyncState=state;
    const label={unbound:'未连接 · 仅本机',pending:'待同步',syncing:'正在同步',synced:'已同步',conflict:'有冲突',error:'同步失败 · 可重试'}[state.phase];
    syncToggle.textContent='GitHub · '+label;
    $c('corilo-sync-status').textContent=label+(state.lastSuccess ? ' · 最近成功 '+new Date(state.lastSuccess.time).toLocaleString() : '');
    if (!coriloSyncRequest) $c('corilo-sync-error').textContent=coriloSyncError||state.error||'';
    for(const id of ['bind','run','unbind','resolve']) $c('corilo-sync-'+id).disabled=coriloBusy||coriloSubmitting||coriloSyncRequest;
    $c('corilo-sync-bind').hidden=!!state.url;
    $c('corilo-sync-run').hidden=!state.url;
    $c('corilo-sync-unbind').hidden=!state.url;
    for(const key of ['url','branch']) { $c('corilo-sync-'+key).disabled=!!state.url; if(state.url) $c('corilo-sync-'+key).value=state[key]; }
    if (coriloConflictId===state.conflictId) return;
    coriloConflictId=state.conflictId; conflictInputs.clear(); $c('corilo-conflicts').replaceChildren();
    $c('corilo-sync-resolve').hidden=!state.conflictId;
    for(const file of state.conflicts) {
        const section=document.createElement('article'), title=document.createElement('h4'); title.textContent=file.path; section.append(title);
        for(const [key,label] of [['local','本机'],['remote','远端']]) {
            const detail=document.createElement('details'), summary=document.createElement('summary'), pre=document.createElement('pre');
            summary.textContent=label; pre.textContent=!file[key]?'此版本已删除':file[key].binary?`二进制或大文件（${file[key].size} 字节），可保留任一版本或两份`:file[key].text;
            detail.append(summary,pre); section.append(detail);
        }
        const select=document.createElement('select');
        for(const [value,label] of [['','请选择'],['local','保留本机'],['remote','保留远端'],['both','保留两份'],['manual','编辑合并文本']]) {
            if(value==='manual' && (file.local?.binary||file.remote?.binary)) continue;
            const option=document.createElement('option'); option.value=value; option.textContent=label; select.append(option);
        }
        const edit=document.createElement('textarea'); edit.hidden=true; edit.value=file.local?.text??file.remote?.text??'';
        select.onchange=()=>{edit.hidden=select.value!=='manual';}; section.append(select,edit);
        conflictInputs.set(file.path,{select,edit}); $c('corilo-conflicts').append(section);
    }
};
async function coriloSyncAction(action, data={}) {
    if(coriloBusy||coriloSubmitting||coriloSyncRequest) return;
    coriloSyncDue=Date.now()+60000; coriloSyncRequest=true; coriloSubmitting=true; coriloUpdateInputLock();
    try {
        coriloSyncError=''; $c('corilo-sync-error').textContent='';
        await coriloReloading; await coriloNavigation; await coriloSaving; await syncCurrentFile();
        if([editor,editor2].some(cm=>cm?.path&&!cm.isClean())) throw new Error('请先保存或另存编辑器草稿');
        await coriloJSON('/api/sync/'+action,data);
    } catch(e) { coriloSyncError=e.message; $c('corilo-sync-error').textContent=e.message; }
    finally {
        await coriloPoll().catch(coriloError);
        if(!coriloBusy) await coriloReload().catch(coriloError);
        coriloSubmitting=false; coriloSyncRequest=false; coriloUpdateInputLock();
        if(coriloSyncState) window.coriloRenderSync(coriloSyncState);
    }
}
$c('corilo-sync-bind').onclick=()=>coriloSyncAction('bind',{url:$c('corilo-sync-url').value.trim(),branch:$c('corilo-sync-branch').value.trim()});
$c('corilo-sync-run').onclick=()=>coriloSyncAction('run');
$c('corilo-sync-unbind').onclick=()=>coriloSyncAction('unbind');
$c('corilo-sync-resolve').onclick=()=>{
    const choices=Object.fromEntries([...conflictInputs].map(([name,{select,edit}])=>[name,{kind:select.value,text:edit.value}]));
    if(Object.values(choices).some(c=>!c.kind)) { $c('corilo-sync-error').textContent='请为每个冲突选择处理方式'; return; }
    return coriloSyncAction('run',{resolution:{id:coriloConflictId,choices}});
};

// Foreground-only retries; local editing and Agent execution always take precedence.
let coriloSyncDue=0, coriloLastInteraction=Date.now();
for(const event of ['input','keydown','pointerdown']) document.addEventListener(event,()=>{coriloLastInteraction=Date.now();});
window.addEventListener('focus',()=>{coriloSyncDue=0;});
setInterval(()=>{
    if(!coriloReady || !document.hasFocus() || coriloBusy || coriloSubmitting || coriloSaving || coriloNavigating || coriloReloading || !coriloSyncState?.url || coriloSyncState.conflictId) return;
    if(Date.now()-coriloLastInteraction<3000 || Date.now()<coriloSyncDue) return;
    coriloSyncDue=Date.now()+60000;
    coriloSyncAction('run').catch(coriloError);
},5000);
