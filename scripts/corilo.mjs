#!/usr/bin/env node
// Compatibility entry for existing commands and installed service files.
// The source launcher is maintained in launcher/corilo.mjs.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { main } from '../launcher/corilo.mjs';

export { initialize, inspect, start, main } from '../launcher/corilo.mjs';

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`Corilo: ${error.message}\n`);
    process.exitCode = 1;
  });
}
