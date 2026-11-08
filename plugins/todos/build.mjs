import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url)));
// Reproduce the pinned Harness lazy-CJS contract; React/store identities come
// from the shell's frozen platform table, never a second bundled runtime.
await build({
  absWorkingDir: import.meta.dirname,
  entryPoints: ['client/index.jsx'], outfile: 'lib/client.js', bundle: true,
  format: 'cjs', platform: 'browser', target: 'es2022',
  loader: { '.css': 'text' },
  external: ['react', '@deepseek-ai/dsh-client-store'],
  banner: { js: `window.__ModuleLoader__.load({id:${JSON.stringify(pkg.name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;` },
  footer: { js: 'return module.exports;}});' },
});
