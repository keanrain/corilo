import http from 'node:http';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const number = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

export class DockerEngine {
  constructor(socketPath = '/var/run/docker.sock') { this.socketPath = socketPath; }
  request(method, route, data) {
    return new Promise((resolve, reject) => {
      const req = http.request({ socketPath: this.socketPath, path: '/v1.45'+route, method,
        headers: data === undefined ? {} : { 'Content-Type': 'application/json' } }, res => {
        let size = 0; const chunks = [];
        res.on('data', chunk => { size += chunk.length; if (size > 1024*1024) res.destroy(new Error('Docker response too large')); else chunks.push(chunk); });
        res.on('error', reject);
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString(); let body;
          try { body = text ? JSON.parse(text) : null; } catch { return reject(new Error('Invalid Docker response')); }
          if (res.statusCode >= 400) return reject(Object.assign(new Error('Docker operation failed'), { status: res.statusCode }));
          resolve(body);
        });
      });
      req.on('error', reject);
      req.setTimeout(30000, () => req.destroy(new Error('Docker outcome unknown')));
      req.end(data === undefined ? undefined : JSON.stringify(data));
    });
  }
}

// Control-plane only. One instance owns this private journal root. There is no
// arbitrary-command/network/mount API; requests originate in the trusted run store.
export class DockerWorkers {
  constructor({ engine = new DockerEngine(), image, dataRoot, journalRoot, uid, gid, memoryMiB, cpuMillis, pids, tmpMiB }) {
    if (!/^(sha256:[a-f0-9]{64}|[^\s]+@sha256:[a-f0-9]{64})$/.test(image || '')) throw new Error('Immutable worker image required');
    for (const [value,min,max] of [[uid,1,2147483647],[gid,1,2147483647],[memoryMiB,128,65536],[cpuMillis,100,64000],[pids,8,4096],[tmpMiB,1,1024]])
      if (!number(value,min,max)) throw new Error('Explicit worker resource limits required');
    Object.assign(this,{engine,image,dataRoot:path.resolve(dataRoot),journalRoot:path.resolve(journalRoot),uid,gid,memoryMiB,cpuMillis,pids,tmpMiB});
    this.queues = new Map();
  }
  serial(id, fn) {
    if (!uuid(id)) throw new Error('Invalid run ID');
    const next = (this.queues.get(id) || Promise.resolve()).then(fn);
    const settled = next.catch(() => {});
    this.queues.set(id, settled);
    void settled.then(() => { if (this.queues.get(id) === settled) this.queues.delete(id); });
    return next;
  }
  async directory(...parts) {
    const target = path.join(this.dataRoot, ...parts);
    // Root must be canonical, and no descendant supplied by a user may be a link.
    if (await fs.realpath(this.dataRoot) !== this.dataRoot || await fs.realpath(target) !== target || !(await fs.lstat(target)).isDirectory())
      throw new Error('Unsafe worker mount');
    return target;
  }
  async journal(id) { return JSON.parse(await fs.readFile(path.join(this.journalRoot,id,'journal.json'),'utf8')); }
  async save(id, value) {
    const dir = path.join(this.journalRoot,id), temp = path.join(dir,randomUUID()+'.tmp');
    const handle = await fs.open(temp,'wx',0o600);
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temp,path.join(dir,'journal.json'));
    const directory=await fs.open(dir,'r'); try { await directory.sync(); } finally { await directory.close(); }
  }
  async inspect(journal) {
    try {
      const result = await this.engine.request('GET','/containers/'+encodeURIComponent(journal.containerId || journal.name)+'/json');
      if (result.Config.Labels?.['corilo.run'] !== journal.runId || result.Config.Labels?.['corilo.controller'] !== journal.controller)
        throw new Error('Worker ownership mismatch');
      return result;
    } catch (e) { if (e.status === 404) return null; throw e; }
  }
  async start(claim, mayStart, modelBinding) {
    return this.serial(claim.id, async () => {
      if (![claim.vaultId,claim.conversationId].every(uuid) || typeof claim.prompt !== 'string' || Buffer.byteLength(claim.prompt)>65536)
        throw new Error('Invalid claimed run');
      const dir = path.join(this.journalRoot,claim.id);
      // Existing journals are recovery work, never a reason to replay this run.
      await fs.mkdir(dir,{recursive:false,mode:0o700});
      const controller = this.journalRoot;
      const record = { runId:claim.id, controller, name:'corilo-run-'+claim.id, phase:'prepared' };
      await this.save(claim.id,record);
      const knowledge = await this.directory(claim.vaultId,'knowledge');
      const git = await this.directory(claim.vaultId,'knowledge','.git');
      const locks = ['.corilo-host.lock','.corilo-host.flock'];
      for(const name of locks) {
        const file=path.join(knowledge,name), stat=await fs.lstat(file);
        if(!stat.isFile() || stat.nlink!==1)throw new Error('Unsafe host lock mount');
      }
      const state = await this.directory(claim.vaultId,'state','conversations',claim.conversationId);
      const pi = await this.directory(claim.vaultId,'pi');
      for(const mount of [knowledge,state,pi]) {
        if(this.journalRoot===mount || this.journalRoot.startsWith(mount+path.sep) || mount.startsWith(this.journalRoot+path.sep))throw new Error('Worker and controller state must be separate');
      }
      let model, socketPath, settingsPath;
      if(modelBinding!==undefined) {
        const candidate=modelBinding;
        if(!candidate || typeof candidate.model!=='string' || !/^[A-Za-z0-9._-]{1,128}$/.test(candidate.model) ||
          typeof candidate.token!=='string' || !/^[a-f0-9]{64}$/.test(candidate.token) || !number(candidate.maxTokens,1,1000000) ||
          typeof candidate.socketPath!=='string' || !path.isAbsolute(candidate.socketPath) || path.basename(candidate.socketPath)!=='m.sock' ||
          path.basename(path.dirname(candidate.socketPath))!==claim.id)throw new Error('Invalid run model binding');
        socketPath=candidate.socketPath;
        const socket=await fs.lstat(socketPath), parent=await fs.lstat(path.dirname(socketPath));
        if(await fs.realpath(socketPath)!==socketPath || !socket.isSocket() || socket.uid!==this.uid || (socket.mode&0o077)!==0 ||
          !parent.isDirectory() || parent.uid!==process.getuid() || (parent.mode&0o077)!==0)throw new Error('Unsafe model socket mount');
        for(const mount of [knowledge,state,pi]) {
          if(socketPath.startsWith(mount+path.sep))throw new Error('Model socket must be outside worker data');
        }
        model={model:candidate.model,token:candidate.token,maxTokens:candidate.maxTokens};
        // Expose only behavior settings, never unrelated auth/models/extensions.
        const settings=path.join(pi,'settings.json');
        const info=await fs.lstat(settings).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
        if(info) {
          if(!info.isFile() || info.nlink!==1 || info.size>65536)throw new Error('Unsafe Pi settings mount');
          settingsPath=settings;
        }
      }
      const request = path.join(dir,'request.json');
      await fs.writeFile(request,JSON.stringify({prompt:claim.prompt,...(model?{model}:{})}),{flag:'wx',mode:0o400});
      const owner=await fs.stat(request);
      if(owner.uid!==this.uid || owner.gid!==this.gid)await fs.chown(request,this.uid,this.gid);
      if (await mayStart() !== true) { await this.save(claim.id,{...record,phase:'stopped'}); return null; }
      const bind = (Source,Target,ReadOnly=false) => ({Type:'bind',Source,Target,ReadOnly,BindOptions:{Propagation:'rprivate'}});
      const spec = { Image:this.image, User:`${this.uid}:${this.gid}`, WorkingDir:'/knowledge',
        Env:['HOME=/tmp','PI_CODING_AGENT_DIR=/pi','NODE_ENV=production'],
        Labels:{'corilo.run':claim.id,'corilo.controller':controller},
        HostConfig:{ NetworkMode:'none',ReadonlyRootfs:true,CapDrop:['ALL'],SecurityOpt:['no-new-privileges:true'],
          Memory:this.memoryMiB*1024*1024,MemorySwap:this.memoryMiB*1024*1024,CpuPeriod:100000,CpuQuota:this.cpuMillis*100,
          PidsLimit:this.pids,RestartPolicy:{Name:'no'},LogConfig:{Type:'none'},
          Tmpfs:{'/tmp':`rw,noexec,nosuid,nodev,size=${this.tmpMiB}m,uid=${this.uid},gid=${this.gid}`},
          Mounts:[bind(knowledge,'/knowledge'),bind(git,'/knowledge/.git',true),
            ...locks.map(name=>bind(path.join(knowledge,name),'/knowledge/'+name,true)),
            bind(state,'/state'),
            ...(model ? [...(settingsPath?[bind(settingsPath,'/pi/settings.json',true)]:[]),bind(socketPath,'/run/corilo/model.sock',true)] : [bind(pi,'/pi',true)]),
            bind(request,'/run/corilo/request.json',true)] } };
      // Persist intent before issuing create. A transport failure is NOT proof that
      // Docker did not create a container; stop/recovery must reconcile the journal.
      await this.save(claim.id,{...record,phase:'creating'});
      const created = await this.engine.request('POST','/containers/create?name='+record.name,spec);
      const known = {...record,containerId:created.Id,phase:'created'};
      await this.save(claim.id,known);
      if (await mayStart() !== true) return null; // stop() will remove the never-started container.
      await this.save(claim.id,{...known,phase:'starting'});
      await this.engine.request('POST','/containers/'+created.Id+'/start');
      await this.save(claim.id,{...known,phase:'running'});
      return created.Id;
    });
  }
  async status(id) {
    return this.serial(id,async()=> {
      const journal=await this.journal(id), container=await this.inspect(journal);
      return { phase:journal.phase, present:!!container, running:container?.State.Running === true,
        exitCode:container?.State.ExitCode, oomKilled:container?.State.OOMKilled === true };
    });
  }
  async stop(id) {
    return this.serial(id,async()=> {
      let journal;
      try { journal=await this.journal(id); } catch(e) {
        if(e.code!=='ENOENT')throw e;
        // Even runs stopped before create need a journal: a terminal DB commit
        // can precede a crash before the host gate is released.
        await fs.mkdir(path.join(this.journalRoot,id),{recursive:true,mode:0o700});
        await this.save(id,{runId:id,controller:this.journalRoot,name:'corilo-run-'+id,phase:'removed'});
        return true;
      }
      const container=await this.inspect(journal);
      if (!container) {
        if (!['prepared','stopped','removed'].includes(journal.phase) && !journal.containerId) return false;
        // A known deleted ID cannot later be started; an unknown create may still arrive.
        await this.save(id,{...journal,phase:'removed'});
        await fs.rm(path.join(this.journalRoot,id,'request.json'),{force:true}); return true;
      }
      await this.save(id,{...journal,containerId:container.Id,phase:'removing'});
      await this.engine.request('DELETE','/containers/'+container.Id+'?force=1');
      if (await this.inspect({...journal,containerId:container.Id})) return false;
      await this.save(id,{...journal,containerId:container.Id,phase:'removed'});
      await fs.rm(path.join(this.journalRoot,id,'request.json'),{force:true}); return true;
    });
  }
}
