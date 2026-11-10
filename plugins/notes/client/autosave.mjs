let session = 0;
export const freshNote = () => ({ sessionId: ++session, path: '', text: '', original: '', expected: null,
  status: 'clean', error: '', latest: null, autosave: 'ready', savingMode: null, renameRequest: null, unknown: false, libraryChanged: false });
export const hasUnsavedNote = note => note.text !== note.original || note.expected === null && note.text !== ''
  || note.autosave === 'blocked' || note.status === 'saving';

// One in-memory document and one versioned save pipeline. No browser draft DB.
export const canAutosave = draft => Boolean(draft.status === 'dirty' && draft.autosave === 'ready'
  && (draft.expected === null ? draft.text.length > 0 : draft.path && draft.text !== draft.original));

export function editedDraft(draft, text) {
  const pending = draft.status === 'saving' || draft.status === 'conflict' || draft.autosave === 'blocked';
  return { ...draft, text,
    status: pending ? draft.status : text === draft.original ? draft.expected === null ? 'clean' : 'saved' : 'dirty' };
}

export function committedDraft(current, submitted, result) {
  return { ...current, path: result.path, original: submitted.text, expected: result.version,
    status: current.text === submitted.text ? 'saved' : 'dirty', savingMode: null,
    autosave: 'ready', unknown: false, error: '', latest: null };
}

export function failedDraft(current, error) {
  return { ...current, status: error.code === 'notes/409' ? 'conflict' : 'failed',
    savingMode: null, autosave: 'blocked', unknown: Boolean(error.unknown), libraryChanged: current.libraryChanged || error.code === 'notes/library-changed', error: error.message, latest: null };
}

// Owned by the plugin, not the mounted page. Harness keeps the bound store
// actions alive across panel switches, so a pending save can finish offscreen.
export function createNoteSaver({ getDraft, call, allowed, delay = 1000 }) {
  let update, notify, timer, scheduled, inFlight = false, disposed = false, paused = false;
  const eligible = () => !disposed && !inFlight && !paused && update && allowed() && canAutosave(getDraft());
  function cancel() { clearTimeout(timer); timer = undefined; scheduled = undefined; }
  function sync() {
    const draft = getDraft();
    if (!eligible()) { cancel(); return; }
    if (scheduled?.path === draft.path && scheduled.expected === draft.expected && scheduled.text === draft.text) return;
    cancel();
    scheduled = { path: draft.path, expected: draft.expected, text: draft.text };
    timer = setTimeout(() => { timer = undefined; scheduled = undefined; void save(false, true); }, delay);
  }
  async function save(copy = false, automatic = false) {
    const submitted = { ...getDraft() };
    if (disposed || !update || !allowed() || inFlight || submitted.status === 'saving' || !copy && !submitted.path && !submitted.text) return;
    if (automatic && !eligible()) return;
    cancel(); inFlight = true;
    update({ ...submitted, status: 'saving', savingMode: automatic ? 'auto' : 'manual', error: '', latest: null });
    try {
      const result = copy || submitted.expected === null && !submitted.path
        ? await call('create', { text: submitted.text })
        : await call('save', { path: submitted.path, text: submitted.text, expected: submitted.expected });
      if (!disposed) { update(committedDraft(copy ? { ...getDraft(), sessionId: ++session } : getDraft(), submitted, result)); notify?.(); }
    } catch (error) {
      if (!disposed) { update(failedDraft(getDraft(), error)); notify?.(); }
    } finally { inFlight = false; sync(); }
  }
  return {
    bind(setDraft, onSaved) { update = setDraft; notify = onSaved; sync(); },
    pause(value) { paused = value; sync(); },
    sync, save,
    dispose() { disposed = true; cancel(); update = undefined; notify = undefined; },
  };
}
