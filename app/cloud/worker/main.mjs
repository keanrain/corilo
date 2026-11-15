import { readFile, rm } from 'node:fs/promises';
import { PiAgent } from '../../host/agent.mjs';
import { startModelBridge, prepareModelConfig } from './model-bridge.mjs';

// No public HTTP server, Docker API, database credentials or alternate tool framework.
// The optional loopback transport can reach only the mounted model relay socket.
const request = JSON.parse(await readFile('/run/corilo/request.json', 'utf8'));
if (typeof request.prompt !== 'string' || !request.prompt.trim() || Buffer.byteLength(request.prompt) > 65536)
  throw new Error('Invalid worker request');
let agent, bridge, temporaryConfig;
try {
  if(request.model) {
    bridge=await startModelBridge();
    temporaryConfig=await prepareModelConfig(request.model,bridge.origin);
  }
  agent=new PiAgent({ root: '/knowledge' }, '/state', temporaryConfig || '/pi');
  await agent.init();
  await agent.prompt(request.prompt);
} catch {
  // Detailed provider errors can contain user content or credentials; do not log them.
  process.exitCode = 1;
} finally {
  const cleanup=await Promise.allSettled([agent?.close(),bridge?.close()]);
  if(cleanup.some(result=>result.status==='rejected'))process.exitCode=1;
  if(temporaryConfig)await rm(temporaryConfig,{recursive:true,force:true}).catch(()=>{process.exitCode=1;});
}
