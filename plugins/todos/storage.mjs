import path from 'node:path';
import * as fs from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';

const FORMAT = 1;
const APPLICATION = 0x434f5444;
const MAX_EXPORT = 8 * 1024 * 1024;
const DB_FILES = new Set(['todos.sqlite', 'todos.sqlite-wal', 'todos.sqlite-shm']);
const STATUSES = new Set(['open', 'done', 'cancelled']);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const fail = (status, message) => Object.assign(new Error(message), { status });
const overlap = (a, b) => a === b || b.startsWith(a.endsWith(path.sep) ? a : a + path.sep);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const checkSignal = signal => signal?.throwIfAborted();
const schema = [
  `CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK(id = 1), identity TEXT NOT NULL) STRICT`,
  `CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, note_path TEXT, status TEXT NOT NULL CHECK(status IN ('open','done','cancelled')), version INTEGER NOT NULL CHECK(version > 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT`,
  `CREATE TABLE receipts (request_id TEXT PRIMARY KEY, digest TEXT NOT NULL, result TEXT NOT NULL) STRICT`,
  `CREATE INDEX todos_order ON todos(created_at DESC, id ASC)`,
  `CREATE INDEX todos_status_order ON todos(status, created_at DESC, id ASC)`,
];
const expectedSchema = [...schema].sort().join('\n');

function object(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw fail(400, '待办请求格式无效');
}
function title(value) {
  if (typeof value !== 'string' || !value.isWellFormed() || value.trim().length === 0 || [...value.trim()].length > 200 || value.includes('\0')) throw fail(400, '待办标题需为 1–200 个字符');
  return value.trim();
}
function body(value) {
  if (typeof value !== 'string' || !value.isWellFormed() || [...value].length > 20000 || value.includes('\0')) throw fail(400, '待办详情不能超过 20000 个字符');
  return value;
}
function notePath(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.isWellFormed() || Buffer.byteLength(value) > 1024 || !/\.(md|markdown)$/i.test(value) || value.includes('\\') || value.includes('\0') || /[\u0000-\u001f\u007f]/.test(value) || path.posix.isAbsolute(value) || value.split('/').some(part => !part || part.startsWith('.') || part === '..') || /^[a-z]:/i.test(value)) throw fail(400, '关联笔记需为安全的相对 Markdown 路径');
  return value;
}
function id(value) { if (!uuid(value)) throw fail(400, '待办标识无效'); return value.toLowerCase(); }
function requestId(value) { if (!uuid(value)) throw fail(400, '请求标识需为 UUID'); return value.toLowerCase(); }
function patch(value) {
  object(value, ['title', 'body', 'notePath', 'status']);
  if (!Object.keys(value).length) throw fail(400, '请提供要修改的待办字段');
  const result = {};
  if (Object.hasOwn(value, 'title')) result.title = title(value.title);
  if (Object.hasOwn(value, 'body')) result.body = body(value.body);
  if (Object.hasOwn(value, 'notePath')) result.notePath = notePath(value.notePath);
  if (Object.hasOwn(value, 'status')) {
    if (!STATUSES.has(value.status)) throw fail(400, '待办状态无效');
    result.status = value.status;
  }
  return result;
}
function todo(row) {
  return { id: row.id, title: row.title, body: row.body, notePath: row.note_path, status: row.status, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at };
}
async function directory(input, create = false) {
  if (typeof input !== 'string' || !path.isAbsolute(input) || input.includes('\0')) throw fail(400, '待办目录需为绝对路径');
  const root = path.resolve(input);
  if (root === path.parse(root).root) throw fail(400, '不能使用文件系统根目录保存待办');
  let current = path.parse(root).root;
  for (const part of root.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    let stat = await fs.lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat && create) { await fs.mkdir(current, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; }); stat = await fs.lstat(current); }
    if (!stat) continue;
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(current) !== current) throw fail(400, '待办目录不支持链接或非目录路径');
  }
  return root;
}
async function files(root) {
  await directory(root);
  for (const name of await fs.readdir(root)) {
    if (!DB_FILES.has(name)) throw fail(400, '待办目录含有其他文件，请使用独立目录');
    const stat = await fs.lstat(path.join(root, name));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw fail(400, '待办数据库不支持链接或特殊文件');
  }
}
function validateDatabase(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  const app = db.prepare('PRAGMA application_id').get().application_id;
  const actual = db.prepare("SELECT sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY sql").all().map(row => row.sql).sort().join('\n');
  if (version !== FORMAT || app !== APPLICATION || actual !== expectedSchema) throw fail(400, '待办数据库格式未知，请保留原文件并使用兼容版本');
  const metadata = db.prepare('SELECT id, identity FROM metadata').all();
  if (metadata.length !== 1 || metadata[0].id !== 1 || !uuid(metadata[0].identity)) throw fail(400, '待办数据库身份无效');
  if (db.prepare('PRAGMA quick_check(1)').get().quick_check !== 'ok') throw fail(400, '待办数据库校验失败，请保留原文件');
  return metadata[0].identity;
}
function sqliteFailure(error) {
  if (error.status || error.name === 'AbortError') return error;
  return fail(503, '待办数据库暂不可用，请核对后重试');
}

