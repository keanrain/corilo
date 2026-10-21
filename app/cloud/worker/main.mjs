import { readFile } from 'node:fs/promises';
import { PiAgent } from '../../host/agent.mjs';

// No HTTP server, Docker API, database credentials or alternate model/tool framework.
// The trusted controller mounts one bounded request plus this user's state/config.
const request = JSON.parse(await readFile('/run/corilo/request.json', 'utf8'));
if (typeof request.prompt !== 'string' || !request.prompt.trim() || Buffer.byteLength(request.prompt) > 65536)
  throw new Error('Invalid worker request');
const agent = new PiAgent({ root: '/knowledge' }, '/state', '/pi');
try {
  await agent.init();
  await agent.prompt(request.prompt);
} catch {
  // Detailed provider errors can contain user content or credentials; do not log them.
  process.exitCode = 1;
} finally { await agent.close(); }
