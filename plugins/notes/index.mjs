import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { NotesStore } from './storage.mjs';
import { registerNotesApi } from './api.mjs';

export const name = 'corilo-notes';
export const inject = ['tools'];
export const Config = z.object({
  root: z.string().required().description('Absolute directory containing the personal Markdown knowledge base.'),
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
      name: 'corilo_notes_list', description: 'List Markdown notes and their current versions. A bounded full scan fails rather than silently truncates.',
      parameters: {},
      output: output({ type: 'object', additionalProperties: false, properties: {
        items: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
          path: string, version: string, size: { type: 'integer', required: true },
        } } },
      } }),
      async execute(_args, exec) { check(exec.signal); return store.list(); },
    }),
    defineTool({
      name: 'corilo_notes_read', description: 'Read a Markdown note and its content version before editing it.',
      parameters: { path: { ...string, description: 'Relative Markdown path inside the configured knowledge base.' } },
      output: output({ type: 'object', additionalProperties: false, properties: { path: string, text: string, version: string } }),
      async execute({ path }, exec) { check(exec.signal); return store.read(path); },
    }),
    defineTool({
      name: 'corilo_notes_save', description: 'Create or save a Markdown note. Pass the version returned by read; null creates only when the path is absent. A stale version is a conflict: read again rather than blindly overwrite.',
      parameters: {
        path: string, text: string,
        expected: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
      },
      output: output(versioned),
      async execute(args, exec) { check(exec.signal); return store.save({ ...args, signal: exec.signal }); },
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
  await ctx.inject(['connection'], scope => { registerNotesApi(scope, store); });
  ctx.logger('corilo-notes').info('Corilo notes tools registered');
}