// SQLite provides persistence, locking and atomic transactions. This is a local
// personal database, not a sandbox for default shell tools or external writers.
export class TodoStore {
  static async open(input, { notesRoot } = {}) {
    let db;
    try {
      const root = await directory(input);
      if (notesRoot !== undefined) {
        const notes = await directory(notesRoot);
        if (overlap(root, notes) || overlap(notes, root)) throw fail(400, '待办数据库与笔记目录必须分开且不能互相包含');
      }
      await directory(root, true);
      await files(root);
      const filename = path.join(root, 'todos.sqlite');
      const exists = await fs.lstat(filename).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
      if (exists) {
        const inspect = new DatabaseSync(filename, { readOnly: true, enableDoubleQuotedStringLiterals: false });
        try { validateDatabase(inspect); } finally { inspect.close(); }
      } else {
        // Exclusive creation prevents accidentally adopting a concurrent creator
        // or truncating a pre-existing, unrecognised database.
        if ((await fs.readdir(root)).length) throw fail(400, '待办目录缺少主数据库，请保留现有文件');
        const handle = await fs.open(filename, 'wx', 0o600);
        await handle.close();
      }
      db = new DatabaseSync(filename, { enableDoubleQuotedStringLiterals: false });
      db.exec('PRAGMA busy_timeout=2000; PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      if (!exists) {
        db.exec('BEGIN IMMEDIATE');
        try {
          for (const statement of schema) db.exec(statement);
          db.prepare('INSERT INTO metadata VALUES (1, ?)').run(randomUUID());
          db.exec(`PRAGMA user_version=${FORMAT}; PRAGMA application_id=${APPLICATION}; COMMIT;`);
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      }
      const identity = validateDatabase(db);
      await files(root);
      const stat = await fs.lstat(filename);
      return new TodoStore(root, db, identity, { dev: stat.dev, ino: stat.ino });
    } catch (error) { db?.close(); throw sqliteFailure(error); }
  }
  constructor(root, db, identity, fileIdentity) { this.root = root; this.db = db; this.identity = identity; this.fileIdentity = fileIdentity; }
  close() { this.db?.close(); this.db = null; }
  async check() {
    if (!this.db) throw fail(503, '待办数据库已关闭');
    await files(this.root);
    const stat = await fs.lstat(path.join(this.root, 'todos.sqlite'));
    if (stat.dev !== this.fileIdentity.dev || stat.ino !== this.fileIdentity.ino || this.db.prepare('SELECT identity FROM metadata WHERE id=1').get()?.identity !== this.identity) throw fail(503, '待办数据库已改变，请重新加载服务');
  }
  transaction(operation, signal) {
    checkSignal(signal);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      checkSignal(signal);
      const result = operation();
      checkSignal(signal);
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  receipt(request, hash, operation) {
    const receipt = this.db.prepare('SELECT digest, result FROM receipts WHERE request_id=?').get(request);
    if (receipt) {
      if (receipt.digest !== hash) throw fail(409, '请求标识已用于其他操作，请核对结果后使用新标识');
      return JSON.parse(receipt.result);
    }
    const result = operation();
    this.db.prepare('INSERT INTO receipts VALUES (?, ?, ?)').run(request, hash, JSON.stringify(result));
    return result;
  }
  async get(input) {
    input = id(input);
    try {
      await this.check();
      const row = this.db.prepare('SELECT * FROM todos WHERE id=?').get(input);
      if (!row) throw fail(404, '待办不存在');
      return todo(row);
    } catch (error) { throw sqliteFailure(error); }
  }
  async create(args) {
    object(args, ['requestId', 'title', 'body', 'notePath', 'signal'], ['requestId', 'title']);
    const normalized = { title: title(args.title), body: body(args.body === undefined ? '' : args.body), notePath: notePath(args.notePath ?? null) };
    const request = requestId(args.requestId), hash = digest({ kind: 'create', ...normalized });
    try {
      await this.check();
      return this.transaction(() => this.receipt(request, hash, () => {
        const identifier = randomUUID(), now = new Date().toISOString();
        this.db.prepare("INSERT INTO todos VALUES (?, ?, ?, ?, 'open', 1, ?, ?)").run(identifier, normalized.title, normalized.body, normalized.notePath, now, now);
        return todo(this.db.prepare('SELECT * FROM todos WHERE id=?').get(identifier));
      }), args.signal);
    } catch (error) { throw sqliteFailure(error); }
  }
  async update(args) {
    object(args, ['requestId', 'id', 'expected', 'patch', 'signal', 'activeOnly'], ['requestId', 'id', 'expected', 'patch']);
    if (args.activeOnly !== undefined && typeof args.activeOnly !== 'boolean') throw fail(400, '待办请求格式无效');
    const identifier = id(args.id), request = requestId(args.requestId), changes = patch(args.patch);
    if (!Number.isSafeInteger(args.expected) || args.expected < 1) throw fail(400, '请提供读取时的待办版本');
    const hash = digest({ kind: 'update', id: identifier, expected: args.expected, patch: changes });
    try {
      await this.check();
      return this.transaction(() => this.receipt(request, hash, () => {
        const row = this.db.prepare('SELECT * FROM todos WHERE id=?').get(identifier);
        if (!row) throw fail(404, '待办不存在');
        if (args.activeOnly && row.status === 'cancelled') throw fail(404, '待办不在当前清单中');
        if (row.version !== args.expected) throw fail(409, '待办已有更新，请读取最新内容后核对；当前输入未覆盖');
        const next = { ...todo(row), ...changes, version: row.version + 1, updatedAt: new Date().toISOString() };
        this.db.prepare('UPDATE todos SET title=?, body=?, note_path=?, status=?, version=?, updated_at=? WHERE id=? AND version=?')
          .run(next.title, next.body, next.notePath, next.status, next.version, next.updatedAt, identifier, args.expected);
        return next;
      }), args.signal);
    } catch (error) { throw sqliteFailure(error); }
  }
  async list(options = {}) {
    object(options, ['status', 'cursor', 'query', 'signal', 'activeOnly']);
    const { status = 'open', cursor = null, query = '', signal, activeOnly = false } = options;
    if (typeof activeOnly !== 'boolean') throw fail(400, '待办列表条件无效');
    if (!STATUSES.has(status) && status !== 'all' || typeof query !== 'string' || !query.isWellFormed() || [...query].length > 256 || query.includes('\0') || cursor !== null && (typeof cursor !== 'string' || cursor.length > 1024)) throw fail(400, '待办列表条件无效');
    let anchor = null;
    const filter = digest({ identity: this.identity, status, query, ...(activeOnly ? { activeOnly: true } : {}) });
    if (cursor !== null) {
      try {
        anchor = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (anchor.format !== 1 || anchor.filter !== filter || !uuid(anchor.id) || typeof anchor.at !== 'string' || new Date(anchor.at).toISOString() !== anchor.at || Object.keys(anchor).sort().join() !== 'at,filter,format,id') throw new Error();
      } catch { throw fail(400, '待办列表游标无效或筛选条件已改变'); }
    }
    try {
      checkSignal(signal); await this.check(); checkSignal(signal);
      const rows = this.db.prepare(`SELECT * FROM todos WHERE (?='all' OR status=?) AND (?=0 OR status<>'cancelled') AND (?='' OR instr(lower(title || char(10) || body),lower(?))>0)
        AND (? IS NULL OR created_at < ? OR (created_at = ? AND id > ?)) ORDER BY created_at DESC, id ASC LIMIT 101`)
        .all(status, status, activeOnly ? 1 : 0, query, query, anchor?.at ?? null, anchor?.at ?? null, anchor?.at ?? null, anchor?.id ?? null);
      const hasMore = rows.length > 100, items = rows.slice(0, 100).map(todo), last = items.at(-1);
      return { items, hasMore, nextCursor: hasMore ? Buffer.from(JSON.stringify({ format: 1, filter, at: last.createdAt, id: last.id })).toString('base64url') : null };
    } catch (error) { throw sqliteFailure(error); }
  }
  async export(options = {}) {
    object(options, ['signal']);
    const { signal } = options;
    try {
      checkSignal(signal); await this.check(); checkSignal(signal);
      this.db.exec('BEGIN');
      try {
        const count = this.db.prepare('SELECT count(*) AS count FROM todos').get().count;
        if (count > 10000) throw fail(413, '待办导出超过 10000 项，请保留数据库并分批处理');
        const items = [], exportedAt = new Date().toISOString();
        let bytes = 100;
        for (const row of this.db.prepare('SELECT * FROM todos ORDER BY created_at DESC, id ASC').iterate()) {
          checkSignal(signal);
          const item = todo(row); bytes += Buffer.byteLength(JSON.stringify(item)) + 1;
          if (bytes > MAX_EXPORT) throw fail(413, '待办导出超过 8 MiB，请保留数据库并分批处理');
          items.push(item);
        }
        checkSignal(signal); this.db.exec('COMMIT');
        return { format: 'corilo-todos-v1', exportedAt, items };
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    } catch (error) { throw sqliteFailure(error); }
  }
}
