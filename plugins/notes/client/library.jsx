import React, { useEffect, useRef, useState } from 'react';

export function LibraryPanel({ call, onOpen, disabled, selectedPath, revision }) {
  const [page, setPage] = useState({ items: [], hasMore: false, nextCursor: null });
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('browse');
  const [applied, setApplied] = useState('');
  const [directPath, setDirectPath] = useState('');
  const [pending, setPending] = useState(false);
  const [pendingKind, setPendingKind] = useState('browse');
  const [error, setError] = useState('');
  const request = useRef(0), controller = useRef(null);
  async function load(kind = 'browse', cursor = null) {
    const id = ++request.current;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setPending(true); setPendingKind(kind); setError('');
    try {
      const result = await call(kind, kind === 'search' ? { query } : cursor ? { cursor } : {}, abort.signal);
      if (id !== request.current || abort.signal.aborted) return;
      setPage(previous => cursor ? { ...result, items: [...new Map([...previous.items, ...result.items].map(item => [item.path, item])).values()] } : result);
      setMode(kind); setApplied(kind === 'search' ? query : '');
    } catch (failure) { if (id === request.current && !abort.signal.aborted) setError(failure.message); }
    finally { if (id === request.current) setPending(false); }
  }
  useEffect(() => {
    void load('browse');
    return () => { request.current++; controller.current?.abort(); };
  }, [revision]);
  return <aside aria-label="笔记列表">
    <div className="corilo-notes-library-heading"><h2>所有笔记</h2>
      <button disabled={disabled || pending} type="button" aria-label="刷新列表" title="刷新列表" onClick={() => { setQuery(''); void load('browse'); }}>↻</button>
    </div>
    <form className="corilo-notes-list-tools" onSubmit={event => { event.preventDefault(); void load(query.trim() ? 'search' : 'browse'); }}>
      <input aria-label="搜索笔记" placeholder="搜索文件名或正文" value={query} onChange={event => setQuery(event.target.value)} />
      <button disabled={disabled} type="submit">搜索</button>
    </form>
    {pending && <p aria-live="polite">{pendingKind === 'search' ? '正在搜索…' : '正在读取笔记…'}</p>}
    {error && <p role="alert">{error}</p>}
    {mode === 'search' && <p className="corilo-notes-hint">“{applied}”的文件名和正文结果</p>}
    {!pending && !page.items.length && !error && <p>{mode === 'search' ? '没有找到匹配内容。' : '还没有笔记。写下第一句话吧。'}</p>}
    <ul>{page.items.map(item => <li key={`${item.kind ?? 'path'}:${item.path}:${item.line ?? ''}`}>
      <button disabled={disabled} aria-label={item.path} title={item.path} aria-current={item.path === selectedPath ? 'page' : undefined} onClick={() => onOpen(item.path)}>
        <span>{item.path.split('/').pop().replace(/\.(md|markdown)$/i, '')}</span>
        {item.path.includes('/') && <small>{item.path.slice(0, item.path.lastIndexOf('/'))}</small>}
      </button>
      {item.kind === 'content' && <p className="corilo-notes-search-snippet">第 {item.line} 行 · {item.text}</p>}
    </li>)}</ul>
    {mode === 'browse' && page.hasMore && <button disabled={disabled || pending} onClick={() => load('browse', page.nextCursor)}>加载更多笔记</button>}
    {page.truncated && <p>只显示前 100 条结果，请缩小搜索词；这不是全部匹配。</p>}
    <details className="corilo-notes-direct">
      <summary>按路径打开</summary>
      <p className="corilo-notes-hint">扫描达到上限时，仍可直接打开已知的 Markdown 路径。</p>
      <form onSubmit={event => { event.preventDefault(); if (directPath) void onOpen(directPath); }}>
        <input aria-label="要打开的笔记路径" placeholder="例如 项目/想法.md" value={directPath} onChange={event => setDirectPath(event.target.value)} />
        <button disabled={disabled || !directPath} type="submit">打开路径</button>
      </form>
    </details>
  </aside>;
}
