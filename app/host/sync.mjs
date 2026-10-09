import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fault } from './vault.mjs';

// Never return subprocess output: credential helpers and Git errors can contain secrets.
export function git(cwd, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c','user.name=Corilo','-c','user.email=local@corilo.invalid','-c','commit.gpgsign=false','-c','core.autocrlf=false','-c','core.hooksPath=/dev/null', ...args], {
      cwd, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }, stdio: ['pipe','pipe','pipe'],
    });
    const chunks = []; let size = 0;
    const timer = setTimeout(() => child.kill(), 60000);
    child.stdout.on('data', b => { size += b.length; if (size > 32 * 1024 * 1024) child.kill(); else chunks.push(b); });
    child.stderr.resume(); child.stdin.on('error', () => {});
    child.on('error', () => { clearTimeout(timer); reject(fault(503, '无法启动 Git')); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(Buffer.concat(chunks)) : reject(fault(409, 'Git 操作失败；本机内容已保留。请检查网络、仓库权限及 Git 状态后重试')); });
    child.stdin.end(input);
  });
}
const text = async (cwd, args) => (await git(cwd, args)).toString().trim();
export async function verifyGitHub(cwd, url) {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(url);
  if (!match || ['.','..'].includes(match[2])) throw fault(400, '请输入 https://github.com/用户名/私有仓库.git 地址');
  const repository = `${match[1]}/${match[2]}`;
  let credential;
  try { credential = (await git(cwd, ['credential','fill'], `protocol=https\nhost=github.com\npath=${repository}.git\n\n`)).toString(); }
  catch { throw fault(401, '请先使用本机 Git 凭据管理器登录 GitHub，并授权目标知识库仓库'); }
  const token = credential.split('\n').find(line => line.startsWith('password='))?.slice(9);
  if (!token) throw fault(401, '请先使用本机 Git 凭据管理器登录 GitHub');
  const response = await fetch(`https://api.github.com/repos/${repository}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!response.ok) throw fault(403, '无法核对 GitHub 仓库；请检查本机 Git 凭据的仓库访问权限');
  const data = await response.json();
  if (!data.private || !data.permissions?.push || data.full_name.toLowerCase() !== repository.toLowerCase()) throw fault(403, '同步需要有写入权限的私有 GitHub 仓库');
  return `https://github.com/${repository}.git`;
}

export class GitSync {
  constructor(vault, configDir, verify = verifyGitHub) {
    this.vault = vault; this.verify = verify;
    this.dir = path.join(configDir, 'sync', createHash('sha256').update(vault.root).digest('hex'));
    this.connection = null; this.pending = null; this.phase = 'unbound'; this.error = '';
  }
  async init() {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    try { this.connection = JSON.parse(await fs.readFile(path.join(this.dir,'connection.json'), 'utf8')); this.phase = 'pending'; }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    // A crashed merge is disposable. Fetch and recompute against current HEAD on retry.
    for (const name of await fs.readdir(this.dir)) if (name.startsWith('merge-')) await fs.rm(path.join(this.dir,name), { recursive:true, force:true });
  }
  state() { return { ...this.connection, phase: this.phase, error: this.error, conflictId: this.pending?.id, conflicts: this.pending?.files ?? [] }; }
  async persist() {
    const file = path.join(this.dir, 'connection.json');
    await fs.writeFile(file+'.tmp', JSON.stringify(this.connection), { mode:0o600 }); await fs.rename(file+'.tmp', file);
  }
  async guard() {
    if (this.connection && await text(this.vault.root, ['symbolic-ref','--short','HEAD']) !== this.connection.localBranch) throw fault(409, '本机分支已切换，请切回绑定时的分支');
    for (const name of ['MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','rebase-merge','rebase-apply','BISECT_LOG']) {
      if (await fs.lstat(path.join(this.vault.root,'.git',name)).catch(() => null)) throw fault(409, '存在未完成的 Git 操作，请先处理');
    }
  }
  async bind(url, branch = 'main') {
    if (this.connection) throw fault(409, '请先解绑当前仓库');
    if (typeof branch !== 'string' || branch.startsWith('-')) throw fault(400, '分支名称无效');
    await git(this.vault.root, ['check-ref-format', `refs/heads/${branch}`]);
    await this.guard();
    const safeUrl = await this.verify(this.vault.root, url);
    const remote = (await text(this.vault.root, ['ls-remote','--heads', safeUrl, `refs/heads/${branch}`])).split(/\s/)[0];
    const localBranch = await text(this.vault.root,['symbolic-ref','--short','HEAD']);
    if (remote) {
      await git(this.vault.root,['fetch','--no-tags',safeUrl,`refs/heads/${branch}`]);
      try { await git(this.vault.root,['merge-base','HEAD','FETCH_HEAD']); }
      catch { throw fault(409, '本机与远端没有共同历史；请将远端克隆到新的目录后打开，不能直接混合两个知识库'); }
    }
    this.connection = { url:safeUrl, branch, localBranch, lastSuccess:null };
    try { await this.persist(); } catch(e) { this.connection=null; throw e; }
    this.phase = 'pending'; return this.state();
  }
  async clearPending() { if (this.pending) await fs.rm(this.pending.dir,{recursive:true,force:true}); this.pending = null; }
  async unbind() { await this.clearPending(); await fs.rm(path.join(this.dir,'connection.json'),{force:true}); this.connection=null; this.phase='unbound'; this.error=''; return this.state(); }
  async validateTree(cwd, ref) {
    const raw = await git(cwd,['ls-tree','-r','-z',ref]);
    if (!Buffer.from(raw.toString()).equals(raw)) throw fault(409, '远端包含非 UTF-8 文件名，无法跨平台同步');
    const entries = raw.toString().split('\0').filter(Boolean);
    const seen = new Map();
    for (const entry of entries) {
      const tab=entry.indexOf('\t'), meta=entry.slice(0,tab), filename=entry.slice(tab+1);
      if (!/^100(644|755) blob /.test(meta)) throw fault(409, `同步不支持链接或子模块：${filename}`);
      const parts = filename.split('/'); let current='';
      for (const part of parts) {
        if (/[<>:"\\|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part) || part.toLowerCase() === '.git' || part.startsWith('.corilo-')) throw fault(409, `无法跨平台同步文件名：${filename}`);
        current += '/'+part; const key=current.normalize('NFC').toLowerCase();
        if (seen.has(key) && seen.get(key)!==current) throw fault(409, `文件名大小写或 Unicode 冲突：${filename}`);
        seen.set(key,current);
      }
    }
  }
  async conflictFiles(dir) {
    const stages = new Map();
    for (const row of (await git(dir,['ls-files','-u','-z'])).toString().split('\0').filter(Boolean)) {
      const tab=row.indexOf('\t'), [mode,oid,stage]=row.slice(0,tab).split(' '), name=row.slice(tab+1);
      if (!stages.has(name)) stages.set(name,{});
      stages.get(name)[stage]={mode,oid};
    }
    const files=[];
    for (const [name, versions] of stages) {
      const read = async stage => {
        if (!versions[stage]) return null;
        const bytes = await git(dir,['cat-file','blob',versions[stage].oid]);
        const binary = bytes.includes(0) || bytes.length>256*1024 || !Buffer.from(bytes.toString()).equals(bytes);
        return { binary, size:bytes.length, text:binary ? null : bytes.toString(), ...versions[stage] };
      };
      files.push({ path:name, local:await read(2), remote:await read(3) });
    }
    return files;
  }
  async apply(dir, local) {
    if (await text(this.vault.root,['rev-parse','HEAD'])!==local || await text(this.vault.root,['status','--porcelain'])) throw fault(409, '合并期间本机文件发生变化；请重新同步');
    await this.guard();
    await this.validateTree(dir,'HEAD');
    await git(this.vault.root,['fetch','--no-tags',dir,'HEAD']);
    await git(this.vault.root,['merge','--ff-only','FETCH_HEAD']);
  }
  async run(resolution) {
    if (!this.connection) throw fault(409,'尚未连接 GitHub');
    this.error=''; this.phase='syncing';
    let scratch;
    try {
      await this.guard();
      if (resolution) {
        const p=this.pending;
        if (!p || resolution.id!==p.id) throw fault(409,'冲突已过期，请重新同步');
        if (await text(this.vault.root,['rev-parse','HEAD'])!==p.local || await text(this.vault.root,['status','--porcelain'])) throw fault(409,'冲突出现后本机内容已变化，请重新同步');
        // Validate every choice before mutating the scratch index, so failed requests are retryable.
        for (const file of p.files) {
          const choice=resolution.choices?.[file.path];
          if (!choice || !['local','remote','both','manual'].includes(choice.kind) || (choice.kind==='manual' && (typeof choice.text!=='string' || file.local?.binary || file.remote?.binary))) throw fault(400,'请为每个冲突选择处理方式');
        }
        for (const file of p.files) {
          const choice=resolution.choices[file.path], target=path.join(p.dir,file.path);
          await fs.rm(target,{force:true,recursive:true}); await fs.mkdir(path.dirname(target),{recursive:true});
          const write = async (version,dest) => { if (version) { await fs.writeFile(dest,await git(p.dir,['cat-file','blob',version.oid]),{flag:'wx'}); await fs.chmod(dest,version.mode==='100755'?0o755:0o644); } };
          if (choice.kind==='manual') await fs.writeFile(target,choice.text);
          else await write(choice.kind==='remote'?file.remote:file.local,target);
          if (choice.kind==='both' && file.remote) {
            const ext=path.extname(target), other=target.slice(0,target.length-ext.length)+`.remote-${randomUUID().slice(0,8)}`+ext;
            await write(file.remote,other);
            // A user's ignore pattern must not silently discard the requested second copy.
            await git(p.dir,['add','--force','--',path.relative(p.dir,other)]);
          }
        }
        await git(p.dir,['add','--all']); await git(p.dir,['commit','-m','Corilo: resolve sync conflicts']);
        await this.apply(p.dir,p.local); await this.clearPending();
      } else await this.clearPending();
      // A rejected push gets one fresh merge attempt. No force push, ever.
      for (let attempt=0; attempt<2; attempt++) {
        await this.guard();
        const local=await this.vault.checkpoint('Corilo: before sync');
        await this.validateTree(this.vault.root,'HEAD');
        const {url,branch}=this.connection;
        const remote=(await text(this.vault.root,['ls-remote','--heads',url,`refs/heads/${branch}`])).split(/\s/)[0];
        if (remote) {
          await git(this.vault.root,['fetch','--no-tags',url,`refs/heads/${branch}`]);
          const fetched=await text(this.vault.root,['rev-parse','FETCH_HEAD']);
          await this.validateTree(this.vault.root,fetched);
          try { await git(this.vault.root,['merge-base',local,fetched]); }
          catch { throw fault(409,'远端历史已改变，无法安全合并；本机内容保留'); }
          scratch=await fs.mkdtemp(path.join(this.dir,'merge-'));
          await git(this.dir,['clone','--no-hardlinks','--no-checkout',this.vault.root,scratch]);
          await git(scratch,['checkout','--detach',local]);
          // FETCH_HEAD is not guaranteed reachable from a branch in the source clone.
          await git(scratch,['fetch','--no-tags',this.vault.root,fetched]);
          try { await git(scratch,['merge','--no-edit',fetched]); }
          catch (e) {
            const files=await this.conflictFiles(scratch);
            if (!files.length) throw e;
            this.pending={id:randomUUID(),dir:scratch,local,files}; scratch=null; this.phase='conflict'; return this.state();
          }
          await this.apply(scratch,local);
          await fs.rm(scratch,{recursive:true,force:true}); scratch=null;
        }
        await this.guard();
        const head=await text(this.vault.root,['rev-parse','HEAD']);
        try { await git(this.vault.root,['push',url,`${head}:refs/heads/${branch}`]); }
        catch(e) { if(attempt===0) continue; throw e; }
        this.connection.lastSuccess={commit:head,time:new Date().toISOString()}; await this.persist();
        this.phase=(await text(this.vault.root,['status','--porcelain'])) ? 'pending' : 'synced'; return this.state();
      }
    } catch(e) { this.phase='error'; this.error=e.message; throw e; }
    finally { if(scratch) await fs.rm(scratch,{recursive:true,force:true}); }
  }
}
