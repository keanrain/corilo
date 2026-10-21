/* Corilo lifecycle and Pi conversation, layered on the full Files.md editor. */
clearInterval(window.saver);
let coriloCloud = false, coriloAgentEnabled = true, coriloCloudFilesRevision = -1;
let coriloBusy = false, coriloSaving = null, coriloReady = false, coriloLastRevision = -1;
let coriloMessagesSignature = '', coriloHistoryDirty = false;
let coriloSubmitting = false, coriloPollRequest = 0, coriloCompletedRun = 0;
let coriloNavigation = Promise.resolve(), coriloReloading = null, coriloNavigating = false;
function coriloError(error) {
    const message = error?.message || String(error);
    document.getElementById('corilo-status').textContent = '操作失败 · 内容未确认保存';
    document.getElementById('corilo-error').textContent = message;
    document.getElementById('corilo-agent').classList.add('open');
    document.getElementById('corilo-save-draft').hidden = ![editor, editor2].some(cm => cm?.path && !cm.isClean());
}
const bar = document.createElement('header'); bar.id = 'corilo-bar';
bar.innerHTML = '<strong>Corilo 可里</strong><button id="corilo-toggle">Agent 对话</button><button id="corilo-refresh">刷新文件</button><button id="corilo-export" title="导出已保存笔记与附件，不含对话和配置">导出知识库</button><span id="corilo-status">正在打开本机知识库…</span>';
document.body.appendChild(bar);
const panel = document.createElement('section'); panel.id = 'corilo-agent';
panel.innerHTML = `<strong>知识库对话</strong><small id="corilo-model">Pi 默认工具 · 在线模型</small>
<div id="corilo-messages"></div><div id="corilo-results"></div><div id="corilo-error" role="alert"></div><button id="corilo-save-draft" hidden>另存当前草稿</button><small id="corilo-activity"></small>
<textarea id="corilo-input" placeholder="向知识库提问，或说明要整理、保存的内容"></textarea>
<div><button id="corilo-send">发送</button> <button id="corilo-capture">仅保存原话</button> <button id="corilo-stop" disabled>停止</button></div>`;
document.body.appendChild(panel);
const $c = id => document.getElementById(id);
$c('corilo-toggle').onclick = () => panel.classList.toggle('open');
// The old Files.md chat navigation now opens the Pi conversation.
openChat = async () => { panel.classList.add('open'); $c('corilo-input').focus(); };
openChatModal = openChat;
for (const id of ['open-folder-btn','open-folder']) document.getElementById(id).style.display = 'none';

