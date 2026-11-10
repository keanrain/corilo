import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, drawSelection, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import { applyEditorChanges, normalizedText, prefixLines, wrapSelection } from './editor-commands.mjs';
import { liveMarkdown } from './editor-live.mjs';

const highlighting = HighlightStyle.define([
  { tag: tags.heading1, class: 'corilo-md-h1' },
  { tag: tags.heading2, class: 'corilo-md-h2' },
  { tag: tags.heading, class: 'corilo-md-heading' },
  { tag: tags.strong, class: 'corilo-md-strong' },
  { tag: tags.emphasis, class: 'corilo-md-emphasis' },
  { tag: tags.monospace, class: 'corilo-md-code' },
  { tag: tags.link, class: 'corilo-md-link' },
  { tag: tags.url, class: 'corilo-md-link' },
  { tag: tags.meta, class: 'corilo-md-mark' },
  { tag: tags.processingInstruction, class: 'corilo-md-mark' },
]);

export const MarkdownEditor = forwardRef(function MarkdownEditor({ text, documentId, disabled, onChange, onCompositionChange }, ref) {
  const parent = useRef(null);
  const editor = useRef(null);
  const props = useRef({ text, onChange, onCompositionChange });
  props.current = { text, onChange, onCompositionChange };
  const raw = useRef(text);
  const identity = useRef(documentId);
  const lock = useRef(new Compartment());
  const extensions = () => [
    lock.current.of([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled), EditorView.contentAttributes.of({ 'aria-disabled': String(disabled) })]),
    history(), drawSelection(), EditorView.lineWrapping, placeholder('开始写作…'),
    EditorState.phrases.of({ Find: '查找正文', Replace: '替换为', next: '下一个', previous: '上一个', all: '全选匹配', replace: '替换', 'replace all': '全部替换', close: '关闭查找', 'match case': '区分大小写', regexp: '正则表达式', 'by word': '全词匹配', 'No matches': '未找到匹配' }),
    markdown({ base: markdownLanguage }), syntaxHighlighting(highlighting), liveMarkdown, search({ top: true }),
    EditorView.contentAttributes.of({ role: 'textbox', 'aria-label': '笔记正文', 'aria-multiline': 'true', spellcheck: 'false', autocapitalize: 'off' }),
    keymap.of([
      { key: 'Mod-b', run: view => wrapSelection(view, '**'), preventDefault: true },
      { key: 'Mod-i', run: view => wrapSelection(view, '*'), preventDefault: true },
      { key: 'Mod-Shift-z', run: redo, preventDefault: true },
      ...historyKeymap, ...searchKeymap, ...defaultKeymap,
    ]),
    EditorView.domEventHandlers({
      compositionstart: () => { props.current.onCompositionChange(true); return false; },
      compositionend: () => { props.current.onCompositionChange(false); return false; },
      keydown: event => {
        // Keep document shortcuts inside the plugin instead of triggering a
        // second host action. Save still bubbles to NotesPage's existing guard.
        if ((event.ctrlKey || event.metaKey) && ['b', 'i', 'f', 'h', 'z', 'y'].includes(event.key.toLowerCase())) event.stopPropagation();
        return false;
      },
    }),
    EditorView.updateListener.of(update => {
      if (!update.docChanged) return;
      for (const transaction of update.transactions) raw.current = applyEditorChanges(raw.current, transaction.changes);
      props.current.onChange(raw.current);
    }),
  ];
  useImperativeHandle(ref, () => ({
    focus: () => editor.current?.focus(),
    hasFocus: () => editor.current?.hasFocus,
  }), []);
  useLayoutEffect(() => {
    raw.current = props.current.text;
    const view = new EditorView({ parent: parent.current, state: EditorState.create({ doc: normalizedText(raw.current), extensions: extensions() }) });
    editor.current = view;
    return () => { editor.current = null; view.destroy(); };
  }, []);
  useLayoutEffect(() => {
    const view = editor.current;
    const changedDocument = identity.current !== documentId;
    identity.current = documentId;
    if (changedDocument || normalizedText(text) !== view.state.doc.toString()) {
      // Reading another file or adopting a conflict version starts a separate
      // undo history. Save acknowledgements must never reset history/selection.
      raw.current = text;
      view.setState(EditorState.create({ doc: normalizedText(text), extensions: extensions() }));
    } else raw.current = text;
  }, [text, documentId]);
  useEffect(() => {
    editor.current.dispatch({ effects: lock.current.reconfigure([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled), EditorView.contentAttributes.of({ 'aria-disabled': String(disabled) })]) });
  }, [disabled]);
  const run = command => {
    if (!disabled && !editor.current.composing) command(editor.current);
  };
  return <div className="corilo-markdown-editor">
    <div className="corilo-format-tools" role="group" aria-label="正文格式">
      {[
        ['标题', 'H', view => prefixLines(view, '## ')],
        ['加粗', 'B', view => wrapSelection(view, '**')],
        ['斜体', 'I', view => wrapSelection(view, '*')],
        ['列表', '☷', view => prefixLines(view, '- ')],
        ['引用', '❞', view => prefixLines(view, '> ')],
        ['行内代码', '</>', view => wrapSelection(view, '`')],
        ['撤销', '↶', undo], ['重做', '↷', redo], ['查找正文', '⌕', openSearchPanel],
      ].map(([label, icon, command]) => <button key={label} type="button" aria-label={label} title={label} disabled={disabled}
        onMouseDown={event => event.preventDefault()} onClick={() => run(command)}>{icon}</button>)}
    </div>
    <div ref={parent} className="corilo-codemirror" />
  </div>;
});
