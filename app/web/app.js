/* Corilo lifecycle and Pi conversation, layered on the full Files.md editor. */
clearInterval(window.saver);
let coriloBusy = false, coriloSaving = null, coriloReady = false, coriloLastRevision = -1;
let coriloMessagesSignature = '', coriloHistoryDirty = false;
let coriloNavigation = Promise.resolve(), coriloReloading = null, coriloNavigating = false;
function coriloError(error) {
    const message = error?.message || String(error);
    document.getElementById('corilo-status').textContent = '操作失败 · 内容未确认保存';
    document.getElementById('corilo-error').textContent = message;
    document.getElementById('corilo-agent').classList.add('open');
    document.getElementById('corilo-save-draft').hidden = ![editor, editor2].some(cm => cm?.path && !cm.isClean());
}
const bar = document.createElement('header'); bar.id = 'corilo-bar';
bar.innerHTML = '<strong>Corilo 可里</strong><button id="corilo-toggle">Agent 对话</button><button id="corilo-refresh">刷新文件</button><span id="corilo-status">正在打开本机知识库…</span>';
document.body.appendChild(bar);
const panel = document.createElement('section'); panel.id = 'corilo-agent';
panel.innerHTML = `<strong>知识库对话</strong><small id="corilo-model">Pi 默认工具 · 在线模型</small>
<details id="corilo-config"><summary>配置 DeepSeek</summary><p>对话和工具读取的相关资料会发送给模型服务商。密钥保存在知识库之外的 Pi 配置中。</p><input id="corilo-key" type="password" autocomplete="off" placeholder="DeepSeek API Key"><button id="corilo-save-key">保存配置</button></details>
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
            const oldPath = cm.path, handle = getMemFile(oldPath)?.handle;
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
                cm.path = newPath; await renderSidebar();
            }
            if (cm.isClean(generation)) cm.markClean();
            coriloHistoryDirty = true;
        }
        if (coriloHistoryDirty) {
            await coriloJSON('/api/checkpoint', {}); coriloHistoryDirty = false;
        }
        $c('corilo-status').textContent = '已保存到本机 · GitHub 同步待接入';
    })();
    try { await coriloSaving; } finally { coriloSaving = null; }
};
const upstreamOpenFile = openFile;
openFile = (...args) => {
    const task = coriloNavigation.then(async () => {
        if (!coriloBusy) await syncCurrentFile();
        coriloNavigating = true;
        for (const cm of [editor, editor2]) cm?.setOption('readOnly', true);
        try { await upstreamOpenFile(...args); }
        finally {
            coriloNavigating = false;
            for (const cm of [editor, editor2]) cm?.setOption('readOnly', coriloBusy || !!coriloReloading);
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
    finally { coriloReloading = null; for (const cm of [editor, editor2]) cm?.setOption('readOnly', coriloBusy || coriloNavigating); }
}
$c('corilo-refresh').onclick = () => coriloReload().catch(coriloError);
async function coriloPoll() {
    const state = await coriloJSON('/api/state');
    const wasBusy = coriloBusy; coriloBusy = state.busy;
    document.body.classList.toggle('corilo-busy', coriloBusy);
    for (const cm of [editor, editor2]) cm?.setOption('readOnly', coriloBusy || coriloNavigating || !!coriloReloading);
    $c('corilo-send').disabled = coriloBusy; $c('corilo-capture').disabled = coriloBusy;
    $c('corilo-stop').disabled = !coriloBusy;
    $c('corilo-model').textContent = state.model || '尚未选择模型 · 可先保存原话';
    $c('corilo-activity').textContent = state.busy ? state.activity || 'Agent 正在运行…' : ({completed:'本轮已结束',failed:'本轮失败',stopped:'已停止'}[state.outcome] || '');
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
    if (wasBusy && !coriloBusy) await coriloReload();
}
$c('corilo-send').onclick = async () => {
    try {
        $c('corilo-error').textContent = '';
        await syncCurrentFile();
        const text = $c('corilo-input').value;
        if (!text.trim()) return;
        // Freeze all editors before the server starts the run, including the first await.
        coriloBusy = true; for (const cm of [editor,editor2]) cm?.setOption('readOnly',true);
        await coriloJSON('/api/agent/prompt', { text });
        $c('corilo-input').value = ''; await coriloPoll();
    } catch (e) { coriloError(e); await coriloPoll().catch(coriloError); }
};
$c('corilo-capture').onclick = async () => {
    try {
        await syncCurrentFile(); const text = $c('corilo-input').value;
        const result = await coriloJSON('/api/capture', { text });
        $c('corilo-input').value = ''; await coriloReload(); await openFile('/'+result.path);
    } catch (e) { coriloError(e); }
};
$c('corilo-stop').onclick = () => coriloJSON('/api/agent/stop', {}).then(coriloPoll).catch(coriloError);
$c('corilo-save-key').onclick = async () => {
    try {
        await coriloJSON('/api/model', { apiKey: $c('corilo-key').value });
        $c('corilo-config').open = false; await coriloPoll();
    } catch (e) { coriloError(e); }
    finally { $c('corilo-key').value = ''; }
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
    $c('corilo-status').textContent = '本机知识库 · GitHub 同步待接入';
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
