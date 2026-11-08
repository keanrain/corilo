import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { TodoStore } from './storage.mjs';
import { registerTodosApi } from './api.mjs';

export const name = 'corilo-todos';
export const inject = ['tools'];
export const Config = z.object({
  root: z.string().required().description('Absolute private directory for this personal todo SQLite database, outside the Markdown knowledge base.'),
  notesRoot: z.string().description('Optional absolute Markdown library directory. It must not overlap the todo data directory.'),
});

const string = { type: 'string', required: true };
const status = { type: 'string', enum: ['open', 'done', 'cancelled'] };
const output = { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };
const check = signal => signal?.throwIfAborted();

// Personal records use the same SQLite service as the direct page. These are
// not Harness's execution-plan tasks and do not schedule notifications.
export function todoTools(store) {
  return [
    defineTool({
      name: 'corilo_todos_list', description: 'List the user\'s personal todos, not the Agent execution plan. Defaults to open items, at most 100 per page. Continue using nextCursor; optional literal query searches titles and details.',
      parameters: { status: { type: 'string', enum: ['open', 'done', 'cancelled', 'all'] }, cursor: { oneOf: [{ type: 'string' }, { type: 'null' }] }, query: { type: 'string' } }, output,
      async execute(args, exec) { check(exec.signal); return store.list({ ...args, signal: exec.signal }); },
    }),
    defineTool({
      name: 'corilo_todos_read', description: 'Read a personal todo and its integer version before editing, completing or cancelling it.',
      parameters: { id: string }, output,
      async execute({ id }, exec) { check(exec.signal); return store.get(id); },
    }),
    defineTool({
      name: 'corilo_todos_create', description: 'Create a personal todo only when the user asks. Supply one UUID v4 requestId and reuse it unchanged when retrying an unknown result, to avoid duplicates. notePath optionally associates a relative Markdown path. No reminder or notification is scheduled.',
      parameters: { requestId: string, title: string, body: { type: 'string' }, notePath: { oneOf: [{ type: 'string' }, { type: 'null' }] } }, output,
      async execute(args, exec) { check(exec.signal); return store.create({ ...args, signal: exec.signal }); },
    }),
    defineTool({
      name: 'corilo_todos_update', description: 'Edit, complete, cancel or reopen a personal todo. Read it first and supply its integer version as expected. Set patch.status to done, cancelled or open. A stale version is a conflict: read again and reconcile. Reuse the same requestId and payload only when retrying an unknown response. No notification is scheduled.',
      parameters: { requestId: string, id: string, expected: { type: 'integer', required: true }, patch: { type: 'object', required: true, additionalProperties: false, properties: { title: { type: 'string' }, body: { type: 'string' }, notePath: { oneOf: [{ type: 'string' }, { type: 'null' }] }, status } } }, output,
      async execute(args, exec) { check(exec.signal); return store.update({ ...args, signal: exec.signal }); },
    }),
    defineTool({
      name: 'corilo_todos_export', description: 'Export all personal todo records in the versioned public corilo-todos-v1 JSON format. This is not a full Harness instance backup and does not include credentials or Agent sessions.',
      parameters: {}, output,
      async execute(_args, exec) { check(exec.signal); return store.export({ signal: exec.signal }); },
    }),
  ];
}

export async function apply(ctx, config) {
  const store = await TodoStore.open(config.root, { notesRoot: config.notesRoot });
  ctx.effect(() => () => store.close());
  for (const tool of todoTools(store)) ctx.tools.register(tool);
  await ctx.inject(['connection'], scope => { registerTodosApi(scope, store); });
  ctx.logger('corilo-todos').info('Corilo personal todo tools registered');
}
