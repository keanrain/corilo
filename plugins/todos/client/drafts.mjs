import { openDB } from 'idb';
import { v4 as uuidv4 } from 'uuid';

const states = new Set(['clean', 'dirty', 'saved', 'failed', 'unknown']);
const text = value => typeof value === 'string';
const uuid = value => text(value) && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const cleanDraft = () => ({ title: '', body: '', notePath: '' });
const draftOf = item => item ? { title: item.title, body: item.body, notePath: item.notePath || '' } : cleanDraft();
const request = value => value === null || plain(value) && ['create', 'update'].includes(value.method)
  && plain(value.args) && uuid(value.args.requestId)
  && (value.method === 'create' ? text(value.args.title) : uuid(value.args.id) && Number.isSafeInteger(value.args.expected) && value.args.expected > 0 && plain(value.args.patch));
const todo = value => value === null || plain(value) && uuid(value.id) && text(value.title) && text(value.body)
  && (value.notePath === null || text(value.notePath)) && ['open', 'done', 'cancelled'].includes(value.status)
  && Number.isSafeInteger(value.version) && value.version > 0 && text(value.createdAt) && text(value.updatedAt);

export function hasUnsavedTodoDraft(model) {
  const original = draftOf(model.item);
  return Object.keys(original).some(key => original[key] !== model.draft?.[key])
    || Boolean(model.pending || model.quickPending || model.rowPending || model.quickTitle);
}

// Persist only business input and exact mutation requests, never list/cache or
// connection state. Recovered in-flight mutations require an explicit retry.
export function snapshotTodoDraft(model) {
  const pending = model.pending ? clone(model.pending) : null;
  const quickPending = model.quickPending ? clone(model.quickPending) : null;
  const rowPending = model.rowPending ? clone(model.rowPending) : null;
  const uncertain = '上次保存结果待确认。输入和原请求已保留，请明确重试同一请求。';
  return {
    item: model.item ? clone(model.item) : null,
    draft: clone(model.draft || cleanDraft()), pending,
    saveState: model.saveState === 'saving' ? pending ? 'unknown' : 'failed' : model.saveState || 'clean',
    conflict: Boolean(model.conflict),
    error: model.saveState === 'saving' && pending ? uncertain : model.error || '',
    quickTitle: model.quickTitle || '', quickPending,
    quickSaveState: model.quickSaveState === 'saving' ? quickPending ? 'unknown' : 'failed' : model.quickSaveState || 'clean',
    quickError: model.quickSaveState === 'saving' && quickPending ? uncertain : model.quickError || '',
    rowPending,
    rowSaveState: model.rowSaveState === 'saving' ? rowPending ? 'unknown' : 'failed' : model.rowSaveState || 'clean',
    rowError: model.rowSaveState === 'saving' && rowPending ? uncertain : model.rowError || '',
    editorOpen: Boolean(model.editorOpen || pending),
    leaveSaveBlocked: Boolean(model.leaveSaveBlocked || pending || model.conflict || ['failed', 'unknown'].includes(model.saveState)),
  };
}
// A navigation draft belongs to one detail editor. Independent quick input and
// list requests stay with the current page instead of travelling with that item.
const snapshotEditorDraft = model => snapshotTodoDraft({ ...model,
  quickTitle: '', quickPending: null, quickSaveState: 'clean', quickError: '',
  rowPending: null, rowSaveState: 'clean', rowError: '',
});
export function restoreTodoDraft(current, record) {
  if (record.scope !== 'editor') return { ...current, ...record.draft };
  const { item, draft, pending, saveState, conflict, error, editorOpen, leaveSaveBlocked } = record.draft;
  return { ...current, item, draft, pending, saveState, conflict, error, editorOpen, leaveSaveBlocked: Boolean(leaveSaveBlocked) };
}
const validDraft = draft => plain(draft) && todo(draft.item) && plain(draft.draft)
  && (draft.leaveSaveBlocked === undefined || typeof draft.leaveSaveBlocked === 'boolean')
  && ['title', 'body', 'notePath'].every(key => text(draft.draft[key]))
  && request(draft.pending) && request(draft.quickPending) && request(draft.rowPending)
  && states.has(draft.saveState) && states.has(draft.quickSaveState) && states.has(draft.rowSaveState)
  && ['error', 'quickTitle', 'quickError', 'rowError'].every(key => text(draft[key]))
  && typeof draft.conflict === 'boolean' && typeof draft.editorOpen === 'boolean';
