/* Files.md FileSystemHandle adapter: the host disk is the only source of truth. */
let coriloWorkspaceId, coriloUnknownWrite = null;
async function coriloJSON(route, data) {
    const url = new URL(route, location.origin);
    const method = url.pathname.split('/').pop();
    const args = { method, ...(data || { path: url.searchParams.get('path') || '' }) };
    if(args.method==='write'&&coriloUnknownWrite?.request.path===args.path)throw coriloUnknownWrite;
    let result;
    try {
        const response = await fetch('fs', { method:'POST', credentials:'same-origin', headers:{'content-type':'application/json','x-corilo-workspace-id':coriloWorkspaceId}, body:JSON.stringify(args) });
        if(!response.ok) throw new Error('Transport failure');
        result=await response.json();
        if(!result||typeof result.ok!=='boolean'||result.ok&&!Object.hasOwn(result,'value')||!result.ok&&!result.error)throw new Error('Invalid response');
    } catch { const error=Object.assign(new Error('连接失败，结果可能未知，当前输入仍保留，请核对文件'),{unknown:true,status:503,request:args});if(args.method==='write')coriloUnknownWrite=error;throw error; }
    if(!result.ok){const error=Object.assign(new Error(result.error.message),{status:result.error.status,unknown:result.error.status===503,name:result.error.status===404?'NotFoundError':'Error',request:args});if(error.unknown&&args.method==='write')coriloUnknownWrite=error;throw error;}
    return result.value;
}
const coriloEncode = bytes => { let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary); };
const coriloDecode = value => Uint8Array.from(atob(value), char=>char.charCodeAt(0));
const coriloPath = (parent, name) => {
    if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') throw new Error('无效文件名');
    return parent ? `${parent}/${name}` : name;
};
// Retain versions from displayed listings/reads; never refresh a version just to delete/move.
const coriloVersions = new Map();
const coriloKey = path => path.replace(/^\/+/, '');
function coriloExpected(path) {
    const key = coriloKey(path);
    // An open editor owns the version actually displayed, even if a background listing is newer.
    for (const cm of [editor, editor2]) {
        if (cm?.path && coriloKey(cm.path) === key && cm.coriloFileHandle?.etag) return cm.coriloFileHandle.etag;
    }
    return coriloVersions.get(key);
}
const coriloRemove = async (path, recursive = false) => coriloJSON('/api/fs/remove', { path, recursive, expected: coriloExpected(path) || (await coriloJSON('/api/fs/version', {path})).version });
class CoriloHandle {
    constructor(path, kind) { this.path = path; this.kind = kind; this.name = path.split('/').pop() || '知识库'; }
    async queryPermission() { return 'granted'; }
    async requestPermission() { return 'granted'; }
    async isSameEntry(other) { return this.path === other.path && this.kind === other.kind; }
    async remove(options = {}) { await coriloRemove(this.path, !!options.recursive); }
}
class CoriloDirectory extends CoriloHandle {
    constructor(path = '') { super(path, 'directory'); }
    async child(name, kind, options = {}) {
        const path = coriloPath(this.path, name);
        const stat = options.create ? await coriloJSON('/api/fs/create', { path, kind }) : await coriloJSON(`/api/fs/stat?path=${encodeURIComponent(path)}`);
        if (stat.version && !coriloVersions.has(coriloKey(path))) coriloVersions.set(coriloKey(path), stat.version);
        if (stat.kind !== kind) throw new Error('文件类型不匹配');
        return kind === 'file' ? new CoriloFile(path) : new CoriloDirectory(path);
    }
    getFileHandle(name, options) { return this.child(name, 'file', options); }
    getDirectoryHandle(name, options) { return this.child(name, 'directory', options); }
    async *values() {
        for (const entry of await coriloJSON(`/api/fs/list?path=${encodeURIComponent(this.path)}`)) {
            const path = coriloPath(this.path, entry.name);
            coriloVersions.set(coriloKey(path), entry.version);
            yield entry.kind === 'file' ? new CoriloFile(path) : new CoriloDirectory(path);
        }
    }
    async *entries() { for await (const entry of this.values()) yield [entry.name, entry]; }
    [Symbol.asyncIterator]() { return this.entries(); }
    removeEntry(name, options = {}) { return coriloRemove(coriloPath(this.path, name), !!options.recursive); }
}
class CoriloFile extends CoriloHandle {
    constructor(path) { super(path, 'file'); this.etag = null; }
    async getFile() {
        const result = await coriloJSON('/api/fs/read?path='+encodeURIComponent(this.path));
        this.etag = result.etag; coriloVersions.set(coriloKey(this.path),this.etag);
        return new File([coriloDecode(result.data)], this.name, {lastModified:result.lastModified});
    }
    async createWritable({ keepExistingData = false } = {}) {
        let bytes = new Uint8Array();
        if (keepExistingData || !this.etag) {
            const file = await this.getFile();
            if (keepExistingData) bytes = new Uint8Array(await file.arrayBuffer());
        }
        const expected = this.etag; let offset = 0, closed = false;
        return {
            seek: async n => { offset = n; },
            write: async value => {
                if (closed) throw new Error('写入已关闭');
                if (value && typeof value === 'object' && value.type === 'write') {
                    if (value.position !== undefined) offset = value.position;
                    value = value.data;
                }
                const next = new Uint8Array(await new Blob([value]).arrayBuffer());
                const merged = new Uint8Array(Math.max(bytes.length, offset + next.length));
                merged.set(bytes); merged.set(next, offset); bytes = merged; offset += next.length;
            },
            close: async () => {
                if (closed) return;
                const result = await coriloJSON('/api/fs/write', {path:this.path,data:coriloEncode(bytes),expected});
                this.etag = result.etag; coriloVersions.set(coriloKey(this.path), result.etag); closed = true;
            },
            abort: async () => { closed = true; },
        };
    }
}
const coriloRoot = new CoriloDirectory();
getRootDirHandle = async () => coriloRoot;
getSavedRootDirHandle = async () => coriloRoot;
// The upstream HTTP sync protocol is intentionally not used by this application.
hasLastServerOk = () => false;
syncFilesWithServer = async () => {};
syncLocalFileWithServer = async () => {};
syncMediaFiles = async () => {};
post = async () => { throw new Error('请使用工作区上方的 Agent 入口操作资料；外部机器人服务未连接'); };
openDir = async () => showToast('当前使用 Corilo 本机知识库；目录由启动器管理');
rename = async (from, to) => {
    const expected = coriloExpected(from) || (await coriloJSON('/api/fs/version', {path:from})).version;
    const result = await coriloJSON('/api/fs/rename', { from, to, expected });
    coriloVersions.delete(coriloKey(from)); coriloVersions.set(coriloKey(to), expected);
    return result;
};
moveFile = async (from, to) => {
    await syncCurrentFile();
    await rename(from, to); // Host rename refuses to overwrite an existing target.
    const old = getMemFile(from); removeMemFile(from);
    addMemFile(to, { ...old, path: to, handle: await getFileHandle(to) });
    for (const cm of [editor, editor2]) {
        if (cm?.path !== from) continue;
        cm.path = to;
        if (cm.coriloFileHandle) { cm.coriloFileHandle.path = to; cm.coriloFileHandle.name = toFilename(to); }
        if (toFilename(from) !== toFilename(to)) {
            const content = cm.getValue();
            cm.setValue(toHeader(toFilename(to)) + content.slice(content.indexOf('\n')));
            cm.markClean();
        }
    }
};
moveCurrentFile = async toDir => {
    const from = currentEditor.path, to = joinPath('/', toDir, toFilename(from));
    if (from === to) return;
    await moveFile(from, to); await renderSidebar();
};
removeCurrentFile = async () => {
    await syncCurrentFile();
    const from = currentEditor.path;
    if (!from) return;
    if (toDirPath(from) === '/archive') await remove(from);
    else {
        await createDir('/archive');
        await moveFile(from, joinPath('/archive', toFilename(from)));
    }
    await coriloReload();
};
// Keep read/write failure visible and never delete a source after a failed move.
removeDir = async path => {
    await syncCurrentFile();
    await coriloRemove(path, true);
    removeMemDir(path); await coriloReload();
};
moveDir = async (from, to) => {
    await syncCurrentFile(); await rename(from, to);
    for (const cm of [editor, editor2]) {
        if (cm?.path?.startsWith(from + '/')) {
            cm.path = to + cm.path.slice(from.length);
            if (cm.coriloFileHandle) cm.coriloFileHandle.path = cm.path;
        }
    }
    await coriloReload();
};
// Upstream writes diagnostic logs into archive/Log.txt; keep diagnostics out of the knowledge library.
log = () => {};
logf = async () => {};
logError = (...args) => console.error(...args);
