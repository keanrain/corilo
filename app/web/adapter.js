/* Files.md FileSystemHandle adapter: the host disk is the only source of truth. */
const coriloFragment = new URLSearchParams(location.hash.slice(1));
if (coriloFragment.has('token')) {
    sessionStorage.setItem('corilo-token', coriloFragment.get('token'));
    history.replaceState(null, '', location.pathname);
}
async function coriloRequest(route, options = {}) {
    const response = await fetch(route, { ...options, headers: {
        'X-Corilo-Token': sessionStorage.getItem('corilo-token') || '', ...options.headers,
    }});
    if (!response.ok) {
        const result = await response.json();
        const error = new Error(result.error); error.name = result.name || 'Error'; error.status = response.status;
        throw error;
    }
    return response;
}
async function coriloJSON(route, data) {
    return (await coriloRequest(route, data === undefined ? {} : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    })).json();
}
const coriloPath = (parent, name) => {
    if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') throw new Error('无效文件名');
    return parent ? `${parent}/${name}` : name;
};
class CoriloHandle {
    constructor(path, kind) { this.path = path; this.kind = kind; this.name = path.split('/').pop() || '知识库'; }
    async queryPermission() { return 'granted'; }
    async requestPermission() { return 'granted'; }
    async isSameEntry(other) { return this.path === other.path && this.kind === other.kind; }
    async remove(options = {}) { await coriloJSON('/api/fs/remove', { path: this.path, recursive: !!options.recursive }); }
}
class CoriloDirectory extends CoriloHandle {
    constructor(path = '') { super(path, 'directory'); }
    async child(name, kind, options = {}) {
        const path = coriloPath(this.path, name);
        const stat = options.create ? await coriloJSON('/api/fs/create', { path, kind }) : await coriloJSON(`/api/fs/stat?path=${encodeURIComponent(path)}`);
        if (stat.kind !== kind) throw new Error('文件类型不匹配');
        return kind === 'file' ? new CoriloFile(path) : new CoriloDirectory(path);
    }
    getFileHandle(name, options) { return this.child(name, 'file', options); }
    getDirectoryHandle(name, options) { return this.child(name, 'directory', options); }
    async *values() {
        for (const entry of await coriloJSON(`/api/fs/list?path=${encodeURIComponent(this.path)}`)) {
            const path = coriloPath(this.path, entry.name);
            yield entry.kind === 'file' ? new CoriloFile(path) : new CoriloDirectory(path);
        }
    }
    async *entries() { for await (const entry of this.values()) yield [entry.name, entry]; }
    [Symbol.asyncIterator]() { return this.entries(); }
    removeEntry(name, options = {}) { return coriloJSON('/api/fs/remove', { path: coriloPath(this.path, name), recursive: !!options.recursive }); }
}
class CoriloFile extends CoriloHandle {
    constructor(path) { super(path, 'file'); this.etag = null; }
    async getFile() {
        const response = await coriloRequest(`/api/fs/read?path=${encodeURIComponent(this.path)}`);
        this.etag = response.headers.get('X-Corilo-Etag');
        return new File([await response.blob()], this.name, { lastModified: Number(response.headers.get('X-Corilo-Modified')) });
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
                const result = await (await coriloRequest(`/api/fs/write?path=${encodeURIComponent(this.path)}`, {
                    method: 'PUT', headers: { 'If-Match': expected, 'Content-Type': 'application/octet-stream' }, body: bytes,
                })).json();
                this.etag = result.etag; closed = true;
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
post = async () => { throw new Error('旧 Files.md 远程接口已停用'); };
openDir = async () => showToast('当前使用 Corilo 本机知识库；目录由启动器管理');
rename = async (from, to) => coriloJSON('/api/fs/rename', { from, to });
moveFile = async (from, to) => {
    await rename(from, to);
    const old = getMemFile(from); removeMemFile(from);
    addMemFile(to, { ...old, path: to, handle: await getFileHandle(to) });
};
// Keep read/write failure visible and never delete a source after a failed move.
removeDir = async path => {
    await coriloJSON('/api/fs/remove', { path, recursive: true });
    removeMemDir(path);
};
moveDir = async (from, to) => {
    await rename(from, to); files = await loadLocalFiles(coriloRoot); await renderSidebar();
};
// Upstream writes diagnostic logs into archive/Log.txt; keep diagnostics out of the knowledge library.
log = () => {};
logf = async () => {};
logError = (...args) => console.error(...args);