const sameRecord = (actual, expected) => actual && actual.libraryId === expected.libraryId
  && actual.scope === expected.scope && actual.updatedAt === expected.updatedAt
  && JSON.stringify(actual.draft) === JSON.stringify(expected.draft);
const changedMessage = '其他页面更新了这份草稿，较新内容已保留。请重新核对待恢复列表。';

// Adapt the notes recovery transaction/CAS pattern to personal todos. idb owns
// IndexedDB transactions; records are isolated by persistent SQLite identity
// and page UUID. A browser recovery copy is not a saved todo or a backup.
export function createTodoDraftRecovery(identity) {
  let state = { ready: false, status: 'loading', error: '', candidates: [], rootChanged: false };
  const listeners = new Set();
  const publish = change => {
    state = { ...state, ...change };
    for (const listener of listeners) listener();
  };
  const pageId = uuidv4();
  let libraryId, database, current, revision = 0, queue = Promise.resolve(), opening, disposed = false;
  let lastWriteError = null;
  const adopted = new Map();
  const candidatesOf = records => records.filter(record => record.id !== pageId).sort((a, b) => b.updatedAt - a.updatedAt);
  const unavailable = () => publish({ ready: Boolean(libraryId), status: 'failed', error: libraryId
    ? '浏览器草稿保护不可用，输入仍在当前页面。请先保存到主机再关闭；不要依赖刷新恢复。'
    : '无法确认当前待办库，暂时禁止保存。请检查连接后重试。' });
  const enqueue = task => {
    queue = queue.catch(() => {}).then(task);
    return queue;
  };
  const persist = model => {
    if (disposed) return;
    current = snapshotTodoDraft(model);
    const next = ++revision;
    if (!database || !libraryId || state.rootChanged) return;
    const value = current, sources = [...adopted.values()];
    publish({ status: 'pending' });
    void enqueue(async () => {
      if (!database || state.rootChanged) throw Error('Draft store unavailable');
      const tx = database.transaction('drafts', 'readwrite');
      try {
        if (hasUnsavedTodoDraft(value)) await tx.store.put({ id: pageId, libraryId, updatedAt: Date.now(), draft: value });
        else await tx.store.delete(pageId);
        let changed = false;
        for (const source of sources) {
          const actual = await tx.store.get(source.id);
          if (sameRecord(actual, source)) await tx.store.delete(source.id);
          else if (actual) changed = true;
        }
        const records = sources.length ? await tx.store.index('libraryId').getAll(libraryId) : null;
        await tx.done;
        lastWriteError = null;
        for (const source of sources) if (adopted.get(source.id) === source) adopted.delete(source.id);
        if (next === revision && !disposed) publish({ status: hasUnsavedTodoDraft(value) ? 'stored' : 'idle',
          error: changed ? changedMessage : '', ...(records ? { candidates: candidatesOf(records) } : {}) });
      } catch (error) {
        try { tx.abort(); } catch {}
        await tx.done.catch(() => {});
        throw error;
      }
    }).catch(error => { lastWriteError = error; if (next === revision && !disposed) unavailable(); });
  };
  async function start() {
    if (opening) return opening;
    publish({ status: 'loading' });
    opening = (async () => {
      try {
        const result = await identity();
        if (disposed) return;
        if (!result || !uuid(result.id)) throw Error('Missing todo identity');
        if (libraryId && result.id !== libraryId) {
          publish({ ready: true, rootChanged: true, error: '待办库已切换。旧草稿仍属于原库，请重新加载页面。' });
          return;
        }
        libraryId = result.id;
        database ??= await openDB('corilo-todos-drafts', 1, {
          upgrade(db) { db.createObjectStore('drafts', { keyPath: 'id' }).createIndex('libraryId', 'libraryId'); },
          blocked() { unavailable(); },
          blocking() { database?.close(); database = undefined; unavailable(); },
          terminated() { database = undefined; unavailable(); },
        });
        if (disposed) { database.close(); database = undefined; return; }
        const records = await database.getAllFromIndex('drafts', 'libraryId', libraryId);
        if (records.some(record => !uuid(record.id) || !Number.isFinite(record.updatedAt)
          || record.scope !== undefined && record.scope !== 'editor' || !validDraft(record.draft))) throw Error('Invalid draft record');
        lastWriteError = null;
        publish({ ready: true, status: 'idle', error: '', candidates: candidatesOf(records) });
        if (current) persist(current);
      } catch (error) { lastWriteError = error; if (!disposed) unavailable(); }
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
    async flush() {
      await queue.catch(() => {});
      if (disposed || !database || !libraryId || state.rootChanged || lastWriteError) throw Error('草稿保护未完成，请保存后再关闭页面。');
    },
    async stash(model, { scope } = {}) {
      if (scope !== undefined && scope !== 'editor') throw Error('Invalid draft scope');
      const value = scope === 'editor' ? snapshotEditorDraft(model) : snapshotTodoDraft(model);
      if (!hasUnsavedTodoDraft(value)) return null;
      if (disposed || !database || !libraryId || state.rootChanged) throw Error('未能安全保留当前输入，请先完成保存或重试草稿保护。');
      const fullPage = scope === 'editor' ? snapshotTodoDraft(model) : null, sources = [...adopted.values()];
      const record = { id: uuidv4(), libraryId, updatedAt: Date.now(), draft: value, ...(scope ? { scope } : {}) };
      publish({ status: 'pending' });
      try {
        await enqueue(async () => {
          if (!database || state.rootChanged) throw Error('Draft store unavailable');
          const tx = database.transaction('drafts', 'readwrite');
          let records, changed = false;
          try {
            await tx.store.add(record);
            // Retain the complete page until track(nextEditor) commits. A crash
            // after this transaction but before navigation must retain quick
            // input as well as the newly archived detail editor.
            if (fullPage) await tx.store.put({ id: pageId, libraryId, updatedAt: Date.now(), draft: fullPage });
            else await tx.store.delete(pageId);
            for (const source of sources) {
              const actual = await tx.store.get(source.id);
              if (sameRecord(actual, source)) await tx.store.delete(source.id);
              else if (actual) changed = true;
            }
            records = await tx.store.index('libraryId').getAll(libraryId);
            await tx.done;
          } catch (error) { try { tx.abort(); } catch {} await tx.done.catch(() => {}); throw error; }
          lastWriteError = null;
          for (const source of sources) if (adopted.get(source.id) === source) adopted.delete(source.id);
          if (!disposed) publish({ status: 'stored', candidates: candidatesOf(records), error: changed ? changedMessage : '' });
        });
        return record;
      } catch (error) {
        lastWriteError = error; if (!disposed) unavailable();
        throw Error('未能保留草稿，输入仍在当前页面。请重试或先保存到主机。');
      }
    },
    needsLeaveWarning: () => Boolean(current && hasUnsavedTodoDraft(current)),
    libraryChanged() { publish({ ready: true, rootChanged: true, error: '待办库已切换。当前草稿已保留，写入暂停，请重新加载页面。' }); },
    adopt(record, model) {
      adopted.set(record.id, record);
      publish({ candidates: state.candidates.filter(candidate => candidate.id !== record.id) });
      persist(model);
    },
    async discard(record) {
      if (!database) { unavailable(); return; }
      try {
        await enqueue(async () => {
          const tx = database.transaction('drafts', 'readwrite');
          try {
            const actual = await tx.store.get(record.id), changed = actual && !sameRecord(actual, record);
            if (sameRecord(actual, record)) await tx.store.delete(record.id);
            const records = await tx.store.index('libraryId').getAll(libraryId);
            await tx.done;
            if (!disposed) publish({ candidates: candidatesOf(records), error: changed ? changedMessage : '' });
          } catch (error) { try { tx.abort(); } catch {} await tx.done.catch(() => {}); throw error; }
        });
      } catch { if (!disposed) unavailable(); }
    },
    dispose() { disposed = true; void queue.finally(() => database?.close()).catch(() => {}); listeners.clear(); },
  };
}
