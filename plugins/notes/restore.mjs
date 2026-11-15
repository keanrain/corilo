#!/usr/bin/env node
// Restic owns the archive, encryption and extraction. This small offline helper
// prepares a verified extracted notes/state pair at a NEW location only.
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { NoteHistory } from './history.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const overlaps = (a, b) => a === b || !path.relative(a, b).startsWith(`..${path.sep}`) && path.relative(a, b) !== '..' && !path.isAbsolute(path.relative(a, b));
const absolute = input => {
  if (typeof input !== 'string' || !path.isAbsolute(input) || input.includes('\0')) throw new Error('All paths must be absolute.');
  return path.resolve(input);
};
async function canonicalDirectory(input) {
  if (await fs.realpath(input) !== input || !(await fs.lstat(input)).isDirectory()) throw new Error('Directories and their parents must not be links.');
}
async function inventory(root) {
  const files = [], directories = [];
  let count = 0;
  const walk = async (directory, depth) => {
    if (depth > 40) throw new Error('Restore tree exceeds depth limit.');
    for (const name of await fs.readdir(directory)) {
      if (++count > 20000) throw new Error('Restore tree exceeds 20000 entries.');
      const filename = path.join(directory, name), stat = await fs.lstat(filename);
      if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory() || stat.isFile() && stat.nlink !== 1) throw new Error('Restore tree contains a link or special file.');
      const relative = path.relative(root, filename);
      if (stat.isDirectory()) { directories.push(relative); await walk(filename, depth + 1); }
      else files.push(relative);
    }
  };
  await walk(root, 0);
  return { files, directories };
}

export async function prepareRestore({ restoredDirectory, originalRoot, targetDirectory }) {
  restoredDirectory = absolute(restoredDirectory); originalRoot = absolute(originalRoot); targetDirectory = absolute(targetDirectory);
  if (overlaps(restoredDirectory, targetDirectory) || overlaps(targetDirectory, restoredDirectory) || overlaps(originalRoot, targetDirectory) || overlaps(targetDirectory, originalRoot)) throw new Error('Restore target must be separate from the extraction and original library.');
  await canonicalDirectory(restoredDirectory);
  await canonicalDirectory(path.dirname(targetDirectory));
  const exists = await fs.lstat(targetDirectory).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
  if (exists) throw new Error('Restore target must not exist; no existing directory is overwritten.');
  if ((await fs.readdir(restoredDirectory)).sort().join('\n') !== 'notes\nstate') throw new Error('Extraction must contain exactly notes/ and state/.');
  const listing = await inventory(restoredDirectory);
  for (const name of ['notes', 'state']) await canonicalDirectory(path.join(restoredDirectory, name));
  const stateRoot = path.join(restoredDirectory, 'state');
  // Uses the original canonical path only for its binding hash. No original
  // files are accessed and no history is initialized or migrated here.
  const history = new NoteHistory(originalRoot, stateRoot, 1024 * 1024);
  await history.check();
  await history.run(['fsck', '--full', '--no-dangling'], undefined, 8192);
  // All preflight checks precede destination creation. Keep a failed partial
  // destination for inspection; never delete anything on the user's behalf.
  await fs.mkdir(targetDirectory, { mode: 0o700 });
  for (const relative of listing.directories) await fs.mkdir(path.join(targetDirectory, relative), { mode: 0o700 });
  for (const relative of listing.files) await fs.copyFile(path.join(restoredDirectory, relative), path.join(targetDirectory, relative), constants.COPYFILE_EXCL);
  const root = path.join(targetDirectory, 'notes'), state = path.join(targetDirectory, 'state');
  const marker = path.join(state, 'corilo-notes-state.json');
  // Only this newly copied state is rebound. The archive/extraction is intact.
  const handle = await fs.open(marker, 'r+');
  try {
    const bytes = Buffer.from(JSON.stringify({ format: 'corilo-notes-state-v1', rootId: hash(root) }) + '\n');
    await handle.write(bytes, 0, bytes.length, 0); await handle.truncate(bytes.length); await handle.sync();
  } finally { await handle.close(); }
  const copied = new NoteHistory(root, state, 1024 * 1024);
  await copied.check();
  await copied.run(['fsck', '--full', '--no-dangling'], undefined, 8192);
  return { root, stateRoot: state, files: listing.files.length, ready: true };
}

export async function main(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!['--restored-directory', '--original-root', '--target-directory'].includes(key) || key in options || !value || value.startsWith('--')) throw new Error('Use --restored-directory ABS --original-root ABS --target-directory ABS.');
    options[key] = value;
  }
  const result = await prepareRestore({ restoredDirectory: options['--restored-directory'], originalRoot: options['--original-root'], targetDirectory: options['--target-directory'] });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main(process.argv.slice(2)).catch(error => { process.stderr.write(`Corilo restore: ${error.message}\n`); process.exitCode = 1; });
