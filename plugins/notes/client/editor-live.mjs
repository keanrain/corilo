import { syntaxTree } from '@codemirror/language';
import { Decoration, ViewPlugin } from '@codemirror/view';

// Reuse Lezer's Markdown tree. Hide only presentation delimiters outside the
// active lines; the editable document always remains the original Markdown.
export const liveMarkdown = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view); }
  update(update) { this.decorations = this.build(update.view); }
  build(view) {
    const marks = [];
    const active = view.state.selection.ranges.map(range => ({
      from: view.state.doc.lineAt(range.from).from,
      to: view.state.doc.lineAt(range.to).to,
    }));
    for (const range of view.visibleRanges) {
      syntaxTree(view.state).iterate({ from: range.from, to: range.to, enter: node => {
        if (node.from < range.from || node.to > range.to) return;
        if (active.some(line => node.from <= line.to && node.to >= line.from)) return;
        if (!['HeaderMark', 'EmphasisMark', 'StrikethroughMark', 'CodeMark'].includes(node.name)) return;
        if (node.name === 'CodeMark' && node.node.parent?.name !== 'InlineCode') return;
        let end = node.to;
        if (node.name === 'HeaderMark' && view.state.sliceDoc(end, end + 1) === ' ') end++;
        marks.push(Decoration.replace({}).range(node.from, end));
      } });
    }
    return Decoration.set(marks, true);
  }
}, { decorations: plugin => plugin.decorations });
