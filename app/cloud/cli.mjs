import path from 'node:path';
import { parseArgs } from 'node:util';
import { Accounts, SupabaseIdentity } from './accounts.mjs';
import { startCloud } from './gateway.mjs';
const { values } = parseArgs({ options: { invite: { type: 'string' }, migrate: { type: 'boolean' } } });
let accounts;
try {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  accounts = new Accounts(process.env.DATABASE_URL);
  if (values.migrate) { await accounts.migrate(); console.log('Cloud schema initialized'); await accounts.close(); }
  else if (values.invite) {
    console.log(await accounts.invite(values.invite)); // Operator-only stdout; never a public API.
    await accounts.close();
  } else {
    for (const name of ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','CORILO_PUBLIC_ORIGIN','CORILO_CLOUD_DATA']) if (!process.env[name]) throw new Error(`${name} is required`);
    const identity = new SupabaseIdentity({ url: process.env.SUPABASE_URL, publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY });
    const port = Number(process.env.PORT || 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
    const socketPath = process.env.CORILO_HOST_CONTROL_SOCKET, token = process.env.CORILO_HOST_CONTROL_TOKEN;
    if (!!socketPath !== !!token) throw new Error('Invalid host control configuration');
    const cloud = await startCloud({ accounts, identity, dataRoot: path.resolve(process.env.CORILO_CLOUD_DATA), publicOrigin: process.env.CORILO_PUBLIC_ORIGIN, port,
      hostControl: socketPath ? { socketPath, token } : null });
    console.log(`Corilo cloud file service listening on ${cloud.address}; AI is disabled`);
    let closing = false;
    const close = async () => { if (closing) return; closing = true; await cloud.close(); await accounts.close(); };
    process.on('SIGTERM', close); process.on('SIGINT', close);
  }
} catch (e) { console.error('Cloud startup failed:', e.code || (e.message?.includes('required') || e.message?.startsWith('Invalid') ? e.message : 'check configuration and database')); await accounts?.close(); process.exitCode = 1; }
