import test from 'node:test';
import assert from 'node:assert/strict';
import { canAutosave, editedDraft, committedDraft, failedDraft, createNoteSaver } from '../client/autosave.mjs';
import { hasUnsavedNote as hasUnsavedDraft } from '../client/autosave.mjs';

const loaded = () => ({ path: '想法.md', text: '已保存', original: '已保存', expected: 'old-version', status: 'saved', autosave: 'ready' });

test('autosave accepts intentional document input and pauses in-flight saves and failures', () => {
  const dirty = editedDraft(loaded(), '新的输入');
  assert.equal(canAutosave({ ...dirty, path: '', expected: null }), true, 'typing may create its first document');
  assert.equal(canAutosave(dirty), true);
  assert.equal(editedDraft(dirty, dirty.original).status, 'saved', 'undoing an unsubmitted edit restores the confirmed status');
  for (const draft of [{ ...dirty, status: 'saving' }, { ...dirty, status: 'conflict' }]) assert.equal(canAutosave(draft), false);
  const failure = failedDraft(dirty, new Error('回复丢失，结果未知'));
  assert.equal(canAutosave(editedDraft(failure, '失败后继续输入')), false);
  assert.equal(canAutosave(editedDraft(failedDraft(dirty, { code: 'notes/409', message: '外部更新' }), '冲突后继续输入')), false);
});

test('plugin-owned scheduling honors pause, failure and disposal without a mounted view', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let draft = editedDraft(loaded(), '待保存'), enabled = true;
  const calls = [];
  const saver = createNoteSaver({ getDraft: () => draft, allowed: () => enabled,
    call: async (method, args) => { calls.push({ method, args }); throw Error('unknown commit'); } });
  const update = value => { draft = value; saver.sync(); };
  saver.bind(update);
  t.after(() => saver.dispose());
  saver.pause(true);
  t.mock.timers.tick(2000);
  assert.equal(calls.length, 0, 'a live editor operation blocks background saves');
  saver.pause(false);
  enabled = false; saver.sync();
  t.mock.timers.tick(2000);
  assert.equal(calls.length, 0, 'the user setting also applies offscreen');
  enabled = true; saver.sync();
  t.mock.timers.tick(1000);
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.equal(draft.autosave, 'blocked');
  update(editedDraft(draft, '失败后继续输入'));
  t.mock.timers.tick(5000);
  assert.equal(calls.length, 1, 'unknown results never retry on a timer');
  update({ ...draft, status: 'dirty', autosave: 'ready' });
  saver.dispose();
  t.mock.timers.tick(2000);
  assert.equal(calls.length, 1, 'unloading the plugin cancels pending work');
});

test('an in-flight save advances only its submitted version and retains later typing', () => {
  const submitted = editedDraft(loaded(), '第一段');
  const writing = { ...submitted, status: 'saving', savingMode: 'auto' };
  const typed = editedDraft(writing, '第一段，保存期间继续写');
  assert.equal(typed.status, 'saving');
  const merged = committedDraft(typed, submitted, { path: submitted.path, version: 'committed-version' });
  assert.equal(merged.text, '第一段，保存期间继续写');
  assert.equal(merged.original, '第一段');
  assert.equal(merged.expected, 'committed-version');
  assert.equal(canAutosave(merged), true);
  const failure = failedDraft(typed, new Error('断线'));
  assert.equal(failure.text, typed.text);
  assert.equal(failure.expected, 'old-version');
  assert.equal(failure.autosave, 'blocked');
  assert.equal(committedDraft(submitted, submitted, { path: submitted.path, version: 'new' }).status, 'saved');
  const reverted = editedDraft(writing, writing.original);
  assert.equal(hasUnsavedDraft(reverted), true, 'reverting to the old original while a write is in flight still needs recovery');
  assert.equal(hasUnsavedDraft(failedDraft(reverted, new Error('unknown result'))), true, 'uncertain commit may have replaced the old original on disk');
});
