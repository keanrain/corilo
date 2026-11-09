import React, { useEffect, useRef, useState } from 'react';
import { defineStore } from '@deepseek-ai/dsh-client-store';
import { createDraftRecovery, hasUnsavedDraft } from './drafts.mjs';
import { RecoveryPanel } from './recovery.jsx';
import { LibraryPanel } from './library.jsx';
import { createNoteSaver, markdownPath, editedDraft, failedDraft } from './autosave.mjs';
import { MarkdownPreview } from './preview.jsx';
import { MarkdownEditor } from './editor.jsx';
import { RenameNote } from './rename.jsx';
import styles from './notes.css';
import tokens from './astryx-tokens.css';

const fresh = () => ({ path: '', text: '', original: '', expected: null, status: 'clean', error: '', latest: null, notice: '', autosave: 'ready', savingMode: null, renameRequest: null });
const dirty = hasUnsavedDraft;
const labels = { clean: '开始记录', dirty: '未保存', saving: '保存中…', saved: '已保存', failed: '保存失败', conflict: '版本冲突' };
function NotesPage({ useStore, actions, call, drafts, saves, usePersistence, getDraft }) {
  const d = useStore(s => s.draft);
  const persistence = usePersistence(s => s);
  const libraryRevision = useStore(s => s.libraryRevision);
  const [loading, setLoading] = useState(false);
  const [navigationError, setNavigationError] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const autoSaveEnabled = useStore(s => s.autoSaveEnabled);
  const [renameOpen, setRenameOpen] = useState(() => Boolean(d.renameRequest));
  const [draftsOpen, setDraftsOpen] = useState(false);
  const page = useRef(null);
  const body = useRef(null);
  const [focusRequested, setFocusRequested] = useState(false);
  const focusBody = () => setFocusRequested(true);
  const alive = useRef(true);
  const mutation = useRef(null);
  const operationBusy = loading || d.status === 'saving' || !persistence.ready || persistence.rootChanged;
  const busy = operationBusy || renameOpen;
  const bodyDisabled = renameOpen || loading || !persistence.ready || persistence.rootChanged || d.status === 'saving' && d.savingMode !== 'auto';
  const emptyCapture = !d.path && d.text.length === 0;
  useEffect(() => {
    if (focusRequested && !bodyDisabled && !previewOpen) {
      body.current?.focus({ preventScroll: true });
      if (body.current?.hasFocus()) setFocusRequested(false);
    }
  }, [focusRequested, bodyDisabled, previewOpen, d.path]);
  async function refresh() { actions.refreshLibrary(); }
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => { setRenameOpen(Boolean(d.renameRequest)); }, [d.path]);
  useEffect(() => {
    saves.bind(actions.setDraft, refresh);
  }, [saves, actions]);
  useEffect(() => {
    saves.pause(busy || composing);
    // Keep an unfinished IME composition paused until the editor returns.
    // Ordinary panel navigation releases UI-only locks, not the save timer.
    return () => saves.pause(composing);
  }, [saves, busy, composing]);
  async function retainCurrent({ forRead = false } = {}) {
    const current = getDraft();
    if (!dirty(current)) return null;
    if (autoSaveEnabled && current.autosave !== 'recovered') {
      if (current.autosave === 'blocked' || current.status === 'conflict') {
        if (!forRead) throw Error('请先核对当前笔记的保存结果，内容仍在这里。');
        if (!window.confirm('当前保存尚未完成。保留这份草稿，再打开所选笔记核对？')) return { cancelled: true };
        return drafts.stash(current);
      }
      await saves.save();
      const saved = getDraft();
      if (dirty(saved)) throw Error(saved.error || '当前笔记尚未保存，请稍后再切换。');
      return null;
    }
    return drafts.stash(current);
  }
  async function newNote() {
    if (busy) return;
    setLoading(true); setNavigationError('');
    let creating = false;
    try {
      const kept = await retainCurrent();
      creating = autoSaveEnabled;
      if (autoSaveEnabled) actions.setDraft({ ...getDraft(), status: 'saving', savingMode: 'create', error: '' });
      const note = autoSaveEnabled ? await call('create', {}) : null;
      if (note || alive.current) {
        actions.setDraft({ ...fresh(), ...(note ? { ...note, original: note.text, expected: note.version, status: 'saved' } : {}), notice: kept ? '上一份输入已保留在草稿中。' : '' });
        void refresh();
        setPreviewOpen(false);
        setLibraryOpen(false); page.current?.scrollTo({ top: 0 });
        focusBody();
      }
    } catch (error) {
      if (creating) actions.setDraft(failedDraft(getDraft(), error));
      else if (alive.current && getDraft().error !== error.message) setNavigationError(error.message);
    }
    finally { if (alive.current) setLoading(false); }
  }
  async function open(path) {
    if (busy) return;
    setLoading(true);
    try {
      const keptBeforeRead = autoSaveEnabled ? await retainCurrent({ forRead: true }) : null;
      if (keptBeforeRead?.cancelled) return;
      const note = await call('read', { path });
      if (!alive.current) return;
      const kept = autoSaveEnabled ? keptBeforeRead : await retainCurrent();
      if (alive.current) {
        actions.setDraft({ ...fresh(), ...note, original: note.text, expected: note.version, status: 'saved', notice: kept ? '原草稿已保留。' : '' });
        setPreviewOpen(false);
        setLibraryOpen(false); page.current?.scrollTo({ top: 0 });
        focusBody();
      }
    } catch (error) { if (alive.current) actions.setDraft({ ...getDraft(), error: error.message }); }
    finally { if (alive.current) setLoading(false); }
  }
  async function save(copy = false) {
    if (busy || mutation.current || composing) return;
    await saves.save(copy);
  }
  async function compare() {
    if (busy || !d.path) return;
    setLoading(true);
    try { const latest = await call('read', { path: d.path }); if (alive.current) actions.setDraft({ ...d, latest, error: '' }); }
    catch (error) { if (alive.current) actions.setDraft({ ...getDraft(), error: error.message }); }
    finally { if (alive.current) setLoading(false); }
  }
  async function recover(record) {
    if (busy) return;
    setLoading(true);
    let recovered = { ...fresh(), ...record.draft, latest: null };
    recovered.autosave = record.draft.autosave === 'blocked' || recovered.status === 'failed' || recovered.status === 'conflict' ? 'blocked' : 'recovered';
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
        setRenameOpen(Boolean(recovered.renameRequest));
        setLibraryOpen(false);
        setPreviewOpen(false);
        if (window.matchMedia('(max-width: 700px)').matches) setDraftsOpen(false);
        page.current?.scrollTo({ top: 0 });
      }
    } catch (error) { if (alive.current) setNavigationError(`草稿尚未恢复：${error.message}`); }
    finally { if (alive.current) setLoading(false); }
  }
  return <section ref={page} className={`corilo-notes${libraryOpen ? ' is-browsing' : ''}`} data-ui="astryx-neutral" data-note-state={d.status} aria-label="Corilo 笔记"
    onPointerDownCapture={event => {
      const menu = page.current?.querySelector('details.corilo-notes-more[open]');
      if (menu && !menu.contains(event.target)) menu.open = false;
    }}
    onKeyDown={event => {
      if (event.key === 'Escape') { const menu = page.current?.querySelector('details.corilo-notes-more'); if (menu) menu.open = false; }
      if (event.target.closest('.corilo-notes-editor') && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        event.stopPropagation();
        if (d.status !== 'conflict') void save();
      }
    }}>
    <header className="corilo-notes-toolbar"><div className="corilo-notes-toolbar-start"><h1>笔记</h1>
      <button className="corilo-notes-find" aria-controls="corilo-notes-library" aria-expanded={libraryOpen} onClick={() => setLibraryOpen(value => !value)}>{libraryOpen ? '返回正文' : '查找笔记'}</button>
      <button className="corilo-notes-new" aria-label="新笔记" disabled={busy} onClick={newNote} title="新笔记">＋<span>新笔记</span></button>
    </div><div className="corilo-notes-primary-actions">
      <span role="status" data-state={loading ? 'loading' : d.status}>{loading ? '处理中…' : d.status === 'clean' && autoSaveEnabled ? '' : labels[d.status]}</span>
      {(!autoSaveEnabled || d.autosave === 'blocked' || d.autosave === 'recovered') && <button className="corilo-notes-primary" disabled={busy || emptyCapture || d.status === 'conflict'} onClick={() => save()}>{d.expected === null && !d.path ? '仅保存原话' : '保存笔记'}</button>}
      <div className="corilo-notes-view-tools" role="group" aria-label="笔记视图"><button aria-label="编辑" title="编辑" aria-pressed={!previewOpen} onClick={() => setPreviewOpen(false)}>✎</button><button aria-label="实时预览" title="实时预览" aria-pressed={previewOpen} onClick={() => setPreviewOpen(true)}>◫</button></div>
        <details className="corilo-notes-more"><summary aria-label="更多操作" title="更多操作">•••</summary><div className="corilo-notes-popover"><strong>文档操作</strong>
        {persistence.candidates.length > 0 && <button onClick={() => { setDraftsOpen(true); setLibraryOpen(true); }}>恢复草稿（{persistence.candidates.length}）</button>}
        <label className="corilo-notes-auto-option"><input type="checkbox" aria-label="自动保存" checked={autoSaveEnabled} onChange={event => actions.setAutoSaveEnabled(event.target.checked)} />自动保存已保存的笔记</label>
        <p className="corilo-notes-hint">历史、回收站与删除。浏览器草稿只用于恢复，不是独立备份。</p>
        <RecoveryPanel key={d.path} call={call} draft={d} enabled={persistence.recoveryEnabled} disabled={busy}
          refreshList={refresh}
          onBegin={() => actions.setDraft({ ...d, status: 'saving', error: '' })}
          onRestored={note => actions.setDraft({ ...fresh(), path: note.path, text: note.text, original: note.text, expected: note.version, status: 'saved' })}
          onTrashed={() => { setRenameOpen(false); actions.setDraft({ ...fresh(), notice: '已移入回收站，可在回收站中恢复。' }); }}
          onFailure={error => actions.setDraft(failedDraft(getDraft(), error))} />
        </div></details>
    </div></header>
    {persistence.error && <p role="alert">{persistence.error} {!persistence.rootChanged && <button onClick={() => drafts.start()}>重试草稿保护</button>}</p>}
    {navigationError && <p role="alert">{navigationError}</p>}
    <div className="corilo-notes-grid">
      <div id="corilo-notes-library" className={`corilo-notes-library${libraryOpen ? ' is-open' : ''}`}>
        <LibraryPanel call={call} onOpen={open} disabled={busy} selectedPath={d.path} revision={libraryRevision} />
    {persistence.candidates.length > 0 && <section className="corilo-notes-drafts" aria-label="待恢复草稿">
      <details open={draftsOpen} onToggle={event => setDraftsOpen(event.currentTarget.open)}>
      <summary>恢复草稿（{persistence.candidates.length}）</summary>
      <p>恢复只会放回编辑器，不会自动改写已保存的笔记。</p>
      <ul>{persistence.candidates.map(record => <li key={record.id}>
        <span>{record.draft.path || '未命名笔记'} · {new Date(record.updatedAt).toLocaleString('zh-CN')}</span>
        <p className="corilo-notes-hint">{record.draft.text.trim().slice(0, 100) || '空白正文'}</p>
        <details><summary>预览草稿</summary><textarea aria-label="草稿正文预览" readOnly value={record.draft.text} /></details>
        <button disabled={busy} onClick={() => recover(record)}>恢复草稿</button>
        <button disabled={busy} onClick={() => { if (window.confirm('永久丢弃这份浏览器草稿？不会删除磁盘笔记。')) void drafts.discard(record); }}>丢弃草稿</button>
      </li>)}</ul></details>
    </section>}

      </div>
      <div className="corilo-notes-editor">
        {d.path.includes('/') && <p className="corilo-notes-breadcrumb">{d.path.slice(0, d.path.lastIndexOf('/'))}</p>}
        {d.expected === null ? <label className="corilo-notes-filename"><span className="corilo-notes-sr-only">标题</span><input aria-label="笔记标题" disabled={busy} placeholder="无标题" value={d.path.replace(/\.(md|markdown)$/i, '')}
          onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); body.current?.focus(); } }}
          onChange={e => actions.setDraft({ ...d, path: e.target.value, status: 'dirty' })} /></label> :
          <RenameNote key={d.path} call={call} draft={d} locked={operationBusy} open={renameOpen} onOpen={value => { setRenameOpen(value); if (!value) focusBody(); }}
            onPrepare={async () => {
              if (dirty(getDraft()) && autoSaveEnabled) await saves.save();
              return !dirty(getDraft()) && getDraft().status === 'saved';
            }}
            onBegin={request => { mutation.current = 'rename'; setLoading(true); actions.setDraft({ ...getDraft(), status: 'saving', savingMode: 'rename', renameRequest: request || getDraft().renameRequest }); }}
            onEnd={() => {
              mutation.current = null; setLoading(false);
              const current = getDraft();
              if (current.status === 'saving' && current.savingMode === 'rename') actions.setDraft({ ...current, status: 'failed', savingMode: null, autosave: 'blocked' });
            }}
            onFailure={(error, request) => actions.setDraft({ ...getDraft(), status: request ? 'failed' : 'saved', savingMode: null, autosave: request ? 'blocked' : getDraft().autosave, renameRequest: request })}
            onComplete={note => { actions.setDraft({ ...fresh(), ...note, original: note.text, expected: note.version, status: 'saved' }); void refresh(); focusBody(); }} />}
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

        <div className={`corilo-notes-writing${previewOpen ? ' with-preview' : ''}`}>
          <div className="corilo-notes-body"><MarkdownEditor ref={body} text={d.text} documentId={d.path} disabled={bodyDisabled}
            onCompositionChange={setComposing}
            onChange={text => actions.setDraft(editedDraft(getDraft(), text))} /></div>
          {previewOpen && <MarkdownPreview text={d.text} />}
        </div>
        <p className={`corilo-notes-persistence${persistence.status === 'failed' ? '' : ' corilo-notes-sr-only'}`} data-state={persistence.status} data-testid="draft-persistence">{persistence.status === 'loading' ? '正在读取浏览器草稿…' : persistence.status === 'pending' ? '正在保护草稿…' : persistence.status === 'stored' ? '草稿已保存在此浏览器，尚未保存到文件。' : persistence.status === 'failed' ? (persistence.ready ? '草稿保护失败，请保存文件后再关闭。' : '知识库身份未确认，操作已暂停。') : ''}</p>
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
    catch { throw Object.assign(new Error('连接失败；草稿已保留。保存结果可能未知，请刷新列表核对文件后重试。'), { unknown: true }); }
    if (!result.ok) {
      if (result.error.code === 'notes/library-changed') drafts?.libraryChanged();
      const known = result.error.code?.startsWith('notes/');
      throw Object.assign(new Error(known ? result.error.message : '连接失败；草稿已保留。请核对文件后重试。'), { code: result.error.code, details: result.error.details });
    }
    return result.value;
  };
  drafts = createDraftRecovery(() => call('identity', {}));
  let snapshot = fresh();
  let autoSaveEnabled = true;
  const saves = createNoteSaver({ getDraft: () => snapshot, call, allowed: () => {
    const persistence = drafts.getSnapshot();
    return autoSaveEnabled && persistence.ready && !persistence.rootChanged;
  } });
  const store = defineStore({ init: () => ({ draft: snapshot, autoSaveEnabled: true, libraryRevision: 0 }), actions: {
    refreshLibrary(state) { state.libraryRevision++; },
    setAutoSaveEnabled(state, enabled) { state.autoSaveEnabled = enabled; autoSaveEnabled = enabled; saves.sync(); },
    setDraft(state, draft) { state.draft = draft; snapshot = draft; drafts.track(draft); saves.sync(); },
  } });
  ctx.effect(() => {
    const unsubscribe = drafts.subscribe(() => saves.sync());
    void drafts.start();
    const guard = event => {
      if (drafts.needsLeaveWarning()) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', guard);
    return () => { window.removeEventListener('beforeunload', guard); unsubscribe(); saves.dispose(); drafts.dispose(); };
  });
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'corilo-notes', store, inject: () => ({ call, drafts, saves, getDraft: () => snapshot, hooks: { persistence: drafts } }) }, NotesPage));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'corilo-notes', order: 5, label: '笔记' }, NotesIcon));
}
