import React, { useEffect, useRef } from 'react';
import { defineStore } from '@deepseek-ai/dsh-client-store';
import { v4 as uuidv4 } from 'uuid';
import styles from './todos.css';

const labels = { open: '未完成', done: '已完成', cancelled: '已取消' };
const fresh = () => ({ title: '', body: '', notePath: '' });
const draftOf = item => ({ title: item.title, body: item.body, notePath: item.notePath || '' });
const hasChanges = model => {
  const original = model.item ? draftOf(model.item) : fresh();
  return Object.keys(original).some(key => original[key] !== model.draft[key]);
};
const initial = () => ({ identity: null, ready: false, changed: false, loading: false, listing: false,
  items: [], hasMore: false, cursor: null, filter: 'open', query: '', search: '', refreshQueued: false,
  item: null, draft: fresh(), pending: null, latest: null, conflict: false,
  error: '', listError: '', notice: '', saveState: 'clean' });

function TodosPage({ useStore, actions, call, getState }) {
  const model = useStore(state => state.model);
  const set = change => actions.replace({ ...getState(), ...change });
  const busy = model.loading || Boolean(model.pending) || !model.ready || model.changed;
  const dirty = hasChanges(model);

  async function list({ more = false, filter, query } = {}) {
    const previous = getState();
    if (previous.changed || !previous.ready) return;
    const selected = filter ?? previous.filter;
    const search = query ?? previous.search;
    if (previous.listing) {
      // A save can finish while an older list response is in flight. Read once
      // more after it settles; never leave its pre-save snapshot as the last list.
      set({ refreshQueued: true, filter: selected, search });
      return;
    }
    set({ listing: true, listError: '', filter: selected, search });
    try {
      const page = await call('list', { status: selected, query: search, cursor: more ? previous.cursor : null });
      if (getState().changed) return;
      set({ items: more ? [...previous.items, ...page.items] : page.items,
        cursor: page.nextCursor, hasMore: page.hasMore });
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
        set({ changed: true, ready: false, error: '待办库已切换，当前输入已保留。请重新加载页面。' });
        return;
      }
      set({ identity: identity.id, ready: true });
      await list();
    } catch (error) { if (generation === connection.current) set({ error: error.message, ready: false }); }
    finally { if (generation === connection.current) set({ loading: false }); }
  }
  useEffect(() => {
    void connect();
    return () => { connection.current++; };
  }, []);

  function mayLeaveEditor() {
    if (getState().pending) return false;
    if (hasChanges(getState())) {
      set({ error: '当前修改尚未保存。请先保存，或明确点击“放弃修改”后再切换。' });
      return false;
    }
    return true;
  }

  async function open(id) {
    if (busy || !mayLeaveEditor()) return;
    set({ loading: true, error: '', notice: '' });
    try {
      const item = await call('get', { id });
      set({ item, draft: draftOf(item), latest: null, conflict: false, saveState: 'clean' });
    } catch (error) { set({ error: error.message }); }
    finally { set({ loading: false }); }
  }

  function newTodo() {
    if (busy || !mayLeaveEditor()) return;
    set({ item: null, draft: fresh(), latest: null, conflict: false, error: '', notice: '', saveState: 'clean' });
  }

  async function submit(request) {
    if (getState().changed || !getState().ready) return;
    // A failed transport retains this exact request and idempotency key.
    // Only an explicit retry can send it again; editing remains disabled.
    set({ pending: request, saveState: 'saving', error: '', notice: '' });
    try {
      const item = await call(request.method, request.args);
      set({ item, draft: draftOf(item), pending: null, latest: null, conflict: false,
        saveState: 'saved', notice: '已保存到主机。' });
      await list();
    } catch (error) {
      const unknown = error.unknown === true;
      set({ pending: unknown ? request : null, saveState: unknown ? 'unknown' : 'failed',
        conflict: error.code === 'todos/409', latest: null, error: error.message });
    }
  }

  function save() {
    if (busy || model.conflict || !model.draft.title.trim()) return;
    const fields = { title: model.draft.title, body: model.draft.body, notePath: model.draft.notePath || null };
    const request = model.item
      ? { method: 'update', args: { id: model.item.id, expected: model.item.version, requestId: uuidv4(), patch: fields } }
      : { method: 'create', args: { requestId: uuidv4(), ...fields } };
    void submit(request);
  }

  function changeStatus(status) {
    if (busy || dirty || model.conflict || !model.item) return;
    void submit({ method: 'update', args: { requestId: uuidv4(), id: model.item.id,
      expected: model.item.version, patch: { status } } });
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
    set({ draft: model.item ? draftOf(model.item) : fresh(), latest: null, conflict: false,
      error: '', notice: '已放弃当前修改。', saveState: 'clean' });
  }

  async function exportTodos() {
    if (busy) return;
    set({ loading: true, error: '' });
    try {
      const data = await call('export', {});
      const href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = href; anchor.download = 'corilo-todos.json'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      set({ notice: '已导出待办 JSON；不包含笔记正文、会话或凭据。' });
    } catch (error) { set({ error: error.message }); }
    finally { set({ loading: false }); }
  }

  const edit = (key, value) => set({ draft: { ...getState().draft, [key]: value }, saveState: 'dirty', notice: '' });
  return <section className="corilo-todos" aria-label="Corilo 待办">
    <header><div><h1>待办</h1><p>记录自己的事，逐件完成。</p></div>
      <div className="corilo-todos-actions"><button disabled={busy} onClick={newTodo}>新待办</button>
        <button disabled={busy} onClick={exportTodos}>导出待办 JSON</button></div>
    </header>
    <p className="corilo-todos-hint">这里是个人待办。直接操作不调用模型；日程和提醒尚未启用。</p>
    {model.changed && <p role="alert">待办库已切换，写入已暂停。当前内容仍在编辑器中，请重新加载页面。</p>}
    {!model.ready && !model.changed && <button disabled={model.loading} onClick={connect}>重新连接</button>}
    <div className="corilo-todos-grid">
      <aside aria-label="待办列表">
        <label>状态<select aria-label="待办状态筛选" value={model.filter} disabled={!model.ready || model.changed || model.listing}
          onChange={event => list({ filter: event.target.value })}>
          <option value="open">未完成</option><option value="done">已完成</option><option value="cancelled">已取消</option><option value="all">全部</option>
        </select></label>
        <form className="corilo-todos-search" onSubmit={event => { event.preventDefault(); void list({ query: model.query }); }}>
          <label>搜索<input aria-label="搜索待办" value={model.query} onChange={event => set({ query: event.target.value })} /></label>
          <button disabled={!model.ready || model.changed || model.listing}>搜索</button>
        </form>
        <button disabled={!model.ready || model.changed || model.listing} onClick={() => list()}>刷新待办</button>
        {model.listError && <p role="alert">{model.listError}</p>}
        {model.listing && <p aria-live="polite">正在读取待办…</p>}
        {!model.listing && model.ready && !model.items.length && <p>暂无匹配的待办。</p>}
        <ul>{model.items.map(item => <li key={item.id}><button aria-current={model.item?.id === item.id ? 'page' : undefined}
          disabled={busy} onClick={() => open(item.id)}><span>{item.title}</span><small>{labels[item.status]}</small></button></li>)}</ul>
        {model.hasMore && <button disabled={model.listing || !model.ready || model.changed} onClick={() => list({ more: true })}>加载更多待办</button>}
      </aside>
      <div className="corilo-todos-editor">
        <h2>{model.item ? '编辑待办' : '新建待办'}</h2>
        {model.item && <p className="corilo-todos-hint" data-testid="todo-record-state">{labels[model.item.status]} · 版本 {model.item.version}</p>}
        <label>标题<input aria-label="待办标题" maxLength={200} disabled={busy} value={model.draft.title}
          placeholder="要做什么？" onChange={event => edit('title', event.target.value)} /></label>
        <label>说明<textarea aria-label="待办说明" maxLength={20000} disabled={busy} value={model.draft.body}
          placeholder="补充一点背景（可选）" onChange={event => edit('body', event.target.value)} /></label>
        <label>关联笔记路径<input aria-label="关联笔记路径" maxLength={1024} disabled={busy} value={model.draft.notePath}
          placeholder="项目/笔记.md（可选）" onChange={event => edit('notePath', event.target.value)} /></label>
        {model.draft.notePath && <p className="corilo-todos-hint">关联路径：<code>{model.draft.notePath}</code>。可在笔记页面的“按路径打开”中使用；这里不会读取或修改笔记。</p>}
        <div className="corilo-todos-save"><span role="status">{model.loading ? '读取中…' : model.saveState === 'saving' ? '保存中…'
          : model.saveState === 'unknown' ? '保存结果待确认' : model.conflict ? '版本冲突' : model.saveState === 'saved' ? '已保存'
            : model.saveState === 'failed' ? '保存失败' : dirty ? '未保存' : model.item ? '已保存' : '未保存'}</span>
          <button disabled={busy || model.conflict || !model.draft.title.trim()} onClick={save}>{model.item ? '保存待办' : '创建待办'}</button></div>
        {model.error && <p role="alert">{model.error}</p>}
        {model.notice && <p aria-live="polite">{model.notice}</p>}
        {model.pending && model.saveState === 'unknown' && <div className="corilo-todos-resolution">
          <p>输入已保留。请求可能已经提交；重试会使用同一个请求编号，不会重复创建待办。确认结果前请保留本页。</p>
          <button disabled={model.changed} onClick={() => submit(model.pending)}>重试同一请求</button>
        </div>}
        {model.conflict && <div className="corilo-todos-resolution">
          <p>待办已有更新，当前输入尚未写入。先核对最新内容，再选择如何处理。</p>
          <button disabled={busy} onClick={compare}>查看最新待办</button>
        </div>}
        {model.latest && <section className="corilo-todos-resolution" aria-label="最新待办">
          <p>最新标题：{model.latest.title}</p><p>最新状态：{labels[model.latest.status]}</p>
          <label>最新说明<textarea aria-label="最新待办说明" readOnly value={model.latest.body} /></label>
          <p>最新关联笔记：{model.latest.notePath || '无'}</p>
          <div className="corilo-todos-actions">
            <button disabled={busy} onClick={() => {
              if (window.confirm('保留当前标题、说明和关联路径，改用刚刚读取的最新版本编辑？下次保存仍会检查版本。')) {
                set({ item: model.latest, latest: null, conflict: false, error: '', saveState: 'dirty' });
              }
            }}>保留输入，按最新版本编辑</button>
            <button disabled={busy} onClick={() => {
              if (window.confirm('放弃当前输入，采用刚刚读取的最新待办？')) {
                set({ item: model.latest, draft: draftOf(model.latest), latest: null, conflict: false, error: '', saveState: 'clean' });
              }
            }}>采用最新待办</button>
          </div>
        </section>}
        {dirty && <button disabled={busy} onClick={discard}>放弃修改</button>}
        {model.item && <div className="corilo-todos-actions" aria-label="待办状态操作">
          {model.item.status !== 'done' && <button disabled={busy || dirty || model.conflict} onClick={() => changeStatus('done')}>完成待办</button>}
          {model.item.status !== 'cancelled' && <button disabled={busy || dirty || model.conflict} onClick={() => changeStatus('cancelled')}>取消待办</button>}
          {model.item.status !== 'open' && <button disabled={busy || dirty || model.conflict} onClick={() => changeStatus('open')}>重新打开待办</button>}
        </div>}
        <p className="corilo-todos-hint">未保存输入只保留在当前页面内存；刷新或关闭页面会丢失，请先保存到主机。完成或取消不会安排通知。</p>
      </div>
    </div>
  </section>;
}

function TodoIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-6"/></svg>;
}

export const inject = ['slots', 'connection'];
export function apply(ctx) {
  let snapshot = initial();
  const store = defineStore({ init: () => ({ model: snapshot }), actions: {
    replace(state, model) { state.model = model; snapshot = model; },
  } });
  const call = async (method, args) => {
    const mutation = method === 'create' || method === 'update';
    let result;
    try {
      const response = await fetch(`api/corilo-todos/${method}`, { method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json', ...(method !== 'identity' && snapshot.identity ? { 'x-corilo-todos-id': snapshot.identity } : {}) },
        body: JSON.stringify(args) });
      if (!response.ok) throw new Error('Transport failure');
      result = await response.json();
      if (!result || typeof result.ok !== 'boolean' || (result.ok ? !Object.hasOwn(result, 'value')
        : !result.error || typeof result.error.code !== 'string' || typeof result.error.message !== 'string')) {
        throw new Error('Invalid response');
      }
    } catch {
      throw Object.assign(new Error(mutation
        ? '连接失败，输入已保留。写入结果可能未知，请保留本页并重试同一请求。'
        : '连接失败，当前输入已保留。请检查服务后重试。'), { unknown: mutation });
    }
    if (!result.ok) {
      if (result.error.code === 'todos/library-changed') {
        snapshot = { ...snapshot, changed: true, ready: false };
      }
      throw Object.assign(new Error(result.error.message || '待办操作暂不可用'), { code: result.error.code, unknown: mutation && result.error.code === 'todos/503' });
    }
    return result.value;
  };
  ctx.effect(() => {
    const sheet = document.createElement('style'); sheet.textContent = styles; document.head.append(sheet);
    const guard = event => {
      if (hasChanges(snapshot) || snapshot.pending) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', guard);
    return () => { sheet.remove(); window.removeEventListener('beforeunload', guard); };
  });
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'corilo-todos', store,
    inject: () => ({ call, getState: () => snapshot }) }, TodosPage));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'corilo-todos', order: 6, label: '待办' }, TodoIcon));
}
