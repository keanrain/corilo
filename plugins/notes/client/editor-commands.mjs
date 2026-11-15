import { EditorSelection } from '@codemirror/state';

export const normalizedText = text => text.replace(/\r\n?/g, '\n');

// Translate CM's logical positions to the original file. Unchanged CRLF,
// BOM and surrounding whitespace must not be rewritten by an ordinary edit.
export function applyEditorChanges(raw, changes) {
  let logical = 0, physical = 0;
  const offset = position => {
    while (logical < position) {
      if (raw[physical] === '\r' && raw[physical + 1] === '\n') physical++;
      physical++; logical++;
    }
    return physical;
  };
  const separator = raw.includes('\r\n') ? '\r\n' : raw.includes('\r') && !raw.includes('\n') ? '\r' : '\n';
  const pieces = [];
  let end = 0;
  changes.iterChanges((from, to, _fromNew, _toNew, inserted) => {
    pieces.push(raw.slice(end, offset(from)), inserted.toString().replace(/\n/g, separator));
    end = offset(to);
  });
  pieces.push(raw.slice(end));
  return pieces.join('');
}

export function wrapSelection(view, marker) {
  if (view.state.readOnly || view.composing) return false;
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const outside = from >= marker.length && view.state.sliceDoc(from - marker.length, from) === marker && view.state.sliceDoc(to, to + marker.length) === marker;
  const inside = selected.length >= marker.length * 2 && selected.startsWith(marker) && selected.endsWith(marker);
  if (outside || inside) {
    const start = outside ? from - marker.length : from;
    const finish = outside ? to + marker.length : to;
    const length = selected.length - (inside ? marker.length * 2 : 0);
    view.dispatch({ changes: [{ from: start, to: start + marker.length }, { from: finish - marker.length, to: finish }], selection: EditorSelection.range(start, start + length), userEvent: 'input.format' });
  } else {
    view.dispatch({ changes: from === to ? { from, insert: marker + marker } : [{ from, insert: marker }, { from: to, insert: marker }], selection: EditorSelection.range(from + marker.length, to + marker.length), userEvent: 'input.format' });
  }
  view.focus();
  return true;
}

export function prefixLines(view, prefix) {
  if (view.state.readOnly || view.composing) return false;
  const { from, to } = view.state.selection.main;
  const first = view.state.doc.lineAt(from);
  const last = view.state.doc.lineAt(to > from && view.state.doc.lineAt(to).from === to ? to - 1 : to);
  const lines = [];
  for (let number = first.number; number <= last.number; number++) lines.push(view.state.doc.line(number));
  const remove = lines.every(line => line.text.startsWith(prefix));
  view.dispatch({ changes: lines.map(line => ({ from: line.from, to: line.from + (remove ? prefix.length : 0), insert: remove ? '' : prefix })), userEvent: 'input.format' });
  view.focus();
  return true;
}
