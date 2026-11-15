import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { rgPath } from '@vscode/ripgrep';

export const libraryLimits = Object.freeze({ pageSize: 100, maxEntries: 20_000, maxDepth: 20, searchBytes: 64 * 1024 * 1024, timeoutMs: 10_000, results: 100 });
const fail = (status, message) => Object.assign(new Error(message), { status });
const compare = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
const queryValue = value => {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 256 || /[\0\n\r]/.test(value)) throw fail(400, '搜索词需为单行文字，最多 256 字节');
  return value;
};
function budget(signal) {
  const deadline = Date.now() + libraryLimits.timeoutMs;
  return () => {
    if (signal?.aborted) throw fail(409, '操作已取消');
    if (Date.now() >= deadline) throw fail(413, '笔记扫描超时，请缩小知识库或直接打开路径');
    return Math.max(1, deadline - Date.now());
  };
}

// Call through the store queue. No body reads, hashes, persistent index or cache.
async function metadata(store, check) {
  const items = []; let entries = 0;
  if (await fs.realpath(store.root) !== store.root || !(await fs.lstat(store.root)).isDirectory()) throw fail(400, '笔记目录不支持链接');
  const walk = async (directory, relative = '', depth = 0) => {
    check();
    if (depth > libraryLimits.maxDepth) throw fail(413, '笔记目录超过深度限制');
    // Confirm every parent before traversal, just as the regular file service does.
    if (await fs.realpath(directory) !== directory || !(await fs.lstat(directory)).isDirectory()) throw fail(400, '笔记目录不支持链接');
    for await (const entry of await fs.opendir(directory)) {
      check();
      if (++entries > libraryLimits.maxEntries) throw fail(413, '笔记目录超过 20000 条扫描限制，请直接打开路径');
      if (entry.name.startsWith('.')) continue;
      const input = relative ? `${relative}/${entry.name}` : entry.name;
      const filename = path.join(directory, entry.name), stat = await fs.lstat(filename);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || (stat.isFile() && stat.nlink !== 1)) throw fail(400, '笔记目录不支持链接或特殊文件');
      if (stat.isDirectory()) await walk(filename, input, depth + 1);
      else if (/\.(md|markdown)$/i.test(entry.name)) { store.parts(input); items.push({ path: input, size: stat.size }); }
    }
  };
  await walk(store.root);
  return items.sort(compare);
}

export async function listPage(store, { cursor = null, query = '', signal } = {}) {
  query = queryValue(query).toLowerCase();
  if (cursor !== null) store.parts(cursor);
  const items = (await metadata(store, budget(signal))).filter(item => (cursor === null || item.path > cursor) && item.path.toLowerCase().includes(query));
  const page = items.slice(0, libraryLimits.pageSize), hasMore = items.length > page.length;
  return { items: page, hasMore, nextCursor: hasMore ? page.at(-1).path : null };
}

function runSearch(input, query, signal, check) {
  const remaining = check();
  return new Promise((resolve, reject) => {
    // Only stdin is searched. ripgrep never opens paths from the knowledge base.
    // Consume the rest of each matching line, and replace the match with an
    // empty string. rg then emits only line:column:, once per matching line.
    // Escaping preserves literal queries without expanding a common character
    // into thousands of JSON submatches or copying whole paragraphs back.
    const literal = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const child = spawn(rgPath, ['--no-config', '--line-number', '--column', '--only-matching', '--replace', '', '--no-filename', '--color', 'never', '--ignore-case', '--text', '--max-count', String(libraryLimits.results + 1), '-e', `${literal}.*`, '--', '-'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let bytes = 0, output = '', settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) { child.kill(); reject(error); } else resolve(value);
    };
    const abort = () => finish(fail(409, '操作已取消'));
    const timer = setTimeout(() => finish(fail(413, '全文搜索超时，请缩小知识库')), remaining);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.on('error', () => finish(fail(503, '全文搜索暂不可用，请检查 ripgrep 平台依赖')));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', data => {
      bytes += Buffer.byteLength(data);
      if (bytes > 64 * 1024) return finish(fail(413, '搜索位置结果超过读取限制'));
      output += data.toString('utf8');
    });
    child.stderr.resume();
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') finish(fail(503, '全文搜索暂不可用')); });
    child.on('close', code => {
      if (code !== 0 && code !== 1) return finish(fail(503, '全文搜索暂不可用'));
      try {
        const matches = output.split('\n').filter(Boolean).map(line => {
          const match = /^([1-9][0-9]*):([1-9][0-9]*):$/.exec(line);
          if (!match) throw new Error('Invalid search position');
          const line_number = Number(match[1]), column = Number(match[2]);
          if (!Number.isSafeInteger(line_number) || !Number.isSafeInteger(column)) throw new Error('Invalid search position');
          return { line_number, column };
        });
        if (matches.length > libraryLimits.results + 1) throw new Error('Too many search positions');
        finish(null, matches);
      }
      catch { finish(fail(503, '全文搜索结果无效')); }
    });
    child.stdin.end(input);
  });
}

export async function searchNotes(store, { query, signal } = {}) {
  query = queryValue(query);
  if (!query.trim()) throw fail(400, '请输入搜索词');
  const check = budget(signal), files = await metadata(store, check);
  let total = 0;
  for (const file of files) {
    if (file.size > store.limits.maxBytes) throw fail(413, '笔记超过大小限制，请直接打开路径检查');
    total += file.size + 1;
    if (total > libraryLimits.searchBytes) throw fail(413, '全文搜索超过 64 MiB 扫描限制，请缩小知识库');
  }
  // Safety-reviewed reads preserve strict UTF-8 and reject links, races and oversized files.
  const chunks = [], ranges = []; let firstLine = 1, actualBytes = 0;
  for (const file of files) {
    check();
    const { text } = await store.readFile(await store.location(file.path));
    actualBytes += Buffer.byteLength(text) + 1;
    if (actualBytes > libraryLimits.searchBytes) throw fail(413, '全文搜索超过 64 MiB 扫描限制，请缩小知识库');
    const lines = text.split('\n').length;
    ranges.push({ path: file.path, text, first: firstLine, end: firstLine + lines });
    firstLine += lines;
    chunks.push(text, '\n');
  }
  check();
  const items = files.filter(file => file.path.toLowerCase().includes(query.toLowerCase())).map(file => ({ path: file.path, line: null, text: file.path, kind: 'filename' }));
  const matches = await runSearch(chunks.join(''), query, signal, check);
  let rangeIndex = 0, sourceLines;
  for (const match of matches) {
    const previousIndex = rangeIndex;
    while (ranges[rangeIndex] && match.line_number >= ranges[rangeIndex].end) rangeIndex++;
    const range = ranges[rangeIndex];
    if (!range) throw fail(503, '全文搜索结果无效');
    if (!sourceLines || previousIndex !== rangeIndex) sourceLines = range.text.split('\n');
    const line = Buffer.from(sourceLines[match.line_number - range.first] || '', 'utf8');
    const offset = match.column - 1;
    const prefix = line.subarray(0, offset).toString('utf8');
    const source = line.toString('utf8').replace(/[\r\n]+$/, '');
    const start = Math.max(0, prefix.length - 70);
    items.push({ path: range.path, line: match.line_number - range.first + 1, text: `${start ? '…' : ''}${source.slice(start, start + 240)}${source.length > start + 240 ? '…' : ''}`, kind: 'content' });
  }
  return { items: items.slice(0, libraryLimits.results), truncated: items.length > libraryLimits.results };
}
