// Android Service owns this process and reads the ready event over a private stdout pipe.
import fs from 'node:fs/promises';
import path from 'node:path';
import { startHost } from './server.mjs';
const root=process.env.CORILO_ANDROID_FILES;
if (!root || process.platform!=='android') throw new Error('Android entry requires the bundled Android runtime');
const vault=path.join(root,'knowledge');
await fs.mkdir(vault,{recursive:true});
// Service serializes starts. Only remove a lock whose recorded process is provably absent.
const lock=path.join(vault,'.corilo-host.lock');
const prior=await fs.readFile(lock,'utf8').catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
if(prior && /^[1-9]\d*$/.test(prior)) {
    try { process.kill(Number(prior),0); }
    catch(e) { if(e.code==='ESRCH' && await fs.readFile(lock,'utf8')===prior) await fs.unlink(lock); }
}
try {
    const host=await startHost({vault,configDir:path.join(root,'config')});
    process.stdout.write(JSON.stringify({event:'corilo-ready',url:host.url})+'\n');
    let closing=false;
    const close=async()=>{if(closing)return;closing=true;await host.close();process.exit(0);};
    process.on('SIGTERM',close);process.on('SIGINT',close);
    // The Service owns the stdin pipe. Exit if Android kills its Java process,
    // instead of leaving an unreachable host alive with the vault lock held.
    process.stdin.on('end',close);process.stdin.resume();
} catch { process.stderr.write('Corilo Android 宿主启动失败；请检查运行环境与知识库锁状态。\n');process.exitCode=1; }
