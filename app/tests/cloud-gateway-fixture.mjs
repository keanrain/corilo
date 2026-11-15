import { fork } from 'node:child_process';
import { once } from 'node:events';
export async function gatewayChild({ dataRoot, socketPath, token }) {
  const child=fork(new URL('./cloud-gateway-child.mjs',import.meta.url),[],{stdio:['ignore','ignore','pipe','ipc']});
  // Never forward child diagnostics/credentials into test output.
  child.stderr.resume();
  const exited=once(child,'exit');
  const ready=new Promise((resolve,reject)=> {
    const timer=setTimeout(()=>reject(new Error('Gateway child startup timed out')),10000);
    const finish=(error,value)=>{clearTimeout(timer);child.off('message',message);child.off('exit',earlyExit);error?reject(error):resolve(value);};
    const message=value=>value.type==='ready'?finish(null,value):finish(new Error('Gateway child startup failed'));
    const earlyExit=()=>finish(new Error('Gateway child exited before startup'));
    child.on('message',message);child.once('exit',earlyExit);
  });
  child.send({type:'start',dataRoot,socketPath,token});
  try {
    const {address}=await ready;
    let closeTask;
    return {address,close(){
      if(!closeTask)closeTask=(async()=>{
        const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
        if(child.connected)child.send({type:'close'});
        try {const [code]=await exited;if(code!==0)throw new Error('Gateway child shutdown failed');}
        finally {clearTimeout(timer);}
      })();
      return closeTask;
    }};
  } catch(error){child.kill('SIGKILL');await exited;throw error;}
}
