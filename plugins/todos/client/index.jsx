import React, { useEffect, useRef } from 'react';
import { defineStore } from '@deepseek-ai/dsh-client-store';
import { v4 as uuidv4 } from 'uuid';
import TextareaAutosize from 'react-textarea-autosize';
import { ArrowLeft, Check, CheckCheck, CircleCheck, Download, ListTodo, MoreHorizontal, Plus, RefreshCw, Search, Undo2, X } from 'lucide-react';
import { createTodoDraftRecovery, hasUnsavedTodoDraft, snapshotTodoDraft, restoreTodoDraft } from './drafts.mjs';
import styles from './todos.css';
import tokens from './astryx-tokens.css';

const labels = { open: '未完成', done: '已完成', cancelled: '已取消' };
const fresh = () => ({ title: '', body: '', notePath: '' });
const draftOf = item => ({ title: item.title, body: item.body, notePath: item.notePath || '' });
const hasChanges = model => {
  const original = model.item ? draftOf(model.item) : fresh();
  return Object.keys(original).some(key => original[key] !== model.draft[key]);
};
const initial = () => ({ identity: null, ready: false, changed: false, loading: false, listing: false,
  items: [], hasMore: false, cursor: null, filter: 'open', query: '', search: '', refreshQueued: false,
  item: null, draft: fresh(), pending: null, latest: null, conflict: false, editorOpen: false,
  quickTitle: '', quickPending: null, quickSaveState: 'clean', quickError: '',
  rowPending: null, rowSaveState: 'clean', rowError: '', lastRow: null,
  error: '', listError: '', notice: '', saveState: 'clean', saveOnLeave: true, leaveSaveReady: false, leaveSaveBlocked: false });
const hasPending = model => Boolean(model.pending || model.quickPending || model.rowPending);

