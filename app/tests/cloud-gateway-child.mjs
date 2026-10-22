// Test-only child process; the production CLI has no synthetic identity option.
import { Accounts } from '../cloud/accounts.mjs';
import { startCloud } from '../cloud/gateway.mjs';
let accounts, cloud;
process.on('message', async message => {
  try {
    if (message.type === 'start') {
      accounts = new Accounts(process.env.CORILO_TEST_DATABASE_URL);
      cloud = await startCloud({ accounts, dataRoot:message.dataRoot, publicOrigin:'http://127.0.0.1:0',
        identity:{signIn:async()=>{throw new Error('Synthetic identity disabled');}},
        hostControl:{socketPath:message.socketPath,token:message.token} });
      process.send({type:'ready',address:cloud.address});
    } else if (message.type === 'close') {
      await cloud?.close(); await accounts?.close(); process.disconnect();
    }
  } catch { process.send?.({type:'failed'}); await cloud?.close();await accounts?.close();process.exitCode=1;process.disconnect(); }
});
