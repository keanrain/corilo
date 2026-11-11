import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { NotesStore } from './storage.mjs';
import { registerNotesApi } from './api.mjs';
import { WorkspaceStore } from './workspace-store.mjs';
import { registerWorkspaceApi } from './workspace-api.mjs';

export const name = 'corilo-notes';
export const inject = ['tools'];
export const Config = z.object({
  root: z.string().required().description('Absolute directory containing the personal Markdown knowledge base.'),
  interface: z.union(['filesmd', 'classic']).default('filesmd').description('Files.md workspace by default; classic preserves the earlier standalone notes page.'),
  stateRoot: z.string().description('Legacy recovery path accepted for existing configurations. The current plugin does not read, write or create history there.'),
});

const string = { type: 'string', required: true };
const versioned = {
  type: 'object', additionalProperties: false,
  properties: { path: string, version: string },
};
const render = (_args, value) => [{ type: 'text', text: JSON.stringify(value) }];
const output = schema => ({ schema, render });
const check = signal => signal?.throwIfAborted();

// These tools use the same storage service as the notes UI. They do not
// replace Harness filesystem tools or introduce a new permission/approval layer.
export function noteTools(store) {
  return [
    defineTool({
      name: 'corilo_notes_list', description: 'Legacy complete list with content versions, bounded to 2000 entries and 8 MiB. Prefer corilo_notes_browse for large libraries; read a note before editing.',
      parameters: {},
      output: output({ type: 'object', additionalProperties: false, properties: {
        items: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
          path: string, version: string, size: { type: 'integer', required: true },
        } } },
      } }),
      async execute(_args, exec) { check(exec.signal); return store.list(); },
    }),
    defineTool({
      name: 'corilo_notes_browse', description: 'Browse Markdown paths and sizes without reading every body. Results are paginated; pass nextCursor as cursor to continue. Optional query filters filenames.',
      parameters: { cursor: { type: 'string' }, query: { type: 'string' } },
      output: output({ type: 'object', additionalProperties: true }),
      async execute(args, exec) { check(exec.signal); return store.browse({ ...args, signal: exec.signal }); },
    }),
    defineTool({
      name: 'corilo_notes_search', description: 'Search literal words in Markdown filenames and content using ripgrep. Results include snippets and line numbers; truncated=true means there are additional matches. Never changes notes.',
      parameters: { query: string }, output: output({ type: 'object', additionalProperties: true }),
      async execute(args, exec) { check(exec.signal); return store.search({ ...args, signal: exec.signal }); },
    }),
    defineTool({
      name: 'corilo_notes_read', description: 'Read a Markdown note and its content version before editing it.',
      parameters: { path: { ...string, description: 'Relative Markdown path inside the configured knowledge base.' } },
      output: output({ type: 'object', additionalProperties: false, properties: { path: string, text: string, version: string } }),
      async execute({ path }, exec) { check(exec.signal); return store.read(path); },
    }),
    defineTool({
      name: 'corilo_notes_create', description: 'Create a Markdown note with an available human-readable untitled name and optional exact initial text (empty by default). Use only when the user asks to create a note, never for ordinary discussion. Returns the new path, text and version for subsequent edits. A lost reply may follow creation: inspect the library before any retry.',
      parameters: { text: { type: 'string', description: 'Optional initial Markdown, preserved without rewriting.' } },
      output: output({ type: 'object', additionalProperties: false, properties: { path: string, text: string, version: string } }),
      async execute(args, exec) { check(exec.signal); return store.create({ ...args, signal: exec.signal }); },
    }),
    defineTool({
      name: 'corilo_notes_save', description: 'Create or save a Markdown note. Pass the version returned by read; null creates only when the path is absent. A stale version is a conflict: read again rather than blindly overwrite. In the Files.md workspace, personal tasks are Markdown checklist items (- [ ] / - [x]) in Later.md; capture uses Chat.md and journals use journal/YYYY.MM Month.md. Read first and preserve unrelated text, timestamps and completion states. These are personal records, not Agent execution plans.',
      parameters: {
        path: string, text: string,
        expected: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
      },
      output: output(versioned),
      async execute(args, exec) { check(exec.signal); return store.save({ ...args, signal: exec.signal }); },
    }),
    defineTool({
      name: 'corilo_notes_rename', description: 'Rename a saved Markdown note within the same directory. Read it first and pass that version. The destination must be absent; existing files are never overwritten. Does not update links or associations. A partial-completion failure requires checking both paths before any retry.',
      parameters: { path: string, to: string, expected: string },
      output: output({ type: 'object', additionalProperties: true }),
      async execute(args, exec) { check(exec.signal); return store.rename({ ...args, signal: exec.signal }); },
    }),
    defineTool({
      name: 'corilo_notes_capture', description: 'Save the exact supplied text as a new Markdown note without rewriting or classification. Use only when the user asks to keep these words.',
      parameters: { text: string }, output: output(versioned),
      async execute({ text }, exec) { check(exec.signal); return store.capture(text, { signal: exec.signal }); },
    }),
  ];
}

export async function apply(ctx, config) {
  const store = await NotesStore.open(config.root);
  for (const tool of noteTools(store)) ctx.tools.register(tool);
  const workspace = config.interface === 'classic' ? null : await WorkspaceStore.open(store);
  await ctx.inject(['connection'], async scope => {
    registerNotesApi(scope, store, { workspace, interface: workspace ? 'filesmd' : 'classic' });
    if (workspace) await registerWorkspaceApi(scope, workspace);
  });
  ctx.logger('corilo-notes').info('Corilo notes tools registered');
}
