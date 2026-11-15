import path from 'node:path';
import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// Operator diagnostic only. Mount flags never prove a per-vault hard quota.
// In particular, this module deliberately has no ready/enforced success result.
const decodeMountPath = value => value.replace(/\\(040|011|012|134)/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
const contains = (parent, child) => parent === '/' || child === parent || child.startsWith(parent + '/');

export function storageMountReport(mountInfo, mountId, dataRoot) {
  if (typeof mountInfo !== 'string' || Buffer.byteLength(mountInfo) > 2 * 1024 * 1024 ||
      !Number.isSafeInteger(mountId) || mountId < 1 || !path.isAbsolute(dataRoot)) throw new Error('Invalid mount snapshot');
  const mounts = mountInfo.trimEnd().split('\n').map(line => {
    const fields = line.split(' '), separator = fields.indexOf('-');
    if (fields.length < 10 || separator < 6 || fields.length !== separator + 4 ||
        !/^\d+$/.test(fields[0])) throw new Error('Invalid mount snapshot');
    return { id: Number(fields[0]), point: decodeMountPath(fields[4]), type: fields[separator + 1],
      options: new Set([...fields[5].split(','), ...fields[separator + 3].split(',')]) };
  });
  // fdinfo gives the mount actually used for the opened directory. Longest-path
  // matching alone can accidentally inspect a hidden/overmounted filesystem.
  const selected = mounts.filter(mount => mount.id === mountId);
  if (selected.length !== 1 || !contains(selected[0].point, dataRoot)) throw new Error('Storage mount changed or unavailable');
  const mount = selected[0];
  const candidate = ['xfs', 'ext4'].includes(mount.type);
  const option = (mount.options.has('prjquota') || mount.options.has('pquota')) && !mount.options.has('pqnoenforce');
  const nestedMounts = mounts.filter(item => item.id !== mountId && item.point !== dataRoot && contains(dataRoot, item.point)).length;
  return {
    dataRoot, mountPoint: mount.point, filesystem: mount.type,
    projectQuotaMountOption: option ? 'present' : 'absent', nestedMountCount: nestedMounts,
    status: candidate ? 'requires-verification' : 'unsupported-filesystem',
    enforcement: 'unverified',
    blockers: [
      ...(!candidate ? ['A supported persistent filesystem has not been provisioned.'] : []),
      ...(!option ? ['No enforcing project-quota mount option was observed.'] : []),
      ...(nestedMounts ? ['Nested mounts need separate quota coverage checks.'] : []),
      'Per-vault project identity, inheritance and nonzero byte/inode hard limits are not verified.',
      'Worker inability to change project identity/inheritance is not verified.',
      'Actual byte/inode exhaustion and recovery have not been tested.',
    ],
  };
}

async function boundedText(filename, maximum) {
  const file = await open(filename, constants.O_RDONLY);
  try {
    const buffer = Buffer.alloc(maximum + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > maximum) throw new Error('Storage metadata too large');
    return buffer.subarray(0, size).toString('utf8');
  } finally { await file.close(); }
}

export async function inspectStorage(dataRoot) {
  if (process.platform !== 'linux') throw new Error('Linux storage inspection required');
  if (typeof dataRoot !== 'string' || !path.isAbsolute(dataRoot)) throw new Error('Absolute data root required');
  const canonical = await realpath(dataRoot);
  const dir = await open(canonical, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const info = await boundedText(`/proc/self/fdinfo/${dir.fd}`, 16384);
    const id = /^mnt_id:\s+(\d+)$/m.exec(info);
    if (!id) throw new Error('Storage mount identity unavailable');
    const mountInfo = await boundedText('/proc/self/mountinfo', 2 * 1024 * 1024);
    return storageMountReport(mountInfo, Number(id[1]), canonical);
  } finally { await dir.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { 'data-root': { type: 'string' } } });
    const report = await inspectStorage(values['data-root']);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 2; // Diagnostic completed; enforcement remains unverified.
  } catch {
    console.error('Storage inspection failed; provide an existing absolute --data-root on Linux.');
    process.exitCode = 1;
  }
}
