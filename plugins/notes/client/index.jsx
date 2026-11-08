import React, { useEffect, useRef, useState } from 'react';
import { defineStore } from '@deepseek-ai/dsh-client-store';
import styles from './notes.css';

const fresh = () => ({ path: '', text: '', original: '', expected: null, status: 'clean', error: '', latest: null });
const dirty = d => d.text !== d.original || d.expected === null && d.text !== '';
const labels = { clean: '未保存', dirty: '未保存', saving: '保存中…', saved: '已保存', failed: '保存失败', conflict: '版本冲突' };

function NotesPage({ useStore, actions, call }) {
  const d = useStore(s => s.draft);
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const alive = useRef(true);
  const listRequest = useRef(0);
  const busy = loading || d.status === 'saving';
  async function refresh() {
    const request = ++listRequest.current;
    setListError('');
    try {
      const result = await call('list', {});
      if (alive.current && request === listRequest.current) setItems(result.items);
    } catch (error) {
      if (alive.current && request === listRequest.current) setListError(error.message);
    }
  }
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => { alive.current = false; listRequest.current++; };
  }, []);
  useEffect(() => {
    const guard = event => {
      if (dirty(d) || d.status === 'saving') { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [d]);

  const confirmLeave = () => !dirty(d) || window.confirm('当前笔记有未保存文字。放弃这份草稿并打开其他笔记？');
  async function open(path) {
    if (busy || !confirmLeave()) return;
    setLoading(true);
    try {
      const note = await call('read', { path });
      if (alive.current) actions.setDraft({ ...fresh(), ...note, original: note.text, expected: note.version, status: 'saved' });
    } catch (error) { if (alive.current) actions.setDraft({ ...d, error: error.message }); }
    finally { if (alive.current) setLoading(false); }
  }
  async function save(copy = false) {
    if (busy) return;
    const snapshot = { ...d };
    actions.setDraft({ ...snapshot, status: 'saving', error: '', latest: null });
    try {
      // Never retry a mutation automatically: a lost reply may follow a commit.
      const result = copy || !snapshot.path
        ? await call('capture', { text: snapshot.text })
        : await call('save', { path: snapshot.path, text: snapshot.text, expected: snapshot.expected });
      actions.setDraft({ ...fresh(), path: result.path, text: snapshot.text, original: snapshot.text, expected: result.version, status: 'saved' });
      if (alive.current) void refresh();
    } catch (error) {
      actions.setDraft({ ...snapshot, status: error.code === 'notes/409' ? 'conflict' : 'failed', error: error.message });
    }
  }
  async function compare() {
    if (busy || !d.path) return;
    setLoading(true);
    try { const latest = await call('read', { path: d.path }); if (alive.current) actions.setDraft({ ...d, latest, error: '' }); }
    catch (error) { if (alive.current) actions.setDraft({ ...d, error: error.message }); }
    finally { if (alive.current) setLoading(false); }
  }
  return <section className="corilo-notes" aria-label="Corilo 笔记">
    <header><div><h1>笔记</h1><p>留下原话，也可以直接编辑。</p></div>
      <button disabled={busy} onClick={() => { if (confirmLeave()) actions.setDraft(fresh()); }}>新笔记</button>
    </header>
    <div className="corilo-notes-grid">
      <aside aria-label="笔记列表">
        <div className="corilo-notes-list-tools"><input aria-label="搜索文件名" placeholder="搜索文件名" value={query} onChange={e => setQuery(e.target.value)} />
          <button onClick={refresh}>刷新列表</button></div>
        {listError && <p role="alert">{listError}</p>}
        {!items.length && !listError && <p>还没有笔记。写下第一句话吧。</p>}
        <ul>{items.filter(item => item.path.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(item =>
          <li key={item.path}><button disabled={busy} aria-current={item.path === d.path ? 'page' : undefined} onClick={() => open(item.path)}>{item.path}</button></li>)}</ul>
      </aside>
      <div className="corilo-notes-editor">
        <label>文件名<input aria-label="笔记文件名" disabled={busy || d.expected !== null} placeholder="留空自动命名，或输入 文件名.md" value={d.path}
          onChange={e => actions.setDraft({ ...d, path: e.target.value, status: 'dirty' })} /></label>
        <label className="corilo-notes-body">正文<textarea aria-label="笔记正文" disabled={busy} value={d.text} spellCheck={false} placeholder="此刻想留下什么？"
          onChange={e => actions.setDraft({ ...d, text: e.target.value, status: d.status === 'conflict' ? 'conflict' : 'dirty' })} /></label>
        <div className="corilo-notes-save"><span role="status">{loading ? '读取中…' : labels[d.status]}</span>
          <button disabled={busy || d.status === 'conflict'} onClick={() => save()}>{d.expected === null && !d.path ? '仅保存原话' : '保存笔记'}</button>
        </div>
        <p className="corilo-notes-hint">直接保存到 Markdown，不调用模型。草稿会在切换 Harness 页面时保留。</p>
        {d.error && <p role="alert">{d.error}</p>}
        {d.status === 'conflict' && <div className="corilo-notes-conflict">
          <p>文件已有更新，当前草稿尚未写入。可查看最新内容，或将草稿另存为新笔记。</p>
          <button disabled={busy} onClick={compare}>查看最新内容</button>
          <button disabled={busy} onClick={() => save(true)}>草稿另存为新笔记</button>
        </div>}
        {d.latest && <div className="corilo-notes-latest">
          <label>磁盘最新内容<textarea aria-label="磁盘最新内容" readOnly value={d.latest.text} /></label>
          <button disabled={busy} onClick={() => {
            if (window.confirm('放弃当前草稿，改为编辑刚刚读取的磁盘版本？')) actions.setDraft({ ...fresh(), path: d.latest.path, text: d.latest.text, original: d.latest.text, expected: d.latest.version, status: 'saved' });
          }}>采用此版本，放弃草稿</button>
        </div>}
      </div>
    </div>
  </section>;
}

function NotesIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="5" y="3" width="15" height="18" rx="2"/><path d="M3 7h4M3 12h4M3 17h4M10 8h6M10 12h6"/></svg>;
}

export const inject = ['slots', 'connection'];
export function apply(ctx) {
  ctx.effect(() => {
    const sheet = document.createElement('style');
    sheet.textContent = styles;
    document.head.append(sheet);
    return () => sheet.remove();
  });
  const store = defineStore({ init: () => ({ draft: fresh() }), actions: {
    setDraft(state, draft) { state.draft = draft; },
  } });
  const call = async (method, args) => {
    let result;
    try { const response = await fetch(`api/corilo-notes/${method}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) });
      if (!response.ok) throw new Error('Transport failure');
      result = await response.json(); }
    catch { throw new Error('连接失败；草稿已保留。保存结果可能未知，请刷新列表核对文件后重试。'); }
    if (!result.ok) {
      const known = result.error.code?.startsWith('notes/');
      throw Object.assign(new Error(known ? result.error.message : '连接失败；草稿已保留。请核对文件后重试。'), { code: result.error.code });
    }
    return result.value;
  };
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'corilo-notes', store, inject: () => ({ call }) }, NotesPage));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'corilo-notes', order: 5, label: '笔记' }, NotesIcon));
}
