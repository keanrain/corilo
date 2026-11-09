import React, { useState } from 'react';

const operations = { save: '保存', before: '变更前检查点', restore: '恢复', trash: '移入回收站前', rename: '重命名' };

// File mutation state belongs to the editor; this panel only holds its previews.
export function RecoveryPanel({ call, draft, onBegin, onRestored, onTrashed, onFailure, refreshList, enabled, disabled = false }) {
  const [history, setHistory] = useState(null);
  const [historyTarget, setHistoryTarget] = useState(null);
  const [preview, setPreview] = useState(null);
  const [trash, setTrash] = useState(null);
  const [targets, setTargets] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const changed = draft.text !== draft.original;
  const locked = disabled || busy || draft.status === 'saving';
  const saved = draft.path && draft.expected !== null;

  async function perform(task) {
    if (locked) return;
    setBusy(true); setMessage('');
    try { await task(); } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  async function showHistory(target) {
    const result = await call('history', target);
    setHistory(result); setHistoryTarget(target); setPreview(null);
  }
  if (!enabled) return <p className="corilo-notes-hint">版本历史与回收站未启用。可使用安装命令配置独立的恢复目录。</p>;
  return <div className="corilo-notes-recovery" aria-label="笔记恢复">
    <div className="corilo-notes-recovery-actions">
      <button disabled={locked || !saved} onClick={() => perform(async () => {
        await showHistory({ path: draft.path });
      })}>版本历史</button>
      <button disabled={locked} onClick={() => perform(async () => setTrash(await call('listTrash', {})))}>回收站</button>
      <button disabled={locked || !saved || changed} onClick={() => {
        if (!window.confirm(`将「${draft.path}」移入回收站？以后可从回收站恢复。`)) return;
        void perform(async () => {
          onBegin();
          try { await call('trash', { path: draft.path, expected: draft.expected }); onTrashed(); setHistory(null); setPreview(null); setMessage('已移入回收站'); void refreshList(); }
          catch (error) { onFailure(error); throw error; }
        });
      }}>移入回收站</button>
    </div>
    {changed && <p className="corilo-notes-hint">恢复版本或删除当前笔记前，请先保存或另存草稿。</p>}
    {message && <p role="alert">{message}</p>}
    {history && <section aria-label="版本历史列表">
      <h2>版本历史</h2>
      {historyTarget?.at && <div><p>重命名前：{historyTarget.path}（只读）。不会混入此名称后来新建的其他笔记。</p>
        <button disabled={locked} onClick={() => perform(() => showHistory({ path: draft.path }))}>返回当前笔记历史</button></div>}
      {!history.items.length && <p>尚无恢复检查点；启用后的保存会记录版本。</p>}
      <ul>{history.items.map(item => <li key={item.revision}>
        <button disabled={locked} onClick={() => perform(async () => setPreview(await call('readRevision', { path: historyTarget?.path || draft.path, revision: item.revision })))}>
          {item.time} · {operations[item.operation]} · {item.version.slice(0, 8)}
        </button>
        {item.previousPath && <button disabled={locked} aria-label={`查看重命名前历史：${item.previousPath}`} onClick={() => perform(() => showHistory({ path: item.previousPath, at: item.previousRevision }))}>查看重命名前历史：{item.previousPath}</button>}
      </li>)}</ul>
      {history.hasMore && <button disabled={locked} onClick={() => perform(async () => {
        const page = await call('history', { ...historyTarget, path: historyTarget?.path || draft.path, cursor: history.nextCursor });
        const items = new Map(history.items.map(item => [item.revision, item]));
        for (const item of page.items) items.set(item.revision, item);
        setHistory({ ...page, items: [...items.values()] });
      })}>加载更早版本</button>}
    </section>}
    {preview && <section aria-label="历史版本预览">
      <label>历史正文<textarea aria-label="历史正文" readOnly value={preview.text} /></label>
      <button disabled={locked || changed || !saved || preview.path !== draft.path} onClick={() => perform(async () => {
        onBegin();
        try {
          const result = await call('restore', { path: draft.path, revision: preview.revision, expected: draft.expected });
          onRestored({ ...result, text: preview.text }); setHistory(null); setPreview(null); setMessage('历史版本已恢复'); void refreshList();
        } catch (error) { onFailure(error); throw error; }
      })}>恢复此版本</button>
    </section>}
    {trash && <section aria-label="回收站列表">
      <h2>回收站</h2>
      {!trash.items.length && <p>回收站为空。</p>}
      {trash.items.map(item => <div className="corilo-notes-trash-item" key={item.id}>
        <p>{item.path} · {item.time}{item.originalPresent ? ' · 原路径已有文件，恢复时请使用新文件名' : ''}</p>
        <label>恢复文件名<input aria-label={`恢复文件名 ${item.id}`} value={targets[item.id] ?? item.path} onChange={event => setTargets({ ...targets, [item.id]: event.target.value })} /></label>
        <button disabled={locked} onClick={() => perform(async () => {
          const result = await call('restoreTrash', { id: item.id, path: targets[item.id] ?? item.path, expected: null });
          setMessage(`已恢复为 ${result.path}`); setTrash(await call('listTrash', {})); void refreshList();
        })}>恢复已删除笔记</button>
      </div>)}
      {trash.hasMore && <div>
        <p>回收站按稳定的记录顺序分页，当前只显示部分条目。</p>
        <button disabled={locked} onClick={() => perform(async () => {
          const page = await call('listTrash', { cursor: trash.nextCursor });
          const items = new Map(trash.items.map(item => [item.id, item]));
          for (const item of page.items) items.set(item.id, item);
          setTrash({ ...page, items: [...items.values()] });
        })}>加载更多回收站条目</button>
      </div>}
    </section>}
  </div>;
}
