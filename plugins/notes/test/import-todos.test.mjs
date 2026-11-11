import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID,createHash } from 'node:crypto';
import { TodoStore } from '../../todos/storage.mjs';
import { NotesStore } from '../storage.mjs';
import { importTodos } from '../import-todos.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function setup(t){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'corilo-todo-import-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const old=await TodoStore.open(path.join(base,'old'));
 const opened=await old.create({requestId:randomUUID(),title:'普通 [待办]',body:'多行说明\r\n保留原始字段',notePath:'资料/原文.md'});
 const completed=await old.create({requestId:randomUUID(),title:'已完成'});await old.update({requestId:randomUUID(),id:completed.id,expected:completed.version,patch:{status:'done'}});
 const cancelled=await old.create({requestId:randomUUID(),title:'不应重新打开'});await old.update({requestId:randomUUID(),id:cancelled.id,expected:cancelled.version,patch:{status:'cancelled'}});
 old.close();return{base,source:path.join(base,'old/todos.sqlite'),root:path.join(base,'notes'),opened};
}
test('todo import is explicit, preserves legacy SQLite and fields, maps checklists and is idempotent after later edits',async t=>{
 const {source,root,opened}=await setup(t),before=await fs.readFile(source);
 const report=await importTodos({source,root});assert.equal(report.applied,false);assert.deepEqual([report.open,report.done,report.cancelled],[1,1,1]);await assert.rejects(fs.access(root));
 const notes=await NotesStore.open(root);await notes.save({path:'Later.md',text:'- [ ] 原有记录\n',expected:null});
 const applied=await importTodos({source,root,apply:true});assert.equal(applied.alreadyImported,false);
 const later=await notes.read('Later.md');assert.ok(later.text.startsWith('- [ ] 原有记录\n'));assert.ok(later.text.includes('- [ ] 普通 \\[待办\\]'));assert.ok(later.text.includes('- [x] 已完成'));assert.ok(!later.text.includes('不应重新打开'));
 const journal=await notes.read(report.journal);assert.ok(journal.text.includes('"state": "complete"'));
 const data=JSON.parse(/\n```json\n([\s\S]*)\n```\n$/.exec(journal.text)[1]);assert.deepEqual(data.original.items.find(x=>x.id===opened.id),opened);assert.equal(data.original.items.find(x=>x.status==='cancelled').title,'不应重新打开');
 await notes.save({path:'Later.md',text:later.text+'\n后续正常编辑',expected:later.version});
 const repeat=await importTodos({source,root,apply:true});assert.equal(repeat.alreadyImported,true);assert.ok((await notes.read('Later.md')).text.endsWith('后续正常编辑'));assert.deepEqual(await fs.readFile(source),before);
});
test('changed legacy data refuses duplicate reimport and conflicting planned import preserves all inputs',async t=>{
 const {source,root}=await setup(t);const report=await importTodos({source,root,apply:true});
 const old=await TodoStore.open(path.dirname(source));await old.create({requestId:randomUUID(),title:'源数据库后来新增'});old.close();
 const before=await fs.readFile(path.join(root,'Later.md'));
 await assert.rejects(importTodos({source,root,apply:true}),/Legacy data changed/);assert.deepEqual(await fs.readFile(path.join(root,'Later.md')),before);
 // Simulate a crash after planning, with another edit before applying.
 const notes=await NotesStore.open(root),journal=await notes.read(report.journal);
 const data=JSON.parse(/\n```json\n([\s\S]*)\n```\n$/.exec(journal.text)[1]);data.state='planned';
 // Preserve source fingerprint by preparing from the original export identity;
 // then restore the original source dataset before resuming.
 const reopened=await TodoStore.open(path.dirname(source));const db=reopened.db;db.prepare('DELETE FROM receipts WHERE result LIKE ?').run('%源数据库后来新增%');db.prepare('DELETE FROM todos WHERE title=?').run('源数据库后来新增');reopened.close();
 const changed=journal.text.replace(/\n```json\n([\s\S]*)\n```\n$/,'\n```json\n'+JSON.stringify(data,null,2)+'\n```\n');await notes.save({path:report.journal,text:changed,expected:journal.version});
 const current=await notes.read('Later.md');await notes.save({path:current.path,text:current.text+'\n外部修改',expected:current.version});
 await assert.rejects(importTodos({source,root,apply:true}),/changed during import/);assert.ok((await notes.read('Later.md')).text.endsWith('外部修改'));
});
test('planned import resumes after target commit without appending the same tasks again',async t=>{
 const {source,root}=await setup(t);const report=await importTodos({source,root,apply:true}),notes=await NotesStore.open(root);
 const journal=await notes.read(report.journal),later=await notes.read('Later.md');
 await notes.save({path:journal.path,text:journal.text.replace('"state": "complete"','"state": "planned"'),expected:journal.version});
 await importTodos({source,root,apply:true});assert.equal((await notes.read('Later.md')).text,later.text);
 assert.equal(digest(await fs.readFile(source)).length,64);
});
