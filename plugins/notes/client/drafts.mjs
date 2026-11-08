import { openDB } from 'idb';
import { v4 as uuidv4 } from 'uuid';

export const hasUnsavedDraft = draft => draft.text !== draft.original || draft.expected === null && (draft.text !== '' || draft.path !== '');
const snapshotDraft = draft => ({
  path: draft.path, text: draft.text, original: draft.original, expected: draft.expected,
  status: draft.status === 'saving' ? 'failed' : draft.status,
  error: draft.status === 'saving' ? '上次保存结果未知，请先核对磁盘内容。' : draft.error,
  latest: null,
});
const validDraft = draft => draft && typeof draft.path === 'string' && typeof draft.text === 'string'
  && typeof draft.original === 'string' && typeof draft.error === 'string'
  && ['clean', 'dirty', 'saved', 'failed', 'conflict'].includes(draft.status)
  && (draft.expected === null || typeof draft.expected === 'string' && /^[a-f0-9]{64}$/.test(draft.expected));
const sameRecord = (actual, expected) => actual && actual.libraryId === expected.libraryId
  && actual.updatedAt === expected.updatedAt && JSON.stringify(actual.draft) === JSON.stringify(expected.draft);
const changedMessage = '其他页面更新了这份草稿，较新版本已保留。待恢复列表已刷新，请重新核对后操作。';

