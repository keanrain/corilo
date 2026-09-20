'use strict';
// This is a minimal prototype entrance, not the upstream CodeMirror/HyperMD UI.
// No external script, model endpoint, service worker, or synchronization starts here.
const $ = (id) => document.getElementById(id);
const session = document.querySelector('meta[name="xuye-session"]').content;
let info, notes = [], current = null, rawBase = '', version = null, saving = false;
let pendingSave = null, pendingCapture = null, pendingCreate = null;
let readEpoch = 0, listEpoch = 0;
const normalized = text => text.replace(/\r\n?/g, '\n');

function status(id, text, error = false) {
  $(id).textContent = text;
  $(id).classList.toggle('error', error);
}
function storageKey(name) { return `xuye-prototype:${info.vault_id}:${name}`; }
function cached(name, value) {
  try { localStorage.setItem(storageKey(name), JSON.stringify(value)); }
  catch { status('save-status', '草稿未能缓存；请先复制未保存文字。', true); }
}
function readCache(name) {
  try { return JSON.parse(localStorage.getItem(storageKey(name)) || 'null'); }
  catch { return null; }
}
async function api(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let response;
  try { response = await fetch(path, { signal: controller.signal, method: body === undefined ? 'GET' : 'POST',
    headers: {'X-Xuye-Session': session, ...(body === undefined ? {} : {'Content-Type':'application/json'})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}) }); }
  finally { clearTimeout(timer); }
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error?.message || '请求失败');
    error.code = result.error?.code;
    throw error;
  }
  return result;
}
function dirty() { return current !== null && $('editor-textarea').value !== normalized(rawBase); }
function leaveEditor() {
  if (saving) return false;
  if (pendingSave) {
    status('save-status', '先重试保存以核对未确认结果；不要创建另一份提交。', true);
    return false;
  }
  return !dirty() || confirm('当前修改尚未保存到 Markdown。离开将关闭当前编辑；是否继续？');
}
function showHome() {
  if (!leaveEditor()) return;
  readEpoch++;
  current = null;
  $('home-view').hidden = false;
  $('note-view').hidden = true;
  $('breadcrumb').textContent = '你的想法，从这里继续';
  $('home-button').classList.add('active');
  document.body.classList.remove('sidebar-open');
  cached('last-note', null);
  $('search-input').value = '';
  refresh();
}
function renderList() {
  $('tree').replaceChildren();
  notes.forEach(note => {
    const button = document.createElement('button');
    button.className = `file-link${current === note.path ? ' selected' : ''}`;
    button.title = note.path;
    const icon = document.createElement('span'); icon.className = 'file-icon'; icon.textContent = '▤';
    button.append(icon, document.createTextNode(note.title || '空白笔记'));
    if (!note.capture && note.path.includes('/')) {
      const path = document.createElement('small'); path.textContent = note.path; button.append(path);
    }
    button.addEventListener('click', () => openNote(note.path));
    $('tree').append(button);
  });
  $('file-count').textContent = ` · ${notes.length} 页`;
}
function renderCaptures(allNotes) {
  $('chat').replaceChildren();
  const captures = allNotes.filter(n => n.capture).slice(0, 20);
  $('empty-state').hidden = captures.length !== 0;
  captures.forEach(note => {
    const card = document.createElement('article'); card.className = 'record';
    const text = document.createElement('p'); text.textContent = note.excerpt;
    const footer = document.createElement('div'); footer.className = 'record-footer';
    const label = document.createElement('span'); label.textContent = `本地已保存 · ${new Date(note.mtime * 1000).toLocaleString()}`;
    const button = document.createElement('button'); button.textContent = '打开原文 ↗';
    button.addEventListener('click', () => openNote(note.path));
    footer.append(label, button); card.append(text, footer); $('chat').append(card);
  });
}
async function refresh() {
  const epoch = ++listEpoch;
  try {
    const result = await api('/api/notes?q=' + encodeURIComponent($('search-input').value));
    if (epoch !== listEpoch) return;
    notes = result.notes;
    renderList();
    $('list-warning').hidden = result.unavailable.length === 0;
    $('list-warning').textContent = `${result.unavailable.length} 个文件无法读取或待恢复；未修改它们。`;
    if (!$('search-input').value) renderCaptures(notes);
  } catch (error) { status('capture-status', error.message, true); }
}
function persistDraft() {
  if (current) cached('draft', {path: current, content: $('editor-textarea').value, rawBase, version, pendingSave});
}
async function openNote(path, skipGuard = false) {
  if (!skipGuard && !leaveEditor()) return;
  const epoch = ++readEpoch;
  try {
    const note = await api('/api/note?path=' + encodeURIComponent(path));
    if (epoch !== readEpoch) return;
    current = note.path; rawBase = note.content; version = note.sha256; pendingSave = null;
    $('editor-textarea').value = normalized(rawBase);
    // Mixed and CR-only line endings stay read-only in this minimal editor.
    const noCrLf = rawBase.replace(/\r\n/g, '');
    const mixed = noCrLf.includes('\r') || (rawBase.includes('\r\n') && noCrLf.includes('\n'));
    $('editor-textarea').readOnly = mixed;
    $('save-note').disabled = mixed;
    $('home-view').hidden = true; $('note-view').hidden = false;
    $('home-button').classList.remove('active');
    $('note-title').textContent = path.split('/').pop().replace(/\.md$/i, '');
    $('note-path').textContent = path;
    $('breadcrumb').textContent = '本地笔记 / ' + path;
    status('save-status', mixed ? '混合/特殊换行：原型只读，未改变原文。' : '已读取本地文件 · 修改后请保存', mixed);
    cached('last-note', path);
    document.body.classList.remove('sidebar-open');
    renderList();
  } catch (error) { status(current ? 'save-status' : 'capture-status', error.message, true); }
}
async function commitKnown(endpoint, command) {
  try { return await api(endpoint, command); }
  catch (error) {
    // Version/schema errors are definite rejections. Transport/server errors require lookup.
    if (error.code && !['RESULT_UNKNOWN', 'RECOVERY_REQUIRED'].includes(error.code)) throw error;
    try {
      const result = await api('/api/operations/' + command.operation_id);
      if (result.state === 'committed') return result;
    } catch { /* Keep the same pending command; do not invent a new operation. */ }
    const unknown = new Error('结果尚未确认，输入已保留。重试会核对同一个操作，不重复新建。');
    unknown.code = 'RESULT_UNKNOWN'; throw unknown;
  }
}
async function saveNote() {
  if (!current || saving || $('editor-textarea').readOnly) return;
  if (!dirty() && !pendingSave) { status('save-status', '没有新修改 · 本地文件未改写'); return; }
  saving = true; $('save-note').disabled = true;
  const snapshot = $('editor-textarea').value;
  const capturedPath = current;
  if (!pendingSave) {
    const text = rawBase.includes('\r\n') ? snapshot.replace(/\n/g, '\r\n') : snapshot;
    pendingSave = {operation_id: crypto.randomUUID(), path: current, content: text, expected_sha256: version};
  }
  persistDraft();
  status('save-status', '正在保存到本机…');
  try {
    const sent = pendingSave;
    const receipt = await commitKnown('/api/commit', sent);
    version = receipt.sha256; rawBase = sent.content; pendingSave = null;
    if (current === capturedPath) {
      status('save-status', dirty() ? '上一版已保存；后续修改仍未保存' : '本地已保存 · 未启用同步');
      persistDraft();
    }
    await refresh();
  } catch (error) {
    if (error.code !== 'RESULT_UNKNOWN' && error.code !== 'RECOVERY_REQUIRED') pendingSave = null;
    status('save-status', error.message, true);
    persistDraft();
  } finally { saving = false; $('save-note').disabled = false; }
}
async function saveCapture() {
  if ($('send-chat').disabled) return;
  const text = $('chat-input').value;
  if (!text.trim() && !pendingCapture) return;
  $('send-chat').disabled = true;
  if (!pendingCapture) pendingCapture = {operation_id: crypto.randomUUID(), text};
  cached('capture', {text, pendingCapture});
  status('capture-status', '正在保存原话…');
  try {
    const sent = pendingCapture;
    await commitKnown('/api/captures', sent);
    pendingCapture = null;
    if ($('chat-input').value === sent.text) $('chat-input').value = '';
    cached('capture', {text: $('chat-input').value, pendingCapture: null});
    status('capture-status', '原话已保存到本地 Markdown · 没有生成任务或调用 AI');
    await refresh();
  } catch (error) {
    if (error.code && !['RESULT_UNKNOWN','RECOVERY_REQUIRED'].includes(error.code)) pendingCapture = null;
    cached('capture', {text: $('chat-input').value, pendingCapture});
    status('capture-status', error.message, true);
  } finally { $('send-chat').disabled = false; }
}
$('brand').addEventListener('click', e => {e.preventDefault(); showHome();});
$('home-button').addEventListener('click', showHome);
$('back-home').addEventListener('click', showHome);
$('toggle-sidebar').addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
$('save-note').addEventListener('click', saveNote);
$('send-chat').addEventListener('click', saveCapture);
$('reload-note').addEventListener('click', () => openNote(current));
$('refresh').addEventListener('click', refresh);
$('search-input').addEventListener('input', refresh);
$('editor-textarea').addEventListener('input', () => {
  persistDraft();
  if (!saving) status('save-status', dirty() ? '修改尚未保存到文件' : '与本地版本一致');
});
$('chat-input').addEventListener('input', () => { if (info) cached('capture', {text: $('chat-input').value, pendingCapture}); });
$('new-note').addEventListener('click', () => {
  if (!leaveEditor()) return;
  pendingCreate = null; $('new-error').textContent = ''; $('new-dialog').showModal(); $('new-path').select();
});
$('cancel-new').addEventListener('click', () => $('new-dialog').close());
$('new-form').addEventListener('submit', async event => {
  event.preventDefault();
  let path = $('new-path').value.trim();
  if (!/\.md$/i.test(path)) path += '.md';
  const submit = event.submitter; submit.disabled = true;
  pendingCreate ||= {operation_id: crypto.randomUUID(), path, content: '', expected_sha256: null};
  try {
    const receipt = await commitKnown('/api/commit', pendingCreate);
    pendingCreate = null; $('new-dialog').close(); await refresh(); await openNote(receipt.path, true);
  } catch (error) {
    $('new-error').textContent = error.message;
    if (!['RESULT_UNKNOWN','RECOVERY_REQUIRED'].includes(error.code)) pendingCreate = null;
  } finally { submit.disabled = false; }
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault(); if (current) saveNote(); else saveCapture();
  }
});
window.addEventListener('beforeunload', event => {
  if (dirty() || saving || pendingSave || pendingCapture || $('chat-input').value) {
    event.preventDefault(); event.returnValue = '';
  }
});
(async () => {
  try {
    info = await api('/api/info'); $('vault-path').textContent = info.root;
    const savedCapture = readCache('capture');
    if (savedCapture) { $('chat-input').value = savedCapture.text || ''; pendingCapture = savedCapture.pendingCapture || null; }
    await refresh();
    const draft = readCache('draft'), last = readCache('last-note');
    if (last) {
      await openNote(last, true);
      if (current === last && draft?.path === last && (draft.pendingSave || draft.content !== normalized(draft.rawBase || ''))) {
        // Recover the user's unsaved draft, but retain its original expected version.
        $('editor-textarea').value = draft.content;
        rawBase = draft.rawBase; version = draft.version; pendingSave = draft.pendingSave;
        status('save-status', '已恢复本机草稿；尚未保存，提交时将核对磁盘版本', true);
      }
    }
  } catch (error) { status('capture-status', '无法读取本地服务：' + error.message, true); }
})();
