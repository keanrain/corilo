import test from 'node:test';
import assert from 'node:assert/strict';
import { canAutosave, editedDraft, committedDraft, failedDraft } from '../client/autosave.mjs';
import { hasUnsavedDraft } from '../client/drafts.mjs';

const loaded = () => ({ path: '想法.md', text: '已保存', original: '已保存', expected: 'old-version', status: 'saved', autosave: 'ready' });

test('autosave only accepts explicitly edited saved documents and pauses recovery and failures', () => {
  const dirty = editedDraft(loaded(), '新的输入');
  assert.equal(canAutosave(dirty), true);
  for (const draft of [{ ...dirty, expected: null }, { ...dirty, status: 'saving' }, { ...dirty, autosave: 'recovered' }, { ...dirty, status: 'conflict' }]) assert.equal(canAutosave(draft), false);
  assert.equal(canAutosave(editedDraft({ ...dirty, autosave: 'recovered' }, '恢复后明确编辑')), true);
  const failure = failedDraft(dirty, new Error('回复丢失，结果未知'));
  assert.equal(canAutosave(editedDraft(failure, '失败后继续输入')), false);
  assert.equal(canAutosave(editedDraft(failedDraft(dirty, { code: 'notes/409', message: '外部更新' }), '冲突后继续输入')), false);
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
