// Save metadata stays in the page's business state. Recovery records deliberately
// do not inherit permission to write: adopting a draft is a separate user action.
export const canAutosave = draft => Boolean(draft.path && draft.expected !== null
  && draft.text !== draft.original && draft.status === 'dirty' && draft.autosave === 'ready');

export function editedDraft(draft, text) {
  return { ...draft, text,
    status: draft.status === 'saving' || draft.status === 'conflict' ? draft.status : 'dirty',
    autosave: draft.autosave === 'recovered' ? 'ready' : draft.autosave || 'ready' };
}

export function committedDraft(current, submitted, result) {
  return { ...current, path: result.path, original: submitted.text, expected: result.version,
    status: current.text === submitted.text ? 'saved' : 'dirty', savingMode: null,
    autosave: 'ready', error: '', latest: null, notice: '' };
}

export function failedDraft(current, error) {
  return { ...current, status: error.code === 'notes/409' ? 'conflict' : 'failed',
    savingMode: null, autosave: 'blocked', error: error.message, latest: null };
}
