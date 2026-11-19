import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerWorkspaceApi, transform } from '../workspace-api.mjs';

const web = fileURLToPath(new URL('../vendor/filesmd/web/', import.meta.url));
const binary = new Set(['.png', '.jpg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf']);

async function* walk(dir, relative = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) yield* walk(path.join(dir, entry.name), relative + entry.name + '/');
    else yield relative + entry.name;
  }
}

test('binary vendor assets pass through the workspace transform unchanged', async () => {
  let checked = 0;
  for await (const name of walk(web)) {
    if (!binary.has(path.extname(name))) continue;
    const bytes = await readFile(path.join(web, name));
    assert.ok(Buffer.compare(transform(name, bytes), bytes) === 0, `${name} was altered`);
    checked++;
  }
  assert.ok(checked > 5, 'expected the pinned Files.md images to be present');
});

test('workspace route serves the empty-state icon byte for byte', async () => {
  const routes = new Map();
  const ctx = { effect: fn => fn(), connection: { fetch: { register: route => { routes.set(route.path, route); return () => {}; } } } };
  await registerWorkspaceApi(ctx, { identity: 'test' });
  const route = routes.get('/api/corilo-notes/workspace/img/icon.png');
  assert.ok(route, 'icon route registered');
  const response = await route.fetch(new Request('http://host/api/corilo-notes/workspace/img/icon.png'));
  const served = Buffer.from(await response.arrayBuffer());
  const original = await readFile(path.join(web, 'img/icon.png'));
  assert.equal(served.length, original.length);
  assert.ok(Buffer.compare(served, original) === 0);
  assert.equal(response.headers.get('content-type'), 'image/png');
});

test('text assets still receive the pinned integration patches', async () => {
  const html = await readFile(path.join(web, 'index.html'));
  assert.match(transform('index.html', html).toString(), /<script src="host.js"><\/script>/);
});