// Replace the upstream save path: errors propagate to navigation and never mark failed writes clean.
syncCurrentFile = async () => {
    if (!coriloReady || coriloBusy) return;
    if (coriloSaving) return coriloSaving;
    coriloSaving = (async () => {
        for (const cm of [editor, editor2]) {
            if (!cm?.path || cm.isClean()) continue;
            const snapshot = cm.getValue(), generation = cm.changeGeneration();
            const oldPath = cm.path, handle = cm.coriloFileHandle;
            if (!handle) throw new Error('文件句柄不存在，草稿保留在编辑器中');
            const header = snapshot.split('\n')[0];
            const newName = fromHeaderToFilename(header);
            const newPath = joinPath(toDirPath(oldPath), newName);
            const text = header.startsWith('# ') ? snapshot.slice(header.length + (snapshot.includes('\n') ? 1 : 0)) : snapshot;
            const writer = await handle.createWritable(); await writer.write(text); await writer.close();
            if (newPath !== oldPath && header.startsWith('# ')) {
                await coriloJSON('/api/fs/rename', { from: oldPath, to: newPath });
                const old = getMemFile(oldPath); removeMemFile(oldPath);
                addMemFile(newPath, { ...old, path: newPath, handle: await getFileHandle(newPath) });
                cm.path = newPath; handle.path = newPath; handle.name = toFilename(newPath); await renderSidebar();
            }
            if (cm.isClean(generation)) cm.markClean();
            coriloHistoryDirty = true;
        }
        if (coriloHistoryDirty) {
            await coriloJSON('/api/checkpoint', {}); coriloHistoryDirty = false;
        }
        $c('corilo-status').textContent = coriloCloud ? '已保存到云端' : '已保存到本机 · 同步状态见右侧入口';
    })();
    try { await coriloSaving; } finally { coriloSaving = null; }
};
const upstreamOpenFile = openFile;
openFile = (...args) => {
    const task = coriloNavigation.then(async () => {
        if (!coriloBusy) await syncCurrentFile();
        coriloNavigating = true;
        for (const cm of [editor, editor2]) cm?.setOption('readOnly', true);
        try {
            await upstreamOpenFile(...args);
            const cm = args[2] === 'editor2-textarea' ? editor2 : editor;
            const loaded = getMemFile(cm.path)?.handle;
            if (loaded) {
                // Each editor retains the exact version it displayed, independent of other panes.
                cm.coriloFileHandle = new CoriloFile(cm.path);
                cm.coriloFileHandle.etag = loaded.etag;
            }
        }
        finally {
            coriloNavigating = false;
            for (const cm of [editor, editor2]) cm?.setOption('readOnly', coriloBusy || coriloSubmitting || !!coriloReloading);
        }
    });
    coriloNavigation = task.catch(() => {});
    return task;
};
async function coriloReload() {
    if (coriloBusy || !coriloReady) return;
    if (coriloReloading) return coriloReloading;
    coriloReloading = (async () => {
        await coriloNavigation;
        await syncCurrentFile();
        for (const cm of [editor, editor2]) cm?.setOption('readOnly', true);
        files = await loadLocalFiles(coriloRoot); await renderSidebar();
        for (const [cm, element] of [[editor,'editor-textarea'],[editor2,'editor2-textarea']]) {
            if (cm.path && getMemFile(cm.path)) await openFile(cm.path, false, element);
            else if (cm.path) {
                cm.path = undefined; cm.setValue(''); cm.markClean();
                $c('corilo-status').textContent = '原文件已删除或移动，请从文件树重新打开';
            }
        }
    })();
    try { await coriloReloading; }
    finally { coriloReloading = null; for (const cm of [editor, editor2]) cm?.setOption('readOnly', coriloBusy || coriloSubmitting || coriloNavigating); }
}
$c('corilo-refresh').onclick = () => coriloReload().catch(coriloError);
async function coriloPoll() {
    const request = ++coriloPollRequest;
    const state = await coriloJSON('/api/state');
    if (request !== coriloPollRequest) return;
    coriloCloud = state.mode === 'cloud-files';
    coriloAgentEnabled = state.capabilities?.agent !== false;
    const cloudFileChange = coriloCloud && coriloReady && state.revision !== coriloCloudFilesRevision;
    if (coriloCloud && !$c('corilo-logout')) {
        const logout = document.createElement('button'); logout.id = 'corilo-logout'; logout.textContent = '退出登录';
        logout.onclick = async () => {
            if ([editor,editor2].some(cm => cm?.path && !cm.isClean()) && !confirm('有未保存草稿，仍要退出登录吗？')) return;
            try {
                const response = await fetch('/auth/logout', { method: 'POST' });
                if (!response.ok) throw new Error('退出失败，请重试');
                sessionStorage.removeItem('corilo-token'); location.replace('/login');
            } catch (e) { coriloError(e); }
        };
        bar.appendChild(logout);
    }
    const wasBusy = coriloBusy; coriloBusy = state.busy || state.syncing;
    if (window.coriloRenderSync) window.coriloRenderSync(state.sync);
    document.body.classList.toggle('corilo-busy', coriloBusy || coriloSubmitting);
    for (const cm of [editor, editor2]) cm?.setOption('readOnly', coriloBusy || coriloSubmitting || coriloNavigating || !!coriloReloading);
    $c('corilo-send').disabled = !coriloAgentEnabled || coriloBusy || coriloSubmitting; $c('corilo-capture').disabled = coriloBusy || coriloSubmitting;
    $c('corilo-stop').disabled = !state.busy;
    $c('corilo-model').textContent = !coriloAgentEnabled ? '云端 AI 尚未开放 · 可保存原话' : state.model || '尚未选择模型 · 可先保存原话';
    $c('corilo-activity').textContent = state.syncing ? '正在同步文件…' : state.busy ? state.activity || 'Agent 正在运行…' : ({completed:'本轮已结束',failed:'本轮失败',stopped:'已停止'}[state.outcome] || '');
    if (state.error) $c('corilo-error').textContent = state.error;
    const signature = JSON.stringify([state.messages, state.liveText]);
    if (signature !== coriloMessagesSignature) {
        coriloMessagesSignature = signature; $c('corilo-messages').replaceChildren();
        for (const message of [...state.messages, ...(state.liveText ? [{role:'assistant',text:state.liveText}] : [])]) {
            const item = document.createElement('article'); item.textContent = `${message.role === 'user' ? '你' : 'Agent'}\n${message.text}${message.error ? '\n'+message.error : ''}`;
            $c('corilo-messages').append(item);
        }
        $c('corilo-messages').scrollTop = $c('corilo-messages').scrollHeight;
    }
    if (state.revision !== coriloLastRevision) {
        coriloLastRevision = state.revision;
        $c('corilo-results').replaceChildren();
        for (const filename of state.changed) {
            const button = document.createElement('button'); button.textContent = filename;
            button.onclick = async () => { try { await coriloReload(); if (!getMemFile('/'+filename)) throw new Error('文件已删除或不是可编辑笔记'); await openFile('/'+filename); } catch(e) { coriloError(e); } };
            $c('corilo-results').append(button);
        }
    }
    // A save/navigation may defer refresh. Only acknowledge the revision after files actually reload.
    if (cloudFileChange && !coriloBusy && !coriloSubmitting && !coriloSaving && !coriloReloading && !coriloNavigating && ![editor,editor2].some(cm => cm?.path && !cm.isClean())) {
        await coriloReload(); coriloCloudFilesRevision = state.revision;
    }
    if (!coriloBusy && (wasBusy || state.runId > coriloCompletedRun)) {
        coriloCompletedRun = state.runId; await coriloReload();
    }
}
function coriloUpdateInputLock() {
    document.body.classList.toggle('corilo-busy', coriloBusy || coriloSubmitting);
    for (const cm of [editor, editor2]) cm?.setOption('readOnly', coriloBusy || coriloSubmitting || coriloNavigating || !!coriloReloading);
    $c('corilo-send').disabled = !coriloAgentEnabled || coriloBusy || coriloSubmitting;
    $c('corilo-capture').disabled = coriloBusy || coriloSubmitting;
}
$c('corilo-send').onclick = async () => {
    if (coriloBusy || coriloSubmitting) return;
    const text = $c('corilo-input').value;
    if (!text.trim()) return;
    coriloSubmitting = true; coriloUpdateInputLock();
    try {
        $c('corilo-error').textContent = '';
        await coriloReloading; await coriloNavigation; await coriloSaving;
        // A previous save may have captured an older snapshot. Flush the final, now-frozen draft.
        await syncCurrentFile();
        if ([editor,editor2].some(cm => cm?.path && !cm.isClean())) throw new Error('编辑器仍有未保存修改，请保存或另存后再发送');
        await coriloJSON('/api/agent/prompt', { text });
        coriloBusy = true;
        if ($c('corilo-input').value === text) $c('corilo-input').value = '';
        await coriloPoll();
    } catch (e) { coriloError(e); await coriloPoll().catch(coriloError); }
    finally { coriloSubmitting = false; coriloUpdateInputLock(); }
};
$c('corilo-capture').onclick = async () => {
    try {
        await syncCurrentFile(); const text = $c('corilo-input').value;
        const result = await coriloJSON('/api/capture', { text });
        $c('corilo-input').value = ''; await coriloReload(); await openFile('/'+result.path);
    } catch (e) { coriloError(e); }
};
$c('corilo-stop').onclick = () => coriloJSON('/api/agent/stop', {}).then(coriloPoll).catch(coriloError);
$c('corilo-save-draft').onclick = async () => {
    try {
        const cm = [currentEditor, editor, editor2].find(candidate => candidate?.path && !candidate.isClean());
        if (!cm) return;
        const snapshot = cm.getValue(), generation = cm.changeGeneration();
        const result = await coriloJSON('/api/capture', { text: snapshot });
        if (!cm.isClean(generation)) throw new Error('草稿副本已保存，但编辑器又有新修改，请再次另存');
        cm.markClean();
        await coriloReload(); await openFile('/'+result.path);
        $c('corilo-error').textContent = ''; $c('corilo-save-draft').hidden = true;
    } catch(e) { coriloError(e); }
};
init = async () => {
    isMemFS = false;
    await coriloPoll();
    files = await loadLocalFiles(coriloRoot); initChat(); await renderSidebar();
    coriloReady = true;
    const first = Object.keys(files).find(name => name.endsWith('.md') && name !== 'Chat.md');
    if (first) await openFile('/'+first);
    panel.classList.add('open');
    $c('corilo-status').textContent = coriloCloud ? '云端知识库' : '本机知识库 · 同步状态见右侧入口';
    window.saver = setInterval(() => syncCurrentFile().catch(coriloError), 1000);
    let polling = false;
    setInterval(async () => { if (polling) return; polling = true; try { await coriloPoll(); } catch(e) { coriloError(e); } finally { polling = false; } }, 700);
};
window.addEventListener('beforeunload', event => {
    if ([editor,editor2].some(cm => cm?.path && !cm.isClean()) || coriloSaving) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('unhandledrejection', event => { coriloError(event.reason); });

window.addEventListener('focus', () => coriloReload().catch(coriloError));
window.addEventListener('blur', () => syncCurrentFile().catch(coriloError));

$c('corilo-export').onclick = async () => {
    if (coriloBusy || coriloSubmitting) { coriloError(new Error('请等待当前任务结束后导出')); return; }
    const button = $c('corilo-export'); button.disabled = true;
    coriloSubmitting = true; coriloUpdateInputLock();
    try {
        await coriloReloading; await coriloNavigation; await coriloSaving;
        await syncCurrentFile();
        if ([editor,editor2].some(cm => cm?.path && !cm.isClean())) throw new Error('请先保存或另存草稿，再导出');
        const response = await coriloRequest('/api/export/knowledge');
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = url; link.download = 'corilo-knowledge.zip';
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) { coriloError(error); }
    finally { button.disabled = false; coriloSubmitting = false; coriloUpdateInputLock(); }
};
