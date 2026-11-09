import { defineTool } from '@deepseek-ai/dsh-tools';

const string = { type: 'string', required: true };
const expected = { oneOf: [{ type: 'string' }, { type: 'null' }], required: true };
const output = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
};

// These operations share the UI's Git-backed service and the same version queue.
export function recoveryTools(store) {
  const definitions = [
    ['history', 'List a bounded page of recovery checkpoints. Pass nextCursor as cursor to view older versions. To follow rename history, use its previousPath and previousRevision as path and at.', { path: string, cursor: { type: 'string' }, at: { type: 'string' } }, args => store.history(args.path, { cursor: args.cursor, at: args.at })],
    ['read_revision', 'Read one recovery checkpoint before choosing a restore.', { path: string, revision: string }, args => store.readRevision(args.path, args.revision)],
    ['restore_revision', 'Restore a selected checkpoint only after reading the current file. Pass its version; stale versions cannot overwrite newer text.', { path: string, revision: string, expected }, (args, signal) => store.restore({ ...args, signal })],
    ['trash', 'Move a note to recoverable trash only when the user requests deletion. Requires the version returned by read.', { path: string, expected: string }, (args, signal) => store.trash({ ...args, signal })],
    ['list_trash', 'List a bounded page of recoverable deleted notes in stable ID order. When hasMore is true, pass nextCursor as cursor to continue.', { cursor: { type: 'string', description: 'The nextCursor returned by the preceding page; omit for the first page.' } }, args => store.listTrash(args)],
    ['restore_trash', 'Restore a deleted note to an absent Markdown path. Pass expected=null; never overwrite an existing note.', { id: string, path: string, expected: { type: 'null', required: true } }, (args, signal) => store.restoreTrash({ ...args, signal })],
  ];
  return definitions.map(([suffix, description, parameters, execute]) => defineTool({
    name: `corilo_notes_${suffix}`, description, parameters, output,
    async execute(args, execution) { execution.signal?.throwIfAborted(); return execute(args, execution.signal); },
  }));
}
