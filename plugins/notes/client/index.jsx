import React, { useEffect, useRef, useState } from 'react';
import { defineStore } from '@deepseek-ai/dsh-client-store';
import { createDraftRecovery, hasUnsavedDraft } from './drafts.mjs';
import { RecoveryPanel } from './recovery.jsx';
import { LibraryPanel } from './library.jsx';
import styles from './notes.css';
import tokens from './astryx-tokens.css';

const fresh = () => ({ path: '', text: '', original: '', expected: null, status: 'clean', error: '', latest: null, notice: '' });
const dirty = hasUnsavedDraft;
const labels = { clean: '开始记录', dirty: '未保存', saving: '保存中…', saved: '已保存', failed: '保存失败', conflict: '版本冲突' };
const markdownPath = path => path && !/\.(md|markdown)$/i.test(path) ? `${path}.md` : path;

function NotesPage({ useStore, actions, call, drafts, usePersistence }) {
  const d = useStore(s => s.draft);
  const persistence = usePersistence(s => s);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [navigationError, setNavigationError] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(() => !window.matchMedia('(max-width: 700px)').matches);
  const page = useRef(null);
  const body = useRef(null);
  const focusBody = () => requestAnimationFrame(() => { body.current?.focus({ preventScroll: true }); });
  const alive = useRef(true);
  const busy = loading || d.status === 'saving' || !persistence.ready || persistence.rootChanged;
  const emptyCapture = !d.path && d.text.length === 0;
  async function refresh() { if (alive.current) setLibraryRevision(value => value + 1); }
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  async function retainCurrent() { return dirty(d) ? drafts.stash(d) : null; }
  async function newNote() {
    if (busy) return;
    setLoading(true); setNavigationError('');
    try {
      const kept = await retainCurrent();
      if (alive.current) {
        actions.setDraft({ ...fresh(), notice: kept ? '原草稿已保留，可从待恢复草稿继续编辑。' : '' });
        setLibraryOpen(false); page.current?.scrollTo({ top: 0 });
        focusBody();
      }
    } catch (error) { if (alive.current) setNavigationError(error.message); }
    finally { if (alive.current) setLoading(false); }
  }
  async function open(path) {
    if (busy) return;
    setLoading(true);
    try {
      const note = await call('read', { path });
      if (!alive.current) return;
      const kept = await retainCurrent();
      if (alive.current) {
        actions.setDraft({ ...fresh(), ...note, original: note.text, expected: note.version, status: 'saved', notice: kept ? '原草稿已保留。' : '' });
        setLibraryOpen(false); page.current?.scrollTo({ top: 0 });
        focusBody();
      }
    } catch (error) { if (alive.current) actions.setDraft({ ...d, error: error.message }); }
    finally { if (alive.current) setLoading(false); }
  }
  async function save(copy = false) {
    if (busy || emptyCapture) return;
    const snapshot = { ...d };
    actions.setDraft({ ...snapshot, status: 'saving', error: '', latest: null });
    try {
      // Never retry a mutation automatically: a lost reply may follow a commit.
      const result = copy || !snapshot.path
        ? await call('capture', { text: snapshot.text })
        : await call('save', { path: snapshot.expected === null ? markdownPath(snapshot.path) : snapshot.path, text: snapshot.text, expected: snapshot.expected });
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
  async function recover(record) {
    if (busy) return;
    setLoading(true);
    let recovered = { ...fresh(), ...record.draft, latest: null };
    if (recovered.expected === null) recovered.path = markdownPath(recovered.path);
    try {
      if (recovered.path) {
        try {
          const latest = await call('read', { path: recovered.path });
          if (latest.version !== recovered.expected) recovered = { ...recovered, status: 'conflict', latest, error: '草稿已恢复，磁盘内容已有更新。请核对最新内容或另存，尚未写入文件。' };
        } catch (error) {
          if (error.code !== 'notes/404') throw error;
          if (recovered.expected !== null) recovered = { ...recovered, status: 'conflict', error: '草稿已恢复，但原文件已不存在。请将草稿另存为新笔记。' };
        }
      }
      if (alive.current) {
        await retainCurrent();
        if (!alive.current) return;
        drafts.adopt(record, recovered);
        actions.setDraft(recovered);
        if (window.matchMedia('(max-width: 700px)').matches) setDraftsOpen(false);
        page.current?.scrollTo({ top: 0 });
      }
    } catch (error) { if (alive.current) setNavigationError(`草稿尚未恢复：${error.message}`); }
    finally { if (alive.current) setLoading(false); }
  }
  return <section ref={page} className={`corilo-notes${libraryOpen ? ' is-browsing' : ''}`} data-ui="astryx-neutral" data-note-state={d.status} aria-label="Corilo 笔记"
    onKeyDown={event => {
      if (event.target.closest('.corilo-notes-editor') && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        if (d.status !== 'conflict') void save();
      }
    }}>
    <header><h1>笔记</h1><div className="corilo-notes-primary-actions">
      <button className="corilo-notes-find" aria-controls="corilo-notes-library" aria-expanded={libraryOpen} onClick={() => setLibraryOpen(value => !value)}>{libraryOpen ? '返回正文' : '查找笔记'}</button>
      <button disabled={busy} onClick={newNote}>新笔记</button>
    </div></header>
    {persistence.candidates.length > 0 && <section className="corilo-notes-drafts" aria-label="待恢复草稿">
      <details open={draftsOpen} onToggle={event => setDraftsOpen(event.currentTarget.open)}>
      <summary>待恢复草稿（{persistence.candidates.length}）</summary>
      <p>恢复只会放回编辑器，不会自动改写已保存的笔记。</p>
      <ul>{persistence.candidates.map(record => <li key={record.id}>
        <span>{record.draft.path || '未命名笔记'} · {new Date(record.updatedAt).toLocaleString('zh-CN')}</span>
        <p className="corilo-notes-hint">{record.draft.text.trim().slice(0, 100) || '空白正文'}</p>
        <details><summary>预览草稿</summary><textarea aria-label="草稿正文预览" readOnly value={record.draft.text} /></details>
        <button disabled={busy} onClick={() => recover(record)}>恢复草稿</button>
        <button disabled={busy} onClick={() => { if (window.confirm('永久丢弃这份浏览器草稿？不会删除磁盘笔记。')) void drafts.discard(record); }}>丢弃草稿</button>
      </li>)}</ul></details>
    </section>}
    {persistence.error && <p role="alert">{persistence.error} {!persistence.rootChanged && <button onClick={() => drafts.start()}>重试草稿保护</button>}</p>}
    {navigationError && <p role="alert">{navigationError}</p>}
    <div className="corilo-notes-grid">
      <div id="corilo-notes-library" className={`corilo-notes-library${libraryOpen ? ' is-open' : ''}`}>
        <LibraryPanel call={call} onOpen={open} disabled={busy} selectedPath={d.path} revision={libraryRevision} />
      </div>
      <div className="corilo-notes-editor">
        <label className="corilo-notes-filename"><span className="corilo-notes-sr-only">文件名</span><input aria-label="笔记文件名" disabled={busy || d.expected !== null} placeholder="未命名笔记" value={d.path}
          title="标题可留空，保存时自动命名；填写标题时自动补 .md。也支持 文件夹/标题.md。已保存文件的名称在此只读。"
          onChange={e => actions.setDraft({ ...d, path: e.target.value, status: 'dirty' })} /></label>
        <p className="corilo-notes-document-hint">{d.path ? 'Markdown 笔记' : '直接写下正文，保存时自动命名。'}<span>Ctrl / ⌘ S 保存</span></p>
        <label className="corilo-notes-body"><span className="corilo-notes-sr-only">正文</span><textarea ref={body} aria-label="笔记正文" disabled={busy} value={d.text} spellCheck={false} placeholder="此刻想留下什么？"
          onChange={e => actions.setDraft({ ...d, text: e.target.value, status: d.status === 'conflict' ? 'conflict' : 'dirty' })} /></label>
        <div className="corilo-notes-save"><span role="status" data-state={loading ? 'loading' : d.status}>{loading ? '读取中…' : labels[d.status]}</span>
          <button className="corilo-notes-primary" disabled={busy || emptyCapture || d.status === 'conflict'} onClick={() => save()}>{d.expected === null && !d.path ? '仅保存原话' : '保存笔记'}</button>
        </div>
        <p className="corilo-notes-hint corilo-notes-persistence" data-state={persistence.status} aria-live="polite" data-testid="draft-persistence">{persistence.status === 'loading' ? '正在读取浏览器草稿…' : persistence.status === 'pending' ? '正在保护草稿…' : persistence.status === 'stored' ? '草稿已保存在此浏览器，尚未保存到文件。' : persistence.status === 'failed' ? (persistence.ready ? '草稿保护失败，请保存文件后再关闭。' : '知识库身份未确认，操作已暂停。') : ''}</p>
        {d.error && <p className="corilo-notes-error" role="alert">{d.error}</p>}
        {d.notice && <p className="corilo-notes-notice" aria-live="polite">{d.notice}</p>}
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
        <details className="corilo-notes-more"><summary>更多操作</summary>
        <p className="corilo-notes-hint">历史、回收站与删除。浏览器草稿只用于恢复，不是独立备份。</p>
        <RecoveryPanel key={d.path} call={call} draft={d} enabled={persistence.recoveryEnabled}
          refreshList={refresh}
          onBegin={() => actions.setDraft({ ...d, status: 'saving', error: '' })}
          onRestored={note => actions.setDraft({ ...fresh(), path: note.path, text: note.text, original: note.text, expected: note.version, status: 'saved' })}
          onTrashed={() => actions.setDraft({ ...fresh(), notice: '已移入回收站，可在回收站中恢复。' })}
          onFailure={error => actions.setDraft({ ...d, status: error.code === 'notes/409' ? 'conflict' : 'failed', error: error.message })} />
        </details>
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
    sheet.textContent = tokens + styles;
    document.head.append(sheet);
    return () => sheet.remove();
  });
  let drafts;
  const call = async (method, args, signal) => {
    let result;
    try { const response = await fetch(`api/corilo-notes/${method}`, { method: 'POST', credentials: 'same-origin', signal, headers: { 'content-type': 'application/json', ...(method !== 'identity' && drafts?.identity ? { 'x-corilo-library-id': drafts.identity } : {}) }, body: JSON.stringify(args) });
      if (!response.ok) throw new Error('Transport failure');
      result = await response.json(); }
    catch { throw new Error('连接失败；草稿已保留。保存结果可能未知，请刷新列表核对文件后重试。'); }
    if (!result.ok) {
      if (result.error.code === 'notes/library-changed') drafts?.libraryChanged();
      const known = result.error.code?.startsWith('notes/');
      throw Object.assign(new Error(known ? result.error.message : '连接失败；草稿已保留。请核对文件后重试。'), { code: result.error.code });
    }
    return result.value;
  };
  drafts = createDraftRecovery(() => call('identity', {}));
  const store = defineStore({ init: () => ({ draft: fresh() }), actions: {
    setDraft(state, draft) { state.draft = draft; drafts.track(draft); },
  } });
  ctx.effect(() => {
    void drafts.start();
    const guard = event => {
      if (drafts.needsLeaveWarning()) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', guard);
    return () => { window.removeEventListener('beforeunload', guard); drafts.dispose(); };
  });
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'corilo-notes', store, inject: () => ({ call, drafts, hooks: { persistence: drafts } }) }, NotesPage));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'corilo-notes', order: 5, label: '笔记' }, NotesIcon));
}
