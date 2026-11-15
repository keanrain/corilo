import path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';

const invalid = () => new Error('Invalid recovery controller configuration');
const contains = (parent, child) => parent === path.parse(parent).root || parent === child || child.startsWith(parent + path.sep);
const absolute = value => {
  if (typeof value !== 'string' || !value || value.includes('\0') || !path.isAbsolute(value) || path.resolve(value) !== value) throw invalid();
  return value;
};
const integer = (value, fallback, min, max) => {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw invalid();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw invalid();
  return number;
};

// No execution admission switch, worker resource defaults or model credentials.
// Recovery can revoke and stop existing work without pretending execution quotas exist.
export function readControllerConfig(env = process.env) {
  if (typeof env.DATABASE_URL !== 'string' || !env.DATABASE_URL || env.DATABASE_URL.includes('\0')) throw invalid();
  let database;
  try { database = new URL(env.DATABASE_URL); } catch { throw invalid(); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !database.hostname || database.hash) throw invalid();
  const config = {
    databaseUrl: env.DATABASE_URL,
    dataRoot: absolute(env.CORILO_CLOUD_DATA),
    journalRoot: absolute(env.CORILO_CONTROLLER_STATE),
    socketRoot: absolute(env.CORILO_MODEL_SOCKET_ROOT),
    hostSocket: absolute(env.CORILO_HOST_CONTROL_SOCKET),
    hostToken: env.CORILO_HOST_CONTROL_TOKEN,
    pollMs: integer(env.CORILO_CONTROLLER_POLL_MS, 1000, 20, 5000),
    retryMs: integer(env.CORILO_CONTROLLER_RETRY_MS, 5000, 100, 60000),
  };
  if (typeof config.hostToken !== 'string' || !/^[a-f0-9]{64}$/.test(config.hostToken) ||
      config.retryMs < config.pollMs || Buffer.byteLength(config.hostSocket) > 100 ||
      Buffer.byteLength(path.join(config.socketRoot, '0'.repeat(36), 'm.sock')) > 100) throw invalid();
  const roots = [config.dataRoot, config.journalRoot, config.socketRoot, path.dirname(config.hostSocket)];
  for (let i = 0; i < roots.length; i++) for (let j = i + 1; j < roots.length; j++)
    if (contains(roots[i], roots[j]) || contains(roots[j], roots[i])) throw invalid();
  return Object.freeze(config);
}

// Inspect only; never create/chmod/delete operator-supplied directories or sockets.
export async function inspectControllerPaths(config) {
  if (process.platform !== 'linux' || typeof process.getuid !== 'function' || process.getuid() === 0) throw invalid();
  for (const [directory, privateDirectory] of [[config.dataRoot, false], [config.journalRoot, true],
    [config.socketRoot, true], [path.dirname(config.hostSocket), true]]) {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || await realpath(directory) !== directory ||
        (privateDirectory && (stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700))) throw invalid();
  }
  const socket = await lstat(config.hostSocket);
  if (!socket.isSocket() || socket.uid !== process.getuid() || (socket.mode & 0o777) !== 0o600) throw invalid();
}
