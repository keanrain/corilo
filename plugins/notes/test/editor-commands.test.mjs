import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { history, undo } from '@codemirror/commands';
import { applyEditorChanges, normalizedText, prefixLines, wrapSelection } from '../client/editor-commands.mjs';

test('editor changes preserve untouched BOM, mixed newlines and whitespace', () => {
  const raw = '\uFEFF# 标题\r\nfirst\n末尾  ';
  const state = EditorState.create({ doc: normalizedText(raw) });
  const change = state.update({ changes: [{ from: 3, insert: '新' }, { from: state.doc.length, insert: '!\n下一行' }] });
  assert.equal(applyEditorChanges(raw, change.changes), '\uFEFF# 新标题\r\nfirst\n末尾  !\r\n下一行');
  const removal = state.update({ changes: { from: 2, to: state.doc.length - 2, insert: '😀' } });
  assert.equal(applyEditorChanges(raw, removal.changes), '\uFEFF#😀  ');
});

function editor(text, selection = { anchor: 0, head: text.length }, readOnly = false) {
  return {
    state: EditorState.create({ doc: text, selection, extensions: [history(), EditorState.readOnly.of(readOnly)] }),
    dispatch(transaction) { this.state = transaction.state || this.state.update(transaction).state; },
    focus() {}, composing: false,
  };
}

test('formatting toggles selected text and leaves caret inside empty delimiters', () => {
  const view = editor('重点');
  wrapSelection(view, '**');
  assert.equal(view.state.doc.toString(), '**重点**');
  assert.equal(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to), '重点');
  wrapSelection(view, '**');
  assert.equal(view.state.doc.toString(), '重点');
  const empty = editor('');
  wrapSelection(empty, '`');
  assert.equal(empty.state.doc.toString(), '``');
  assert.equal(empty.state.selection.main.head, 1);
});

test('line formatting respects a selection ending at the next line and can undo', () => {
  const view = editor('一\n二\n三', { anchor: 0, head: 4 });
  prefixLines(view, '- ');
  assert.equal(view.state.doc.toString(), '- 一\n- 二\n三');
  undo({ state: view.state, dispatch: transaction => view.dispatch(transaction) });
  assert.equal(view.state.doc.toString(), '一\n二\n三');
  const locked = editor('不能改', undefined, true);
  assert.equal(wrapSelection(locked, '**'), false);
  assert.equal(prefixLines(locked, '> '), false);
  assert.equal(locked.state.doc.toString(), '不能改');
  view.composing = true;
  assert.equal(wrapSelection(view, '**'), false);
});
