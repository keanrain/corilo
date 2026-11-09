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

export const markdownPath = path => path && !/\.(md|markdown)$/i.test(path) ? `${path}.md` : path;

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
    if (disposed || !update || inFlight || submitted.status === 'saving' || !submitted.path && !submitted.text) return;
    if (automatic && !eligible()) return;
    cancel(); inFlight = true;
    update({ ...submitted, status: 'saving', savingMode: automatic ? 'auto' : 'manual', error: '', latest: null });
    try {
      const result = copy || !submitted.path
        ? await call('capture', { text: submitted.text })
        : await call('save', { path: submitted.expected === null ? markdownPath(submitted.path) : submitted.path, text: submitted.text, expected: submitted.expected });
      if (!disposed) { update(committedDraft(getDraft(), submitted, result)); notify?.(); }
    } catch (error) {
      if (!disposed) update(failedDraft(getDraft(), error));
    } finally { inFlight = false; sync(); }
  }
  return {
    bind(setDraft, onSaved) { update = setDraft; notify = onSaved; sync(); },
    pause(value) { paused = value; sync(); },
    sync, save,
    dispose() { disposed = true; cancel(); update = undefined; notify = undefined; },
  };
}
