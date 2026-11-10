import React, { useEffect, useRef, useState } from 'react';
import { defineStore } from '@deepseek-ai/dsh-client-store';
import { LibraryPanel } from './library.jsx';
import { createNoteSaver, editedDraft, failedDraft, freshNote, hasUnsavedNote } from './autosave.mjs';
import { MarkdownPreview } from './preview.jsx';
import { MarkdownEditor } from './editor.jsx';
import { RenameNote } from './rename.jsx';
import styles from './notes.css';
import tokens from './astryx-tokens.css';

const labels = { clean: '', dirty: '未保存', saving: '保存中…', saved: '已保存', failed: '保存失败', conflict: '版本冲突' };
function NotesPage({ useStore, actions, call, saves, getDraft }) {
  const d = useStore(s => s.draft);
  const ready = useStore(s => s.ready);
  const libraryRevision = useStore(s => s.libraryRevision);
  const [loading, setLoading] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [renameOpen, setRenameOpen] = useState(() => Boolean(d.renameRequest));
  const [focusRequested, setFocusRequested] = useState(false);
  const page = useRef(null), body = useRef(null), alive = useRef(true);
  const operationBusy = loading || d.status === 'saving' || !ready || d.libraryChanged;
  const busy = operationBusy || renameOpen;
  const bodyDisabled = renameOpen || loading || !ready || d.libraryChanged || d.status === 'saving' && d.savingMode !== 'auto';
  const focusBody = () => setFocusRequested(true);
  const refresh = () => actions.refreshLibrary();
  async function connect() {
    setConnectionError('');
    try { await call('identity', {}); if (alive.current) actions.setReady(true); }
    catch (error) { if (alive.current) { actions.setReady(false); setConnectionError(error.message); } }
  }
  useEffect(() => { alive.current = true; void connect(); return () => { alive.current = false; }; }, []);
  useEffect(() => { saves.bind(actions.setDraft, refresh); }, [saves, actions]);
  useEffect(() => {
    saves.pause(busy || composing);
    return () => saves.pause(composing);
  }, [saves, busy, composing]);
  useEffect(() => { setRenameOpen(Boolean(d.renameRequest)); }, [d.sessionId]);
  useEffect(() => {
    if (focusRequested && !bodyDisabled && !previewOpen) {
      body.current?.focus();
      if (body.current?.hasFocus()) setFocusRequested(false);
    }
  }, [focusRequested, bodyDisabled, previewOpen, d.sessionId]);
  function adopt(note) {
    const next = freshNote();
    if (note.path === getDraft().path) next.sessionId = getDraft().sessionId;
    actions.setDraft({ ...next, ...note, original: note.text, expected: note.version, status: 'saved' });
    setPreviewOpen(false); setLibraryOpen(false); page.current?.scrollTo({ top: 0 }); focusBody();
  }
  async function saveBeforeLeaving() {
    const current = getDraft();
    if (!hasUnsavedNote(current)) return;
    if (current.autosave === 'blocked' || current.status === 'conflict') throw Error('当前内容尚未保存，请先处理保存问题。');
    await saves.save();
    if (hasUnsavedNote(getDraft())) throw Error(getDraft().error || '当前内容尚未保存，请稍后再切换。');
  }
  async function newNote() {
    if (busy || composing) return;
    setLoading(true);
    let creating = false;
    try {
      await saveBeforeLeaving(); creating = true;
      actions.setDraft({ ...getDraft(), status: 'saving', savingMode: 'create', error: '' });
      const note = await call('create', {});
      adopt(note); refresh();
    } catch (error) {
      actions.setDraft(creating ? failedDraft(getDraft(), error) : { ...getDraft(), error: error.message });
    } finally { if (alive.current) setLoading(false); }
  }
  async function open(path) {
    if (busy || composing) return;
    setLoading(true);
    try {
      const current = getDraft();
      // A lost reply is resolved by a read, never by automatically retrying a
      // write. Only identical content can be adopted without discarding input.
      if (current.autosave === 'blocked' && current.unknown) {
        const note = await call('read', { path });
        if (note.text !== current.text) throw Error('所选文件与当前输入不同，输入仍保留。请先保存副本或核对当前文件。');
        adopt(note); return;
      }
      await saveBeforeLeaving();
      const note = await call('read', { path });
      if (alive.current) adopt(note);
    } catch (error) { if (alive.current) actions.setDraft({ ...getDraft(), error: error.message, libraryChanged: getDraft().libraryChanged || error.code === 'notes/library-changed' }); }
    finally { if (alive.current) setLoading(false); }
  }
  async function save(copy = false) {
    if (busy || composing || !copy && getDraft().unknown || !copy && getDraft().status === 'conflict') return;
    await saves.save(copy);
  }
  async function compare() {
    if (busy || !d.path) return;
    setLoading(true);
    try { const latest = await call('read', { path: d.path }); if (alive.current) actions.setDraft({ ...getDraft(), latest, error: '' }); }
    catch (error) { if (alive.current) actions.setDraft({ ...getDraft(), error: error.message }); }
    finally { if (alive.current) setLoading(false); }
  }
  const unresolved = d.status === 'conflict' || d.autosave === 'blocked';
  return <section ref={page} className={`corilo-notes${libraryOpen ? ' is-browsing' : ''}`} data-ui="astryx-neutral" data-note-state={d.status} aria-label="Corilo 笔记"
    onKeyDown={event => {
      if (event.target.closest('.corilo-notes-editor') && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
        event.preventDefault(); event.stopPropagation(); void save();
      }
    }}>
    <header className="corilo-notes-toolbar"><div className="corilo-notes-toolbar-start"><h1>笔记</h1>
      <button className="corilo-notes-find" aria-controls="corilo-notes-library" aria-expanded={libraryOpen} onClick={() => setLibraryOpen(value => !value)}>{libraryOpen ? '返回正文' : '查找笔记'}</button>
      <button className="corilo-notes-new" aria-label="新笔记" disabled={busy} onClick={newNote} title="新笔记">＋<span>新笔记</span></button>
    </div><div className="corilo-notes-primary-actions">
      <span role="status" data-state={loading ? 'loading' : d.status}>{loading ? '处理中…' : labels[d.status]}</span>
      <div className="corilo-notes-view-tools" role="group" aria-label="笔记视图"><button aria-label="编辑" title="编辑" aria-pressed={!previewOpen} onClick={() => setPreviewOpen(false)}>✎</button><button aria-label="实时预览" title="实时预览" aria-pressed={previewOpen} onClick={() => setPreviewOpen(true)}>◫</button></div>
    </div></header>
    {connectionError && <p role="alert">{connectionError}<button onClick={connect}>重新连接</button></p>}
    <div className="corilo-notes-grid">
      <div id="corilo-notes-library" className={`corilo-notes-library${libraryOpen ? ' is-open' : ''}`}>
        <LibraryPanel call={call} onOpen={open} disabled={busy} selectedPath={d.path} revision={libraryRevision} />
      </div>
      <div className="corilo-notes-editor">
        {d.path.includes('/') && <p className="corilo-notes-breadcrumb">{d.path.slice(0, d.path.lastIndexOf('/'))}</p>}
        {d.expected === null ? <h2 className="corilo-notes-document-title">未命名</h2> :
          <RenameNote key={d.path} call={call} draft={d} locked={operationBusy} open={renameOpen} onOpen={value => { setRenameOpen(value); if (!value) focusBody(); }}
            onPrepare={async () => { if (hasUnsavedNote(getDraft())) await saves.save(); return !hasUnsavedNote(getDraft()) && getDraft().status === 'saved'; }}
            onBegin={request => { setLoading(true); actions.setDraft({ ...getDraft(), status: 'saving', savingMode: 'rename', renameRequest: request || getDraft().renameRequest }); }}
            onEnd={() => { setLoading(false); if (getDraft().savingMode === 'rename') actions.setDraft({ ...getDraft(), status: 'failed', savingMode: null, autosave: 'blocked' }); }}
            onFailure={(error, request) => actions.setDraft({ ...getDraft(), status: request ? 'failed' : 'saved', savingMode: null, autosave: request ? 'blocked' : getDraft().autosave, renameRequest: request })}
            onComplete={note => { actions.setDraft({ ...freshNote(), sessionId: getDraft().sessionId, ...note, original: note.text, expected: note.version, status: 'saved' }); refresh(); focusBody(); }} />}
        {d.error && <p className="corilo-notes-error" role="alert">{d.error}</p>}
        {unresolved && <div className="corilo-notes-conflict">
          <p>{d.unknown ? '保存结果待确认。当前输入仍在页面中，请核对文件或保存副本。' : '当前内容尚未保存。请核对文件，或保存为另一篇笔记。'}</p>
          {d.path && <button disabled={busy} onClick={compare}>查看最新内容</button>}
          {!d.unknown && d.status !== 'conflict' && <button disabled={busy} onClick={() => save()}>重试保存</button>}
          <button disabled={busy} onClick={() => save(true)}>保存副本</button>
        </div>}
        {d.latest && <div className="corilo-notes-latest">
          <label>磁盘最新内容<textarea aria-label="磁盘最新内容" readOnly value={d.latest.text} /></label>
          <button disabled={busy} onClick={() => { if (d.latest.text === d.text || window.confirm('放弃当前输入，采用刚刚读取的文件内容？')) adopt(d.latest); }}>采用文件内容</button>
        </div>}
        <div className={`corilo-notes-writing${previewOpen ? ' with-preview' : ''}`}>
          <div className="corilo-notes-body"><MarkdownEditor ref={body} text={d.text} documentId={d.sessionId} disabled={bodyDisabled}
            onCompositionChange={setComposing} onChange={text => actions.setDraft(editedDraft(getDraft(), text))} /></div>
          {previewOpen && <MarkdownPreview text={d.text} />}
        </div>
      </div>
    </div>
  </section>;
}
function NotesIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="5" y="3" width="15" height="18" rx="2"/><path d="M3 7h4M3 12h4M3 17h4M10 8h6M10 12h6"/></svg>; }
export const inject = ['slots', 'connection'];
export function apply(ctx) {
  let snapshot = freshNote(), identity = null, changed = false;
  const call = async (method, args, signal) => {
    let result;
    try {
      const response = await fetch(`api/corilo-notes/${method}`, { method: 'POST', credentials: 'same-origin', signal, headers: { 'content-type': 'application/json', ...(method !== 'identity' && identity ? { 'x-corilo-library-id': identity } : {}) }, body: JSON.stringify(args) });
      if (!response.ok) throw Error('Transport failure');
      result = await response.json();
      if (!result || typeof result.ok !== 'boolean' || (result.ok ? !Object.hasOwn(result, 'value') : !result.error || typeof result.error.code !== 'string')) throw Error('Invalid response');
    } catch { throw Object.assign(Error('连接失败，当前输入仍在页面中。保存结果可能未知，请核对文件。'), { unknown: true }); }
    if (method === 'identity' && result.ok) {
      if (identity && identity !== result.value.id) changed = true;
      else identity = result.value.id;
    }
    if (changed || !result.ok && result.error.code === 'notes/library-changed') {
      changed = true; throw Object.assign(Error('知识库已切换，写入已暂停，请重新加载页面。'), { code: 'notes/library-changed' });
    }
    if (!result.ok) throw Object.assign(Error(result.error.message), { code: result.error.code, unknown: result.error.code === 'notes/503' || result.error.details?.committed === true });
    return result.value;
  };
  const saves = createNoteSaver({ getDraft: () => snapshot, call, allowed: () => Boolean(identity && !changed) });
  const store = defineStore({ init: () => ({ draft: snapshot, ready: false, libraryRevision: 0 }), actions: {
    refreshLibrary(state) { state.libraryRevision++; },
    setReady(state, ready) { state.ready = ready; },
    setDraft(state, value) { state.draft = value; snapshot = value; saves.sync(); },
  } });
  ctx.effect(() => {
    const sheet = document.createElement('style'); sheet.textContent = tokens + styles; document.head.append(sheet);
    const guard = event => { if (hasUnsavedNote(snapshot) || snapshot.renameRequest) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard);
    return () => { sheet.remove(); window.removeEventListener('beforeunload', guard); saves.dispose(); };
  });
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'corilo-notes', store, inject: () => ({ call, saves, getDraft: () => snapshot }) }, NotesPage));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'corilo-notes', order: 5, label: '笔记' }, NotesIcon));
}