function TodosPage({ useStore, actions, call, getState, drafts, usePersistence }) {
  const model = useStore(state => state.model);
  const persistence = usePersistence(state => state);
  const quickInput = useRef(null);
  const searchInput = useRef(null);
  const page = useRef(null);
  const titleInput = useRef(null);
  const bodyInput = useRef(null);
  const quickComposing = useRef(false);
  const detailComposing = useRef(false);
  const set = change => actions.replace({ ...getState(), ...change });
  const unavailable = !model.ready || model.changed || persistence.rootChanged;
  const busy = model.loading || hasPending(model) || unavailable;
  const dirty = hasChanges(model);
  function closeMenu() { const menu = page.current?.querySelector('.corilo-todos-more'); if (menu) menu.open = false; }
  async function focusQuick() {
    if (getState().editorOpen) { await leaveEditor(); if (getState().editorOpen) return; }
    quickInput.current?.focus();
  }

  async function list({ more = false, filter, query } = {}) {
    const previous = getState();
    if (previous.changed || !previous.ready) return;
    const selected = filter ?? previous.filter, search = query ?? previous.search;
    if (previous.listing) { set({ refreshQueued: true, filter: selected, search }); return; }
    set({ listing: true, listError: '', filter: selected, search });
    try {
      const page = await call('list', { status: selected, query: search, cursor: more ? previous.cursor : null });
      if (getState().changed) return;
      set({ items: more ? [...previous.items, ...page.items] : page.items, cursor: page.nextCursor, hasMore: page.hasMore });
    } catch (error) { set({ listError: error.message }); }
    finally {
      const queued = getState().refreshQueued;
      set({ listing: false, refreshQueued: false });
      if (queued) void list();
    }
  }

  const connection = useRef(0);
  async function connect() {
    const generation = ++connection.current;
    set({ loading: true, error: '' });
    try {
      const identity = await call('identity', {});
      if (generation !== connection.current) return;
      if (getState().identity && getState().identity !== identity.id) {
        drafts.libraryChanged();
        set({ changed: true, ready: false, error: '待办库已切换，当前输入已保留。请重新加载页面。' });
        return;
      }
      set({ identity: identity.id, ready: true });
      await drafts.start();
      if (generation === connection.current) await list();
    } catch (error) { if (generation === connection.current) set({ error: error.message, ready: false }); }
    finally { if (generation === connection.current) set({ loading: false }); }
  }
  useEffect(() => { void connect(); return () => { connection.current++; }; }, []);

  async function retainEditor() {
    if (hasPending(getState())) return false;
    const current = getState();
    if (hasChanges(current)) {
      if (current.item && current.saveOnLeave) {
        if (current.leaveSaveBlocked || current.conflict) return false;
        if (current.leaveSaveReady) return Boolean(await saveCurrent(false));
      }
      await drafts.stash(current, { scope: 'editor' });
    }
    return true;
  }
  function focusEditor() {
    if (window.matchMedia('(max-width: 700px)').matches) page.current?.scrollTo({ top: 0 });
    requestAnimationFrame(() => titleInput.current?.focus({ preventScroll: true }));
  }
  async function open(id) {
    if (busy) return;
    set({ loading: true, error: '', notice: '' });
    try {
      const kept = !getState().saveOnLeave && hasChanges(getState());
      if (!await retainEditor()) return;
      const item = await call('get', { id });
      set({ item, draft: draftOf(item), latest: null, conflict: false, saveState: 'clean', editorOpen: true, leaveSaveReady: false, leaveSaveBlocked: false,
        notice: kept ? '上一项修改已保留，可从“恢复草稿”继续。' : '' });
      focusEditor();
    } catch (error) { set({ error: error.message }); }
    finally { set({ loading: false }); }
  }
  async function leaveEditor(create = false) {
    if (busy) return;
    set({ loading: true, error: '' });
    try {
      const kept = !getState().saveOnLeave && hasChanges(getState());
      if (!await retainEditor()) return;
      set({ item: null, draft: fresh(), latest: null, conflict: false, saveState: 'clean', editorOpen: create, leaveSaveReady: false, leaveSaveBlocked: false,
        notice: kept ? '修改已保留，可从“恢复草稿”继续。' : '' });
      if (create) focusEditor();
      else requestAnimationFrame(() => quickInput.current?.focus({ preventScroll: true }));
    } catch (error) { set({ error: error.message }); }
    finally { set({ loading: false }); }
  }
  async function protectRequest() {
    try { await drafts.flush(); } catch { /* Visible persistence warning remains; direct host saves still work. */ }
  }
  async function submit(request) {
    if (getState().changed || !getState().ready) return;
    set({ pending: request, saveState: 'saving', error: '', notice: '' });
    await protectRequest();
    try {
      const item = await call(request.method, request.args);
      set({ item, draft: draftOf(item), pending: null, latest: null, conflict: false, editorOpen: true,
        saveState: 'saved', notice: '', leaveSaveReady: false, leaveSaveBlocked: false });
      await list();
      return item;
    } catch (error) {
      set({ leaveSaveBlocked: true, leaveSaveReady: false, pending: error.unknown ? request : null, saveState: error.unknown ? 'unknown' : 'failed',
        conflict: error.code === 'todos/409', latest: null, error: error.message });
    }
  }
  async function saveCurrent(explicit = true) {
    const current = getState();
    if (hasPending(current) || current.changed || !current.ready || current.conflict || detailComposing.current) return false;
    if (!hasChanges(current) && current.item) return current.item;
    if (!explicit && (!current.item || !current.leaveSaveReady || current.leaveSaveBlocked)) return false;
    if (!current.draft.title.trim()) { set({ error: '待办标题不能为空。', leaveSaveBlocked: true }); return false; }
    const fields = { title: current.draft.title, body: current.draft.body, notePath: current.draft.notePath || null };
    return submit(current.item
      ? { method: 'update', args: { id: current.item.id, expected: current.item.version, requestId: uuidv4(), patch: fields } }
      : { method: 'create', args: { requestId: uuidv4(), ...fields } });
  }
  function save() { if (!busy) void saveCurrent(); }
  async function changeStatus(status) {
    if (busy) return;
    const current = getState();
    if (current.item && current.saveOnLeave && hasChanges(current)) {
      if (current.leaveSaveBlocked || !await saveCurrent(true)) return;
    }
    const latest = getState();
    if (hasPending(latest) || hasChanges(latest) || latest.conflict || !latest.item) return;
    void submit({ method: 'update', args: { requestId: uuidv4(), id: latest.item.id, expected: latest.item.version, patch: { status } } });
  }
  function leaveDetail(event) {
    if (event.currentTarget.contains(event.relatedTarget) || event.relatedTarget?.closest('.corilo-todos button, .corilo-todos summary')) return;
    const current = getState();
    if (current.saveOnLeave && current.item && hasChanges(current) && current.leaveSaveReady && !current.leaveSaveBlocked && !hasPending(current) && !current.conflict && !detailComposing.current) void saveCurrent(false);
  }
  async function submitQuick(request) {
    if (getState().changed || !getState().ready) return;
    set({ quickPending: request, quickSaveState: 'saving', quickError: '', notice: '' });
    await protectRequest();
    try {
      await call(request.method, request.args);
      set({ quickTitle: '', quickPending: null, quickSaveState: 'saved', quickError: '', notice: '已添加，可以继续记录。' });
      requestAnimationFrame(() => quickInput.current?.focus());
      // A new open task must be visible even when it was added from completed
      // results or a search that would otherwise hide its successful creation.
      const selected = getState().filter;
      set({ query: '' });
      await list({ filter: selected === 'all' ? 'all' : 'open', query: '' });
    } catch (error) {
      set({ quickPending: error.unknown ? request : null, quickSaveState: error.unknown ? 'unknown' : 'failed', quickError: error.message });
    }
  }
  async function addQuick(event) {
    event.preventDefault();
    if (busy || hasPending(getState()) || quickComposing.current || !getState().quickTitle.trim()) return;
    const current = getState();
    if (current.item && current.saveOnLeave && current.leaveSaveReady && !current.leaveSaveBlocked && !current.conflict && hasChanges(current) && !await saveCurrent(false)) return;
    void submitQuick({ method: 'create', args: { requestId: uuidv4(), title: getState().quickTitle, body: '', notePath: null } });
  }
  async function submitRow(request) {
    if (getState().changed || !getState().ready) return;
    set({ rowPending: request, rowSaveState: 'saving', rowError: '', notice: '' });
    await protectRequest();
    try {
      const updated = await call(request.method, request.args);
      const current = getState();
      const editor = current.item?.id === updated.id && !hasChanges(current)
        ? { item: updated, draft: draftOf(updated), saveState: 'saved', conflict: false, latest: null } : {};
      set({ ...editor, rowPending: null, rowSaveState: 'saved', rowError: '', lastRow: updated.status === 'done' ? updated : null, notice: updated.status === 'done' ? '' : '已撤销完成。' });
      await list();
    } catch (error) {
      set({ rowPending: error.unknown ? request : null, rowSaveState: error.unknown ? 'unknown' : 'failed',
        rowError: error.code === 'todos/409' ? '这项待办已有更新，列表已刷新。请核对后再操作。' : error.message });
      if (!error.unknown) await list();
    }
  }
  async function toggleRow(item) {
    if (busy) return;
    let current = getState();
    if (current.item && current.saveOnLeave && hasChanges(current)) {
      const saveThis = current.item.id === item.id;
      if (saveThis && current.leaveSaveBlocked) return;
      if ((saveThis || current.leaveSaveReady && !current.leaveSaveBlocked && !current.conflict) && !await saveCurrent(saveThis)) return;
    }
    current = getState();
    if (hasPending(current) || (current.item?.id === item.id && hasChanges(current))) return;
    const latest = current.item?.id === item.id ? current.item : item;
    void submitRow({ method: 'update', args: { requestId: uuidv4(), id: latest.id, expected: latest.version,
      patch: { status: latest.status === 'open' ? 'done' : 'open' } }, item: latest });
  }
  async function compare() {
    if (busy || !model.item) return;
    set({ loading: true });
    try { set({ latest: await call('get', { id: model.item.id }) }); }
    catch (error) { set({ error: error.message }); }
    finally { set({ loading: false }); }
  }
  function discard() {
    if (busy || !window.confirm('放弃当前未保存的修改？主机上的待办不会改变。')) return;
    set({ draft: model.item ? draftOf(model.item) : fresh(), latest: null, conflict: false, error: '', notice: '已放弃当前修改。', saveState: 'clean', leaveSaveReady: false, leaveSaveBlocked: false });
  }
  async function exportTodos() {
    if (busy) return;
    set({ loading: true, error: '' });
    try {
      const data = await call('export', {});
      const href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = href; anchor.download = 'corilo-todos.json'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      set({ notice: '已导出待办 JSON。' });
    } catch (error) { set({ error: error.message }); }
    finally { set({ loading: false }); }
  }
  async function recover(record) {
    if (busy) return;
    set({ loading: true, error: '' });
    try {
      if (record.scope === 'editor') {
        if (hasChanges(getState())) await drafts.stash(getState(), { scope: 'editor' });
      } else if (hasUnsavedTodoDraft(getState())) await drafts.stash(getState());
      const recovered = { ...restoreTodoDraft(getState(), record), latest: null,
        editorOpen: Boolean(record.draft.editorOpen || record.draft.pending), leaveSaveReady: false,
        leaveSaveBlocked: Boolean(record.draft.leaveSaveBlocked || record.draft.pending || record.draft.conflict || ['failed', 'unknown'].includes(record.draft.saveState)) };
      actions.replace(recovered); drafts.adopt(record, recovered);
    } catch (error) { set({ error: error.message }); }
    finally { set({ loading: false }); }
  }
  const edit = (key, value) => set({ draft: { ...getState().draft, [key]: value }, saveState: 'dirty', notice: '', leaveSaveReady: true });
  return <section ref={page} tabIndex={-1} className={`corilo-todos${model.editorOpen ? ' is-editing' : ''}`} data-ui="astryx-neutral" aria-label="Corilo 待办"
    onPointerDownCapture={event => {
      const menu = page.current?.querySelector('.corilo-todos-more[open]');
      if (menu && !menu.contains(event.target)) closeMenu();
    }}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229 || detailComposing.current || quickComposing.current) return;
      if (event.key === 'Escape') {
        if (page.current?.querySelector('.corilo-todos-more[open]')) { closeMenu(); event.preventDefault(); event.stopPropagation(); return; }
        if (model.editorOpen) { event.preventDefault(); event.stopPropagation(); void leaveEditor(); return; }
      }
      const typing = event.target.closest('input, textarea, select, [contenteditable="true"]');
      if (!typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.key.toLowerCase() === 'n') { event.preventDefault(); event.stopPropagation(); void focusQuick(); }
        if (event.key === '/' && searchInput.current?.getClientRects().length) { event.preventDefault(); event.stopPropagation(); searchInput.current?.focus(); }
        if (event.target.closest('.corilo-todos-item-title') && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
          const rows = [...page.current.querySelectorAll('.corilo-todos-item-title:not(:disabled)')];
          const index = rows.indexOf(event.target.closest('.corilo-todos-item-title'));
          rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
          event.preventDefault(); event.stopPropagation();
        }
      }
      if (event.target.closest('.corilo-todos-editor') && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && model.editorOpen && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); event.stopPropagation(); save(); }
    }}>
    <header className="corilo-todos-header"><div className="corilo-todos-heading"><ListTodo size={19} aria-hidden="true" /><h1>待办</h1></div><div className="corilo-todos-header-actions"><button aria-label="新增待办" title="新增待办" disabled={busy} onClick={focusQuick}><Plus size={18} aria-hidden="true" /></button><details className="corilo-todos-more"><summary><MoreHorizontal size={18} aria-hidden="true" /><span>更多操作</span></summary><div className="corilo-todos-popover">
      <label className="corilo-todos-auto-option"><input type="checkbox" aria-label="离开详情时保存" checked={model.saveOnLeave} onChange={event => set({ saveOnLeave: event.target.checked })} />离开详情时保存修改</label>
      <button disabled={busy} onClick={() => { closeMenu(); void leaveEditor(true); }}><Plus size={16} aria-hidden="true" />新待办</button><button disabled={busy} onClick={() => { closeMenu(); void exportTodos(); }}><Download size={16} aria-hidden="true" />导出待办 JSON</button>
      <p className="corilo-todos-shortcuts">列表中 N 新增 · / 查找 · Esc 返回</p>
    </div></details></div></header>
    {model.quickError && <p role="alert">{model.quickError}</p>}
    {model.quickPending && model.quickSaveState === 'unknown' && <div className="corilo-todos-resolution" data-tone="warning"><p>新增结果待确认，输入已保留。</p>
      <button disabled={model.changed} onClick={() => submitQuick(model.quickPending)}>重试新增</button></div>}
    {model.changed && <p role="alert">待办库已切换，写入已暂停。当前内容仍在编辑器中，请重新加载页面。</p>}
    {!model.ready && !model.changed && <button disabled={model.loading} onClick={connect}>重新连接</button>}
    {persistence.candidates.length > 0 && <details className="corilo-todos-drafts"><summary>恢复草稿（{persistence.candidates.length}）</summary>
      <section aria-label="待恢复待办草稿"><ul>{persistence.candidates.map(record => <li key={record.id}>
        <span>{record.draft.quickTitle || record.draft.draft.title || record.draft.item?.title || record.draft.rowPending?.item?.title || '未确认的操作'}</span>
        <details><summary>预览草稿</summary><p>{record.draft.draft.body || record.draft.quickTitle || '待确认操作已保留，恢复不会自动提交。'}</p></details>
        <button disabled={busy} onClick={() => recover(record)}>恢复草稿</button>
        <button disabled={busy} onClick={() => { if (window.confirm('永久丢弃这份浏览器草稿？主机上的待办不会改变。')) void drafts.discard(record); }}>丢弃草稿</button>
      </li>)}</ul></section>
    </details>}
    {persistence.error && <p role="alert">{persistence.error} {!persistence.rootChanged && <button onClick={() => drafts.start()}>重试草稿保护</button>}</p>}
    <p className={`corilo-todos-persistence${persistence.status === 'failed' ? '' : ' corilo-todos-sr-only'}`} data-testid="todo-draft-persistence" aria-live="polite">{persistence.status === 'pending' ? '正在保护输入…' : persistence.status === 'stored' ? '草稿已保存在此浏览器，尚未保存到主机。' : persistence.status === 'failed' ? '草稿保护未完成，请保存后再关闭。' : ''}</p>
    {model.rowPending && model.rowSaveState === 'unknown' && <div className="corilo-todos-resolution" data-tone="warning"><p>这次完成或撤销的结果待确认，未自动重发。</p>
      <button disabled={model.changed} onClick={() => submitRow(model.rowPending)}>重试列表操作</button></div>}
    {model.rowError && <p role="alert">{model.rowError}</p>}
    {model.lastRow && <p className="corilo-todos-undo" aria-live="polite"><CircleCheck size={16} aria-hidden="true" />已完成：{model.lastRow.title} <button disabled={busy} onClick={() => toggleRow(model.lastRow)}><Undo2 size={15} aria-hidden="true" />撤销完成</button></p>}
    {model.notice && !['已添加，可以继续记录。', '已撤销完成。'].includes(model.notice) && <p className="corilo-todos-notice" aria-live="polite">{model.notice}</p>}
    <div className={`corilo-todos-grid ${model.editorOpen ? 'has-editor' : ''}`}>
      <aside aria-label="待办列表">
        <div className="corilo-todos-browser-toolbar"><div className="corilo-todos-list-tools"><div className="corilo-todos-tabs" role="group" aria-label="待办状态筛选">
          {['open', 'done', 'all', 'cancelled'].map(status => <button key={status} aria-pressed={model.filter === status} disabled={unavailable || model.listing}
            onClick={() => list({ filter: status })}>{labels[status] || '全部'}</button>)}
          </div><button disabled={unavailable || model.listing} aria-label="刷新待办" title="刷新待办" onClick={() => list()}><RefreshCw size={17} aria-hidden="true" /></button></div>
        <form className="corilo-todos-search" role="search" onSubmit={event => { event.preventDefault(); void list({ query: model.query }); }}>
          <label><span className="corilo-todos-sr-only">搜索待办</span><input ref={searchInput} aria-label="搜索待办" placeholder="搜索待办" value={model.query} onChange={event => set({ query: event.target.value })} /></label>
          <button disabled={unavailable || model.listing} aria-label="搜索" title="搜索"><Search size={17} aria-hidden="true" /></button></form></div>
        <form className="corilo-todos-quick" aria-label="快速新增待办" onSubmit={addQuick}>
          <Plus size={18} aria-hidden="true" className="corilo-todos-quick-icon" />
          <label><span className="corilo-todos-sr-only">快速新增待办</span><input ref={quickInput} aria-label="快速新增待办" maxLength={200}
            disabled={busy} placeholder="添加一件要做的事，按 Enter 确认" value={model.quickTitle}
            onCompositionStart={() => { quickComposing.current = true; }} onCompositionEnd={() => { quickComposing.current = false; }}
            onKeyDown={event => { if (event.key === 'Enter' && (quickComposing.current || event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }}
            onChange={event => set({ quickTitle: event.target.value, quickSaveState: 'dirty', quickError: '', notice: '' })} /></label>
          <button className="corilo-todos-primary" disabled={busy || !model.quickTitle.trim()} aria-label="添加" title="回车添加">{model.quickSaveState === 'saving' ? '…' : <Plus size={18} aria-hidden="true" />}</button>
        </form>
        <span className="corilo-todos-sr-only" aria-live="polite">{model.quickSaveState === 'saved' ? '已添加，可以继续记录。' : ''}</span>
        {model.search && <div className="corilo-todos-search-result"><span>搜索：{model.search}</span><button disabled={unavailable || model.listing} onClick={() => { set({ query: '' }); void list({ query: '' }); }}>清除搜索</button></div>}
        {model.listError && <p role="alert">{model.listError}</p>}{model.listing && <p aria-live="polite">正在读取待办…</p>}
        {!model.listing && model.ready && !model.items.length && <div className="corilo-todos-empty"><CheckCheck size={30} strokeWidth={1.4} aria-hidden="true" /><p>{model.search ? '没有找到匹配的待办，试试其他关键词。' : model.filter === 'open' ? '暂时没有待办，记下一件要做的事。' : `暂无${labels[model.filter] || ''}待办。`}</p></div>}
        <ul className="corilo-todos-items">{model.items.map(item => <li key={item.id} data-status={item.status} data-selected={model.item?.id === item.id || undefined}>
          <button role="checkbox" aria-checked={item.status === 'done'} aria-label={`${item.status === 'cancelled' ? '重新打开' : '完成'}：${item.title}`}
            className="corilo-todos-check" disabled={busy || (!model.saveOnLeave && model.item?.id === item.id && dirty)} onClick={() => toggleRow(item)}>{item.status === 'done' && <Check size={14} aria-hidden="true" />}</button>
          <button className="corilo-todos-item-title" aria-label={item.title} aria-current={model.item?.id === item.id ? 'page' : undefined}
            disabled={busy} onClick={() => open(item.id)}><span>{item.title}</span>{item.body && <small>{item.body.split('\n')[0].slice(0, 80)}</small>}</button>{item.status === 'cancelled' && <span className="corilo-todos-row-state">已取消</span>}
        </li>)}</ul>
        {model.hasMore && <button disabled={model.listing || unavailable} onClick={() => list({ more: true })}>加载更多待办</button>}
      </aside>
      {model.editorOpen && <div className="corilo-todos-editor" onBlur={leaveDetail} onCompositionStart={() => { detailComposing.current = true; }} onCompositionEnd={() => { detailComposing.current = false; }}>
        <div className="corilo-todos-editor-heading">
          {model.item ? <button className="corilo-todos-detail-check" role="checkbox" aria-checked={model.item.status === 'done'} aria-label={model.item.status === 'open' ? '完成待办' : '重新打开待办'} disabled={busy || model.conflict || model.leaveSaveBlocked || (!model.saveOnLeave && dirty)} onClick={() => changeStatus(model.item.status === 'open' ? 'done' : 'open')}>{model.item.status === 'done' ? <CircleCheck size={22} aria-hidden="true" /> : <span className="corilo-todos-detail-circle" />}</button> : <h2>新建待办</h2>}
          <span className="corilo-todos-record-state" data-testid="todo-record-state">{model.item ? labels[model.item.status] : ''}</span>
          <span className="corilo-todos-save-state" role="status" data-state={model.conflict ? 'conflict' : model.saveState}>{model.loading ? '读取中…' : model.saveState === 'saving' ? '保存中…' : model.saveState === 'unknown' ? '保存结果待确认' : model.conflict ? '版本冲突' : model.saveState === 'failed' ? '保存失败' : dirty ? '未保存' : model.item ? '已保存' : ''}</span>
          <button disabled={busy} aria-label="返回列表" title="返回列表（Esc）" onClick={() => leaveEditor()}><ArrowLeft size={18} className="corilo-todos-mobile-back" aria-hidden="true" /><X size={18} className="corilo-todos-desktop-close" aria-hidden="true" /></button>
        </div>
        <label className="corilo-todos-title"><span className="corilo-todos-sr-only">标题</span><TextareaAutosize ref={titleInput} aria-label="待办标题" minRows={1} maxRows={5} maxLength={200} disabled={busy} value={model.draft.title} placeholder="要做什么？" onChange={event => edit('title', event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); event.stopPropagation(); bodyInput.current?.focus(); } }} /></label>
        <label className="corilo-todos-description"><span className="corilo-todos-description-label">说明</span><TextareaAutosize ref={bodyInput} aria-label="待办说明" minRows={3} maxRows={18} maxLength={20000} disabled={busy} value={model.draft.body} placeholder="添加说明…" onChange={event => edit('body', event.target.value)} /></label>
        {(!model.item || !model.saveOnLeave || model.leaveSaveBlocked || model.saveState === 'failed' || (dirty && !model.leaveSaveReady)) && <div className="corilo-todos-save">
          <button className="corilo-todos-primary" disabled={busy || model.conflict || !model.draft.title.trim()} onClick={save}>{model.item ? '保存待办' : '创建待办'}</button></div>}
        {model.error && <p role="alert">{model.error}</p>}
        {model.pending && model.saveState === 'unknown' && <div className="corilo-todos-resolution" data-tone="warning"><p>保存结果待确认。输入和原请求已保留。</p><button disabled={model.changed} onClick={() => submit(model.pending)}>重试同一请求</button></div>}
        {model.conflict && <div className="corilo-todos-resolution" data-tone="warning"><p>待办已有更新，当前输入尚未写入。先核对最新内容。</p><button disabled={busy} onClick={compare}>查看最新待办</button></div>}
        {model.latest && <section className="corilo-todos-resolution" aria-label="最新待办"><p>最新标题：{model.latest.title}</p><p>最新状态：{labels[model.latest.status]}</p>
          <label>最新说明<textarea aria-label="最新待办说明" readOnly value={model.latest.body} /></label><p>最新关联笔记：{model.latest.notePath || '无'}</p>
          <div className="corilo-todos-actions"><button disabled={busy} onClick={() => { if (window.confirm('保留当前输入，改用刚刚读取的最新版本编辑？')) set({ item: model.latest, latest: null, conflict: false, error: '', saveState: 'dirty', leaveSaveBlocked: false, leaveSaveReady: true }); }}>保留输入，按最新版本编辑</button>
            <button disabled={busy} onClick={() => { if (window.confirm('放弃当前输入，采用刚刚读取的最新待办？')) set({ item: model.latest, draft: draftOf(model.latest), latest: null, conflict: false, error: '', saveState: 'clean', leaveSaveBlocked: false, leaveSaveReady: false }); }}>采用最新待办</button></div></section>}
        <details className="corilo-todos-extra"><summary>更多设置</summary>{dirty && <button disabled={busy} onClick={discard}>放弃修改</button>}<label>关联笔记路径<input aria-label="关联笔记路径" maxLength={1024} disabled={busy} value={model.draft.notePath} placeholder="项目/笔记.md（可选）" onChange={event => edit('notePath', event.target.value)} /></label>
          {model.draft.notePath && <p>关联路径：<code>{model.draft.notePath}</code></p>}{model.item && model.item.status !== 'cancelled' && <button disabled={busy || (!model.saveOnLeave && dirty) || model.conflict} onClick={() => changeStatus('cancelled')}>取消待办</button>}</details>
      </div>}
    </div>
    {!model.editorOpen && model.error && <p role="alert">{model.error}</p>}
  </section>;
}
function TodoIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-6"/></svg>; }
export const inject = ['slots', 'connection'];
export function apply(ctx) {
  let snapshot = initial(), lastTracked = '';
  let drafts;
  const store = defineStore({ init: () => ({ model: snapshot }), actions: {
    replace(state, model) {
      state.model = model; snapshot = model;
      const encoded = JSON.stringify(snapshotTodoDraft(model));
      if (encoded !== lastTracked) { lastTracked = encoded; drafts?.track(model); }
    },
  } });
  const call = async (method, args) => {
    const mutation = method === 'create' || method === 'update'; let result;
    try {
      const response = await fetch(`api/corilo-todos/${method}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(method !== 'identity' && snapshot.identity ? { 'x-corilo-todos-id': snapshot.identity } : {}) }, body: JSON.stringify(args) });
      if (!response.ok) throw new Error('Transport failure'); result = await response.json();
      if (!result || typeof result.ok !== 'boolean' || (result.ok ? !Object.hasOwn(result, 'value') : !result.error || typeof result.error.code !== 'string' || typeof result.error.message !== 'string')) throw new Error('Invalid response');
    } catch { throw Object.assign(new Error(mutation ? '连接失败，输入已保留。写入结果可能未知，请重试同一请求。' : '连接失败，当前输入已保留。请检查服务后重试。'), { unknown: mutation }); }
    if (!result.ok) {
      if (result.error.code === 'todos/library-changed') { snapshot = { ...snapshot, changed: true, ready: false }; drafts?.libraryChanged(); }
      throw Object.assign(new Error(result.error.message || '待办操作暂不可用'), { code: result.error.code, unknown: mutation && result.error.code === 'todos/503' });
    }
    return result.value;
  };
  drafts = createTodoDraftRecovery(() => call('identity', {}));
  ctx.effect(() => {
    const sheet = document.createElement('style'); sheet.textContent = tokens + styles; document.head.append(sheet);
    const guard = event => { if (drafts.needsLeaveWarning()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard);
    return () => { sheet.remove(); window.removeEventListener('beforeunload', guard); drafts.dispose(); };
  });
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'corilo-todos', store, inject: () => ({ call, getState: () => snapshot, drafts, hooks: { persistence: drafts } }) }, TodosPage));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'corilo-todos', order: 6, label: '待办' }, TodoIcon));
}
