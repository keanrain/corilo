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
<div id="corilo-conversations" hidden><label for="corilo-conversation-select">已保存对话</label><select id="corilo-conversation-select" aria-label="已保存对话"></select><button id="corilo-conversation-more" hidden>更早的对话</button><small id="corilo-conversation-status" role="status"></small></div>
<div id="corilo-messages"></div><div id="corilo-results"></div><div id="corilo-error" role="alert"></div><button id="corilo-save-draft" hidden>另存当前草稿</button><small id="corilo-activity"></small>
<textarea id="corilo-input" placeholder="向知识库提问，或说明要整理、保存的内容"></textarea>
<div><button id="corilo-send">发送</button> <button id="corilo-capture">仅保存原话</button> <button id="corilo-stop" disabled>停止</button></div>`;
document.body.appendChild(panel);
const $c = id => document.getElementById(id);
// Cloud history is read-only. Selection and transcripts stay in this page, never across accounts.
let coriloConversationId = '', coriloConversationRun = null, coriloConversationVersion = 0;
let coriloConversationSignature = '', coriloConversationNext = null, coriloConversationStopping = '';
let coriloConversationListAt = 0, coriloConversationDetailAt = 0, coriloConversationPolling = false;
let coriloConversationOlderLoaded = false;
const coriloConversationItems = new Map();
const coriloRunLabels = {queued:'等待执行',running:'Agent 正在运行…',stopping:'正在停止，请稍候…',stopped:'已停止',completed:'本轮已结束',failed:'本轮失败',interrupted:'任务已中断'};
function coriloCloudRunControls() {
    if (!coriloCloud) return;
    const run = coriloConversationRun;
    $c('corilo-stop').disabled = !run || !['queued','running'].includes(run.state) || !!coriloConversationStopping;
    $c('corilo-activity').textContent = run ? coriloRunLabels[run.state] || '状态待确认' : '';
}
function coriloSelectConversation(id) {
    coriloConversationId = id; coriloConversationVersion++;
    coriloConversationRun = null; coriloConversationSignature = ''; coriloConversationDetailAt = 0;
    $c('corilo-messages').replaceChildren();
    $c('corilo-conversation-status').textContent = id ? '正在读取对话…' : '暂无已保存对话';
    coriloCloudRunControls();
}
function coriloConversationOptions() {
    const select = $c('corilo-conversation-select');
    const previous = select.value;
    const items = [...coriloConversationItems.values()].sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const signature = JSON.stringify(items.map(item => [item.id,item.createdAt,item.lastRun?.state]));
    if (select.dataset.signature === signature) return;
    select.dataset.signature = signature; select.replaceChildren();
    for (const item of items) {
        const option = document.createElement('option'); option.value = item.id;
        const date = new Date(item.createdAt);
        option.textContent = `${Number.isNaN(date.getTime()) ? '已保存对话' : date.toLocaleString()} · ${coriloRunLabels[item.lastRun?.state] || '无任务'}`;
        select.append(option);
    }
    if (!coriloConversationId && items.length) coriloSelectConversation(items[0].id);
    select.value = coriloConversationId || previous; select.disabled = !items.length;
}
async function coriloLoadConversationList(cursor = null) {
    coriloConversationListAt = Date.now();
    const result = await coriloJSON('/api/conversations' + (cursor ? '?before='+encodeURIComponent(cursor) : ''));
    for (const item of (result.items || []).slice(0,100)) coriloConversationItems.set(item.id,item);
    // Refreshing the first page must not reset pagination after older pages were loaded.
    if (cursor || !coriloConversationOlderLoaded) coriloConversationNext = result.nextCursor || null;
    if (cursor) coriloConversationOlderLoaded = true;
    coriloConversationListAt = Date.now(); coriloConversationOptions();
    $c('corilo-conversation-more').hidden = !coriloConversationNext;
    if (!coriloConversationId) $c('corilo-conversation-status').textContent = '暂无已保存对话';
}
async function coriloLoadConversation() {
    const id = coriloConversationId, version = coriloConversationVersion;
    if (!id) return;
    coriloConversationDetailAt = Date.now();
    const detail = await coriloJSON('/api/conversations/'+encodeURIComponent(id));
    if (id !== coriloConversationId || version !== coriloConversationVersion) return;
    coriloConversationDetailAt = Date.now();
    const runs = [...(detail.runs || [])].sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    coriloConversationRun = runs.find(run => ['queued','running','stopping'].includes(run.state)) || runs[0] || null;
    coriloCloudRunControls();
    const notices = {ready:'已保存的对话记录',running:'任务执行中，结束后更新已保存对话',empty:'此对话暂无消息',unavailable:'对话记录暂不可用，任务状态仍可查看'};
    $c('corilo-conversation-status').textContent = notices[detail.messagesStatus] || '对话记录暂不可用';
    // Keep a previously loaded transcript during a running task or a temporary read failure.
    if (!['ready','empty'].includes(detail.messagesStatus)) return;
    const messages = (detail.messages || []).slice(-500).map(message => ({role:message.role,text:String(message.text || '')}));
    if ((detail.messages || []).length > 500) $c('corilo-conversation-status').textContent = '仅显示最近 500 条已保存消息';
    const signature = JSON.stringify([id,messages]);
    if (signature === coriloConversationSignature) return;
    const container = $c('corilo-messages');
    const follow = !coriloConversationSignature || container.scrollHeight-container.scrollTop-container.clientHeight < 48;
    const scrollTop = container.scrollTop;
    coriloConversationSignature = signature; container.replaceChildren();
    for (const message of messages) {
        const article = document.createElement('article');
        article.textContent = `${message.role === 'user' ? '你' : 'Agent'}\n${message.text}`;
        container.append(article);
    }
    container.scrollTop = follow ? container.scrollHeight : scrollTop;
}
async function coriloPollConversations(force = false) {
    if (!coriloCloud || coriloConversationPolling) return;
    coriloConversationPolling = true;
    try {
        if (force || Date.now()-coriloConversationListAt > 5000) await coriloLoadConversationList();
        if (force || Date.now()-coriloConversationDetailAt > 2000) await coriloLoadConversation();
    } catch (_) {
        $c('corilo-conversation-status').textContent = '对话读取失败，将自动重试；草稿已保留';
    } finally { coriloConversationPolling = false; }
}
$c('corilo-conversation-select').onchange = () => {
    coriloSelectConversation($c('corilo-conversation-select').value);
    coriloLoadConversation().catch(() => { $c('corilo-conversation-status').textContent = '对话读取失败，将自动重试；草稿已保留'; });
};
$c('corilo-conversation-more').onclick = async () => {
    const button = $c('corilo-conversation-more'); button.disabled = true;
    try { if (coriloConversationNext) await coriloLoadConversationList(coriloConversationNext); }
    catch (_) { $c('corilo-conversation-status').textContent = '更早的对话读取失败，请重试'; }
    finally { button.disabled = false; }
};
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
                await coriloJSON('/api/fs/rename', { from: oldPath, to: newPath, expected: handle.etag });
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
    $c('corilo-conversations').hidden = !coriloCloud;
    if (!coriloCloud) $c('corilo-stop').disabled = !state.busy;
    $c('corilo-model').textContent = !coriloAgentEnabled ? '云端 AI 尚未开放 · 可保存原话' : state.model || '尚未选择模型 · 可先保存原话';
    $c('corilo-activity').textContent = state.syncing ? '正在同步文件…' : state.busy ? state.activity || 'Agent 正在运行…' : ({completed:'本轮已结束',failed:'本轮失败',stopped:'已停止'}[state.outcome] || '');
    if (state.error) $c('corilo-error').textContent = state.error;
    const signature = JSON.stringify([state.messages, state.liveText]);
    if (!coriloCloud && signature !== coriloMessagesSignature) {
        coriloMessagesSignature = signature; $c('corilo-messages').replaceChildren();
        for (const message of [...state.messages, ...(state.liveText ? [{role:'assistant',text:state.liveText}] : [])]) {
            const item = document.createElement('article'); item.textContent = `${message.role === 'user' ? '你' : 'Agent'}\n${message.text}${message.error ? '\n'+message.error : ''}`;
            $c('corilo-messages').append(item);
        }
        $c('corilo-messages').scrollTop = $c('corilo-messages').scrollHeight;
    }
    if (coriloCloud) { coriloCloudRunControls(); void coriloPollConversations(); }
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
    if (!coriloAgentEnabled || coriloBusy || coriloSubmitting) return;
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
$c('corilo-stop').onclick = async () => {
    if (!coriloCloud) return coriloJSON('/api/agent/stop', {}).then(coriloPoll).catch(coriloError);
    const run = coriloConversationRun, conversation = coriloConversationId;
    if (!run || !['queued','running'].includes(run.state) || coriloConversationStopping) return;
    coriloConversationStopping = run.id; coriloCloudRunControls();
    try {
        const stopped = await coriloJSON('/api/runs/'+encodeURIComponent(run.id)+'/stop', {});
        if (conversation === coriloConversationId && coriloConversationRun?.id === run.id) {
            coriloConversationVersion++; // Ignore detail responses started before the stop was confirmed.
            coriloConversationRun = stopped;
        }
        coriloConversationDetailAt = 0;
    } catch (_) {
        $c('corilo-conversation-status').textContent = '停止请求未确认，请查看最新状态后重试';
    } finally { coriloConversationStopping = ''; coriloCloudRunControls(); }
};
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
