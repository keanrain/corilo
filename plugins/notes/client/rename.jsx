import React, { useEffect, useRef, useState } from 'react';

const targetPath = (path, name) => {
  const filename = name.trim();
  if (!filename || filename.includes('/') || filename.includes('\\')) throw Error('请填写当前目录中的新文件名。');
  return path.slice(0, path.lastIndexOf('/') + 1) + (/\.(md|markdown)$/i.test(filename) ? filename : `${filename}.md`);
};

export function RenameNote({ call, draft, locked, open, onOpen, onPrepare, onBegin, onEnd, onComplete, onFailure }) {
  const [name, setName] = useState(() => draft.renameRequest?.to.split('/').pop() || '');
  const [error, setError] = useState('');
  const unknown = draft.renameRequest || null;
  const [found, setFound] = useState(null);
  const composing = useRef(false);
  const title = draft.path.split('/').pop().replace(/\.(md|markdown)$/i, '');
  useEffect(() => { if (open && !unknown) setName(title); }, [open]);
  useEffect(() => { if (unknown) { setError(''); setFound(null); } }, [unknown?.path, unknown?.to, draft.expected]);
  const available = draft.path && draft.expected !== null && draft.text === draft.original && draft.status === 'saved' && draft.autosave !== 'blocked';
  const canBegin = draft.path && draft.expected !== null && draft.status !== 'conflict' && draft.autosave !== 'blocked';
  async function rename(event) {
    event.preventDefault();
    if (locked || !available || unknown || composing.current) return;
    let to;
    try { to = targetPath(draft.path, name); } catch (failure) { setError(failure.message); return; }
    if (to === draft.path) { onOpen(false); return; }
    const request = { path: draft.path, to };
    onBegin(request); setError('');
    try { onComplete(await call('rename', { path: draft.path, to, expected: draft.expected })); onOpen(false); }
    catch (failure) {
      setError(failure.message);
      const uncertain = failure.unknown || failure.code === 'notes/503';
      onFailure(failure, uncertain ? request : null);
    } finally { onEnd(); }
  }
  async function verify() {
    if (locked || !unknown) return;
    onBegin(); setError(''); setFound(null);
    try {
      const read = path => call('read', { path }).catch(failure => { if (failure.code === 'notes/404') return null; throw failure; });
      const source = await read(unknown.path), target = await read(unknown.to);
      setFound({ source, target });
      if (!source && !target) setError('两个文件名均未找到。当前内容仍在页面中，请检查资料库后重新核对。');
    } catch (failure) { setError(failure.message); }
    finally { onEnd(); }
  }
  function adopt(note) { onComplete(note); setError(''); setFound(null); onOpen(false); }
  async function begin() {
    if (locked || !canBegin) return;
    if (onPrepare && !await onPrepare()) return;
    setName(title); setError(''); setFound(null); onOpen(true);
  }
  return <div className="corilo-notes-rename">
    {!open ? <input className="corilo-notes-title" aria-label="笔记标题" value={title} readOnly disabled={locked || !canBegin} title="点击标题修改名称" onClick={begin}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); begin(); } }} /> : <form aria-label="重命名笔记" onSubmit={rename}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && !locked && !unknown) void rename(event); }}
      onKeyDown={event => {
        if (event.key === 'Escape' && !unknown && !locked && !composing.current) { event.preventDefault(); event.stopPropagation(); onOpen(false); }
        if (event.key === 'Enter') event.stopPropagation();
        if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault();
      }}>
      <div className="corilo-notes-title-line"><input className="corilo-notes-title" aria-label="新笔记名称" value={unknown ? unknown.to.split('/').pop() : name} disabled={locked || Boolean(unknown)} autoFocus
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onChange={event => setName(event.target.value)} />
      {!unknown && <div><button aria-label="确认重命名" title="确认名称" disabled={locked || !name.trim()} type="submit">✓</button><button aria-label="取消重命名" title="取消修改" disabled={locked} type="button" onClick={() => onOpen(false)}>×</button></div>}</div>
      {error && <p role="alert">{error}</p>}
      {unknown && <div>
        <p>{locked ? '正在处理重命名，请稍候。' : '重命名结果待核对，自动保存已暂停，不会自动重试。'}</p>
        <button disabled={locked} type="button" onClick={verify}>核对新旧文件</button>
        {found && <div><p>原文件：{found.source ? '仍存在' : '不存在'}；新文件：{found.target ? '已存在' : '不存在'}。</p>
          {found.source && found.target && <p>两个文件均保留，请选择继续编辑的文件；此操作不会删除另一份。</p>}
          {found.target && <button disabled={locked} type="button" onClick={() => adopt(found.target)}>打开新文件</button>}
          {found.source && <button disabled={locked} type="button" onClick={() => adopt(found.source)}>继续编辑原文件</button>}
        </div>}
      </div>}
    </form>}
  </div>;
}
