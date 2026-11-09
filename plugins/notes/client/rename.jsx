import React, { useState } from 'react';

const targetPath = (path, name) => {
  const filename = name.trim();
  if (!filename || filename.includes('/') || filename.includes('\\')) throw Error('请填写当前目录中的新文件名。');
  return path.slice(0, path.lastIndexOf('/') + 1) + (/\.(md|markdown)$/i.test(filename) ? filename : `${filename}.md`);
};

export function RenameNote({ call, draft, locked, open, onOpen, onBegin, onEnd, onComplete, onFailure }) {
  const [name, setName] = useState(() => draft.renameRequest?.to.split('/').pop() || '');
  const [error, setError] = useState('');
  const [unknown, setUnknown] = useState(() => draft.renameRequest || null);
  const [found, setFound] = useState(null);
  const available = draft.path && draft.expected !== null && draft.text === draft.original && draft.status === 'saved' && draft.autosave !== 'blocked';
  async function rename(event) {
    event.preventDefault();
    if (locked || !available || unknown) return;
    let to;
    try { to = targetPath(draft.path, name); } catch (failure) { setError(failure.message); return; }
    const request = { path: draft.path, to };
    onBegin(request); setError('');
    try { onComplete(await call('rename', { path: draft.path, to, expected: draft.expected })); onOpen(false); }
    catch (failure) {
      setError(failure.message);
      const uncertain = failure.unknown || failure.code === 'notes/503';
      if (uncertain) setUnknown(request);
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
  function adopt(note) { onComplete(note); setUnknown(null); setFound(null); onOpen(false); }
  return <div className="corilo-notes-rename">
    {!open ? <button disabled={locked || !available} title={available ? '修改当前目录中的文件名' : '保存当前正文后即可重命名'} onClick={() => {
      setName(draft.path.split('/').pop()); setError(''); setUnknown(null); setFound(null); onOpen(true);
    }}>重命名笔记</button> : <form aria-label="重命名笔记" onSubmit={rename}>
      <label>新文件名<input aria-label="新笔记名称" value={name} disabled={locked || Boolean(unknown)} autoFocus onChange={event => setName(event.target.value)} /></label>
      <p className="corilo-notes-hint">只修改当前目录中的名称，不自动修改笔记链接或待办关联。</p>
      {!unknown && <div><button disabled={locked || !name.trim()} type="submit">确认重命名</button><button disabled={locked} type="button" onClick={() => onOpen(false)}>取消重命名</button></div>}
      {error && <p role="alert">{error}</p>}
      {unknown && <div>
        <p>重命名结果待核对，自动保存已暂停，不会自动重试。</p>
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
