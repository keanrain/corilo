import React, { useEffect, useRef } from 'react';
import { defineStore } from '@deepseek-ai/dsh-client-store';
import { v4 as uuidv4 } from 'uuid';
import { createTodoDraftRecovery, hasUnsavedTodoDraft, snapshotTodoDraft } from './drafts.mjs';
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
  error: '', listError: '', notice: '', saveState: 'clean' });
const hasPending = model => Boolean(model.pending || model.quickPending || model.rowPending);

function TodosPage({ useStore, actions, call, getState, drafts, usePersistence }) {
  const model = useStore(state => state.model);
  const persistence = usePersistence(state => state);
  const quickInput = useRef(null);
  const page = useRef(null);
  const titleInput = useRef(null);
  const quickComposing = useRef(false);
  const set = change => actions.replace({ ...getState(), ...change });
  const unavailable = !model.ready || model.changed || persistence.rootChanged;
  const busy = model.loading || hasPending(model) || unavailable;
  const dirty = hasChanges(model);

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
    if (hasChanges(getState())) {
      await drafts.stash(getState());
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
      const item = await call('get', { id });
      const kept = hasChanges(getState());
      if (!await retainEditor()) return;
      set({ item, draft: draftOf(item), latest: null, conflict: false, saveState: 'clean', editorOpen: true,
        notice: kept ? '上一项修改已保留，可从“恢复草稿”继续。' : '' });
      focusEditor();
    } catch (error) { set({ error: error.message }); }
    finally { set({ loading: false }); }
  }
  async function leaveEditor(create = false) {
    if (busy) return;
    set({ loading: true, error: '' });
    try {
      const kept = hasChanges(getState());
      if (!await retainEditor()) return;
      set({ item: null, draft: fresh(), latest: null, conflict: false, saveState: 'clean', editorOpen: create,
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
        saveState: 'saved', notice: '' });
      await list();
    } catch (error) {
      set({ pending: error.unknown ? request : null, saveState: error.unknown ? 'unknown' : 'failed',
        conflict: error.code === 'todos/409', latest: null, error: error.message });
    }
  }
  function save() {
    if (busy || model.conflict || !model.draft.title.trim()) return;
    const fields = { title: model.draft.title, body: model.draft.body, notePath: model.draft.notePath || null };
    void submit(model.item
      ? { method: 'update', args: { id: model.item.id, expected: model.item.version, requestId: uuidv4(), patch: fields } }
      : { method: 'create', args: { requestId: uuidv4(), ...fields } });
  }
  function changeStatus(status) {
    if (busy || dirty || model.conflict || !model.item) return;
    void submit({ method: 'update', args: { requestId: uuidv4(), id: model.item.id, expected: model.item.version, patch: { status } } });
  }
  async function submitQuick(request) {
    if (getState().changed || !getState().ready) return;
    set({ quickPending: request, quickSaveState: 'saving', quickError: '', notice: '' });
    await protectRequest();
    try {
      await call(request.method, request.args);
      set({ quickTitle: '', quickPending: null, quickSaveState: 'saved', quickError: '', notice: '已添加，可以继续记录。' });
      requestAnimationFrame(() => quickInput.current?.focus());
      await list();
    } catch (error) {
      set({ quickPending: error.unknown ? request : null, quickSaveState: error.unknown ? 'unknown' : 'failed', quickError: error.message });
    }
  }
  function addQuick(event) {
    event.preventDefault();
    if (busy || hasPending(getState()) || quickComposing.current || !getState().quickTitle.trim()) return;
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
  function toggleRow(item) {
    if (busy || (model.item?.id === item.id && dirty)) return;
    void submitRow({ method: 'update', args: { requestId: uuidv4(), id: item.id, expected: item.version,
      patch: { status: item.status === 'open' ? 'done' : 'open' } }, item });
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
    set({ draft: model.item ? draftOf(model.item) : fresh(), latest: null, conflict: false, error: '', notice: '已放弃当前修改。', saveState: 'clean' });
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
      if (hasUnsavedTodoDraft(getState())) await drafts.stash(getState());
      const recovered = { ...getState(), ...record.draft, editorOpen: Boolean(record.draft.editorOpen || record.draft.pending) };
      actions.replace(recovered); drafts.adopt(record, recovered);
    } catch (error) { set({ error: error.message }); }
    finally { set({ loading: false }); }
  }
  const edit = (key, value) => set({ draft: { ...getState().draft, [key]: value }, saveState: 'dirty', notice: '' });
  return <section ref={page} className={`corilo-todos${model.editorOpen ? ' is-editing' : ''}`} data-ui="astryx-neutral" aria-label="Corilo 待办"
    onKeyDown={event => {
      if (event.target.closest('.corilo-todos-editor') && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && model.editorOpen && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); save(); }
    }}>
    <header><h1>待办</h1><details className="corilo-todos-more"><summary>更多操作</summary>
      <button disabled={busy} onClick={() => leaveEditor(true)}>新待办</button><button disabled={busy} onClick={exportTodos}>导出待办 JSON</button>
    </details></header>
    <form className="corilo-todos-quick" aria-label="快速新增待办" onSubmit={addQuick}>
      <label><span className="corilo-todos-sr-only">快速新增待办</span><input ref={quickInput} aria-label="快速新增待办" maxLength={200}
        disabled={busy} placeholder="添加一件要做的事" value={model.quickTitle}
        onCompositionStart={() => { quickComposing.current = true; }} onCompositionEnd={() => { quickComposing.current = false; }}
        onKeyDown={event => { if (event.key === 'Enter' && (quickComposing.current || event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }}
        onChange={event => set({ quickTitle: event.target.value, quickSaveState: 'dirty', quickError: '', notice: '' })} /></label>
      <button className="corilo-todos-primary" disabled={busy || !model.quickTitle.trim()}>{model.quickSaveState === 'saving' ? '添加中…' : '添加'}</button>
    </form>
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
    <p className="corilo-todos-persistence" data-testid="todo-draft-persistence" aria-live="polite">{persistence.status === 'pending' ? '正在保护输入…' : persistence.status === 'stored' ? '草稿已保存在此浏览器，尚未保存到主机。' : persistence.status === 'failed' ? '草稿保护未完成，请保存后再关闭。' : ''}</p>
    {model.rowPending && model.rowSaveState === 'unknown' && <div className="corilo-todos-resolution" data-tone="warning"><p>这次完成或撤销的结果待确认，未自动重发。</p>
      <button disabled={model.changed} onClick={() => submitRow(model.rowPending)}>重试列表操作</button></div>}
    {model.rowError && <p role="alert">{model.rowError}</p>}
    {model.lastRow && <p className="corilo-todos-undo">已完成：{model.lastRow.title} <button disabled={busy} onClick={() => toggleRow(model.lastRow)}>撤销完成</button></p>}
    {model.notice && <p className="corilo-todos-notice" aria-live="polite">{model.notice}</p>}
    <div className={`corilo-todos-grid ${model.editorOpen ? 'has-editor' : ''}`}>
      <aside aria-label="待办列表">
        <div className="corilo-todos-list-tools"><div className="corilo-todos-tabs" role="group" aria-label="待办状态筛选">
          {['open', 'done', 'all', 'cancelled'].map(status => <button key={status} aria-pressed={model.filter === status} disabled={unavailable || model.listing}
            onClick={() => list({ filter: status })}>{labels[status] || '全部'}</button>)}
          </div><button disabled={unavailable || model.listing} aria-label="刷新待办" title="刷新待办" onClick={() => list()}>↻</button></div>
        <form className="corilo-todos-search" role="search" onSubmit={event => { event.preventDefault(); void list({ query: model.query }); }}>
          <label><span className="corilo-todos-sr-only">搜索待办</span><input aria-label="搜索待办" placeholder="搜索待办" value={model.query} onChange={event => set({ query: event.target.value })} /></label>
          <button disabled={unavailable || model.listing}>搜索</button></form>
        {model.listError && <p role="alert">{model.listError}</p>}{model.listing && <p aria-live="polite">正在读取待办…</p>}
        {!model.listing && model.ready && !model.items.length && <p className="corilo-todos-empty">{model.search ? '没有找到匹配的待办，试试其他关键词。' : model.filter === 'open' ? '暂时没有待办，在上方记下一件事。' : `暂无${labels[model.filter] || ''}待办。`}</p>}
        <ul className="corilo-todos-items">{model.items.map(item => <li key={item.id} data-status={item.status} data-selected={model.item?.id === item.id || undefined}>
          <button role="checkbox" aria-checked={item.status === 'done'} aria-label={`${item.status === 'cancelled' ? '重新打开' : '完成'}：${item.title}`}
            className="corilo-todos-check" disabled={busy || (model.item?.id === item.id && dirty)} onClick={() => toggleRow(item)}>{item.status === 'done' ? '✓' : '○'}</button>
          <button className="corilo-todos-item-title" aria-label={item.title} aria-current={model.item?.id === item.id ? 'page' : undefined}
            disabled={busy} onClick={() => open(item.id)}><span>{item.title}</span>{item.body && <small>{item.body.split('\n')[0].slice(0, 80)}</small>}</button>
        </li>)}</ul>
        {model.hasMore && <button disabled={model.listing || unavailable} onClick={() => list({ more: true })}>加载更多待办</button>}
      </aside>
      {model.editorOpen && <div className="corilo-todos-editor">
        <div className="corilo-todos-editor-heading"><h2>{model.item ? '待办详情' : '新建待办'}</h2><button disabled={busy} onClick={() => leaveEditor()}>返回列表</button></div>
        {model.item && <p data-testid="todo-record-state">{labels[model.item.status]}</p>}
        <label className="corilo-todos-title"><span className="corilo-todos-sr-only">标题</span><input ref={titleInput} aria-label="待办标题" maxLength={200} disabled={busy} value={model.draft.title} placeholder="要做什么？" onChange={event => edit('title', event.target.value)} /></label>
        <label className="corilo-todos-description"><span className="corilo-todos-sr-only">说明</span><textarea aria-label="待办说明" maxLength={20000} disabled={busy} value={model.draft.body} placeholder="添加说明…" onChange={event => edit('body', event.target.value)} /></label>
        <div className="corilo-todos-save"><span role="status" data-state={model.conflict ? 'conflict' : model.saveState}>{model.loading ? '读取中…' : model.saveState === 'saving' ? '保存中…' : model.saveState === 'unknown' ? '保存结果待确认' : model.conflict ? '版本冲突' : model.saveState === 'saved' ? '已保存' : model.saveState === 'failed' ? '保存失败' : dirty ? '未保存' : model.item ? '已保存' : '未保存'}</span>
          <button className="corilo-todos-primary" disabled={busy || model.conflict || !model.draft.title.trim()} onClick={save}>{model.item ? '保存待办' : '创建待办'}</button></div>
        {model.error && <p role="alert">{model.error}</p>}
        {model.pending && model.saveState === 'unknown' && <div className="corilo-todos-resolution" data-tone="warning"><p>保存结果待确认。输入和原请求已保留。</p><button disabled={model.changed} onClick={() => submit(model.pending)}>重试同一请求</button></div>}
        {model.conflict && <div className="corilo-todos-resolution" data-tone="warning"><p>待办已有更新，当前输入尚未写入。先核对最新内容。</p><button disabled={busy} onClick={compare}>查看最新待办</button></div>}
        {model.latest && <section className="corilo-todos-resolution" aria-label="最新待办"><p>最新标题：{model.latest.title}</p><p>最新状态：{labels[model.latest.status]}</p>
          <label>最新说明<textarea aria-label="最新待办说明" readOnly value={model.latest.body} /></label><p>最新关联笔记：{model.latest.notePath || '无'}</p>
          <div className="corilo-todos-actions"><button disabled={busy} onClick={() => { if (window.confirm('保留当前输入，改用刚刚读取的最新版本编辑？')) set({ item: model.latest, latest: null, conflict: false, error: '', saveState: 'dirty' }); }}>保留输入，按最新版本编辑</button>
            <button disabled={busy} onClick={() => { if (window.confirm('放弃当前输入，采用刚刚读取的最新待办？')) set({ item: model.latest, draft: draftOf(model.latest), latest: null, conflict: false, error: '', saveState: 'clean' }); }}>采用最新待办</button></div></section>}
        {dirty && <button disabled={busy} onClick={discard}>放弃修改</button>}
        {model.item && <div className="corilo-todos-actions" aria-label="待办状态操作">{model.item.status !== 'done' && <button disabled={busy || dirty || model.conflict} onClick={() => changeStatus('done')}>完成待办</button>}{model.item.status !== 'open' && <button disabled={busy || dirty || model.conflict} onClick={() => changeStatus('open')}>重新打开待办</button>}</div>}
        <details className="corilo-todos-extra"><summary>更多设置</summary><label>关联笔记路径<input aria-label="关联笔记路径" maxLength={1024} disabled={busy} value={model.draft.notePath} placeholder="项目/笔记.md（可选）" onChange={event => edit('notePath', event.target.value)} /></label>
          {model.draft.notePath && <p>关联路径：<code>{model.draft.notePath}</code></p>}{model.item && model.item.status !== 'cancelled' && <button disabled={busy || dirty || model.conflict} onClick={() => changeStatus('cancelled')}>取消待办</button>}</details>
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