// idb supplies transactions and browser failure handling. This small owner only
// connects the note's business state to an independent local recovery record.
export function createDraftRecovery(identity) {
  let state = { ready: false, status: 'loading', error: '', candidates: [], rootChanged: false, recoveryEnabled: false };
  const listeners = new Set();
  const publish = change => {
    state = { ...state, ...change };
    for (const listener of listeners) listener();
  };
  // uuid falls back to getRandomValues on ordinary HTTP origins.
  const pageId = uuidv4();
  let libraryId, database, current, saving = false, revision = 0, queue = Promise.resolve(), opening, disposed = false;
  const adopted = new Map();
  const candidatesOf = records => records.filter(record => record.id !== pageId).sort((a, b) => b.updatedAt - a.updatedAt);
  const unavailable = () => publish({ ready: Boolean(libraryId), status: 'failed', error: libraryId
    ? '浏览器草稿保护不可用，文字仍在当前页面。请保存到文件后再关闭；不要依赖重载恢复。'
    : '无法确认当前知识库，暂时禁止编辑和保存。请检查连接后重试草稿保护。' });
  const enqueue = task => {
    queue = queue.catch(() => {}).then(task);
    return queue;
  };
  const persist = draft => {
    if (disposed) return;
    current = snapshotDraft(draft);
    saving = draft.status === 'saving';
    const next = ++revision;
    if (!database || !libraryId || state.rootChanged) return;
    const value = current;
    const sources = [...adopted.values()];
    publish({ status: 'pending' });
    void enqueue(async () => {
      const tx = database.transaction('drafts', 'readwrite');
      if (hasUnsavedDraft(value) || draft.status === 'saving') {
        await tx.store.put({ id: pageId, libraryId, updatedAt: Date.now(), draft: value });
      } else await tx.store.delete(pageId);
      let changed = false;
      for (const source of sources) {
        const actual = await tx.store.get(source.id);
        if (sameRecord(actual, source)) await tx.store.delete(source.id);
        else if (actual) changed = true;
      }
      // Refresh from the same transaction that made the deletion decision: a
      // stale page must never remove a newer draft another page just protected.
      const records = sources.length ? await tx.store.index('libraryId').getAll(libraryId) : null;
      await tx.done;
      for (const source of sources) if (adopted.get(source.id) === source) adopted.delete(source.id);
      if (next === revision && !disposed) publish({ status: hasUnsavedDraft(value) ? 'stored' : 'idle', error: changed ? changedMessage : '', ...(records ? { candidates: candidatesOf(records) } : {}) });
    }).catch(() => { if (next === revision && !disposed) unavailable(); });
  };
  async function start() {
    if (opening) return opening;
    publish({ status: 'loading' });
    opening = (async () => {
      try {
        const result = await identity();
        if (disposed) return;
        if (typeof result.id !== 'string' || !result.id) throw new Error('Missing library identity');
        if (libraryId && result.id !== libraryId) {
          publish({ ready: true, rootChanged: true, error: '知识库已切换。当前草稿仍属于原知识库，请重新加载页面后操作。' });
          return;
        }
        libraryId = result.id;
        // Host recovery is independent of browser storage availability.
        publish({ recoveryEnabled: Boolean(result.recoveryEnabled) });
        database ??= await openDB('corilo-notes-drafts', 1, {
          upgrade(db) { db.createObjectStore('drafts', { keyPath: 'id' }).createIndex('libraryId', 'libraryId'); },
          blocked() { unavailable(); },
          blocking() { database?.close(); database = undefined; unavailable(); },
          terminated() { database = undefined; unavailable(); },
        });
        if (disposed) { database.close(); database = undefined; return; }
        const records = await database.getAllFromIndex('drafts', 'libraryId', libraryId);
        if (records.some(record => typeof record.id !== 'string' || !Number.isFinite(record.updatedAt) || !validDraft(record.draft))) throw new Error('Invalid draft record');
        publish({ ready: true, status: 'idle', error: '', recoveryEnabled: Boolean(result.recoveryEnabled), candidates: candidatesOf(records) });
        if (current) persist(current);
      } catch { unavailable(); }
      finally { opening = undefined; }
    })();
    return opening;
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    get identity() { return libraryId; },
    start,
    track: persist,
    async stash(draft) {
      if (!hasUnsavedDraft(draft)) return null;
      if (disposed || !database || !libraryId || state.rootChanged || saving || draft.status === 'saving') {
        throw new Error('草稿尚未安全保留，请先完成当前操作或重试草稿保护。文字仍在编辑器中。');
      }
      const value = snapshotDraft(draft);
      const sources = [...adopted.values()];
      const record = { id: uuidv4(), libraryId, updatedAt: Date.now(), draft: value };
      publish({ status: 'pending' });
      try {
        await enqueue(async () => {
          if (disposed || !database || state.rootChanged) throw new Error('Draft storage changed');
          const tx = database.transaction('drafts', 'readwrite');
          let records, changed = false;
          try {
            // A separate key survives track(fresh()). Both copies move together:
            // a failed transaction leaves the current-page recovery intact.
            await tx.store.add(record);
            await tx.store.delete(pageId);
            for (const source of sources) {
              const actual = await tx.store.get(source.id);
              if (sameRecord(actual, source)) await tx.store.delete(source.id);
              else if (actual) changed = true;
            }
            records = await tx.store.index('libraryId').getAll(libraryId);
            await tx.done;
          } catch (error) {
            try { tx.abort(); } catch {}
            await tx.done.catch(() => {});
            throw error;
          }
          for (const source of sources) if (adopted.get(source.id) === source) adopted.delete(source.id);
          if (!disposed) publish({ status: 'stored', candidates: candidatesOf(records), error: changed ? changedMessage : '' });
        });
        return record;
      } catch {
        if (!disposed) unavailable();
        throw new Error('未能保留草稿，文字仍在编辑器中。请重试，或先保存到文件。');
      }
    },
    needsLeaveWarning: () => current && (hasUnsavedDraft(current) || saving),
    libraryChanged() { publish({ ready: true, rootChanged: true, error: '知识库已切换。当前草稿仍属于原知识库，请重新加载页面后操作。' }); },
    adopt(record, draft) {
      adopted.set(record.id, record);
      publish({ candidates: state.candidates.filter(candidate => candidate.id !== record.id) });
      persist(draft);
    },
    async discard(record) {
      if (!database) { unavailable(); return; }
      try {
        await enqueue(async () => {
          const tx = database.transaction('drafts', 'readwrite');
          const actual = await tx.store.get(record.id);
          const changed = actual && !sameRecord(actual, record);
          if (sameRecord(actual, record)) await tx.store.delete(record.id);
          const records = await tx.store.index('libraryId').getAll(libraryId);
          await tx.done;
          publish({ candidates: candidatesOf(records), error: changed ? changedMessage : '' });
        });
      } catch { unavailable(); }
    },
    dispose() { disposed = true; void queue.finally(() => database?.close()).catch(() => {}); listeners.clear(); },
  };
}
