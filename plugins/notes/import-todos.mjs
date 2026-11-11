#!/usr/bin/env node
// Explicit, restartable one-way import. The source database is opened read-only;
// the old package, records, cancellation fields, associations and receipts stay.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { NotesStore } from './storage.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error(message); };
const uuid = value => typeof value==='string'&&/^[a-f0-9-]{36}$/i.test(value);
async function readSource(source) {
 if(typeof source!=='string'||!path.isAbsolute(source)||await fs.realpath(source)!==path.resolve(source))fail('Source must be an absolute ordinary SQLite file without links.');
 const stat=await fs.lstat(source);if(!stat.isFile()||stat.nlink!==1||stat.size>128*1024*1024)fail('Source must be a regular SQLite file at most 128 MiB.');
 for(const suffix of ['-wal','-shm']){const entry=await fs.lstat(source+suffix).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(entry&&(!entry.isFile()||entry.nlink!==1))fail('SQLite sidecars cannot be links or special files.');}
 const db=new DatabaseSync(source,{readOnly:true,enableDoubleQuotedStringLiterals:false});
 try{
  db.exec('PRAGMA trusted_schema=OFF; BEGIN');
  if(db.prepare('PRAGMA application_id').get().application_id!==0x434f5444||db.prepare('PRAGMA user_version').get().user_version!==1)fail('Unsupported Corilo todo database.');
  const objects=db.prepare("SELECT name,type FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
  if(JSON.stringify(objects)!==JSON.stringify([{name:'metadata',type:'table'},{name:'receipts',type:'table'},{name:'todos',type:'table'},{name:'todos_order',type:'index'},{name:'todos_status_order',type:'index'}]))fail('Unexpected SQLite objects; source is not modified.');
  const identity=db.prepare('SELECT identity FROM metadata WHERE id=1').get()?.identity;if(!uuid(identity))fail('Invalid todo database identity.');
  const items=[];let bytes=64;
  for(const row of db.prepare('SELECT id,title,body,note_path,status,version,created_at,updated_at FROM todos ORDER BY created_at DESC,id ASC LIMIT 10001').iterate()){
   if(items.length>=10000)fail('Import exceeds 10000 records.');
   const item={id:row.id,title:row.title,body:row.body,notePath:row.note_path,status:row.status,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at};
   if(!uuid(item.id)||typeof item.title!=='string'||!item.title.isWellFormed()||item.title.length>800||typeof item.body!=='string'||!item.body.isWellFormed()||item.body.length>80000||!['open','done','cancelled'].includes(item.status)||!Number.isSafeInteger(item.version)||item.version<1||item.notePath!==null&&typeof item.notePath!=='string')fail('Invalid legacy record; source is not modified.');
   bytes+=Buffer.byteLength(JSON.stringify(item))+1;if(bytes>8*1024*1024)fail('Import exceeds 8 MiB.');items.push(item);
  }
  const result={format:'corilo-todos-v1',items};
  db.exec('COMMIT');return {identity,...result};
 }finally{db.close();}
}
const escape = value => value.replace(/[\\`*_{}\[\]<>#|]/g,'\\$&').replace(/[\r\n]+/g,' ');
function checklist(items) {
 return items.filter(item=>item.status!=='cancelled').map(item=>{
  const lines=[`- [${item.status==='done'?'x':' '}] ${escape(item.title)} <!-- corilo-todo:${item.id} -->`];
  if(item.body)lines.push(...item.body.split(/\r\n?|\n/).map(line=>'    '+line));
  if(item.notePath)lines.push('    原有关联：'+escape(item.notePath));
  return lines.join('\n');
 }).join('\n');
}
const encode = plan => '# 旧待办迁移记录\n\n此文件用于防重复导入和恢复核对。已取消记录及所有原字段保留在下面的原始数据中，不作为待办重新打开。\n\n```json\n'+JSON.stringify(plan,null,2)+'\n```\n';
function decode(text){const match=/\n```json\n([\s\S]*)\n```\n$/.exec(text);if(!match)fail('Import journal format is invalid; preserve it for review.');return JSON.parse(match[1]);}
export async function importTodos({source,root,apply=false}) {
 if(typeof root!=='string'||!path.isAbsolute(root))fail('Notes root must be absolute.');
 const data=await readSource(source), fingerprint=hash(JSON.stringify(data));
 const journalPath=`archive/Todo import ${data.identity}.md`;
 const report={format:'corilo-todo-import-v1',identity:data.identity,sourceFingerprint:fingerprint,target:'Later.md',journal:journalPath,open:data.items.filter(x=>x.status==='open').length,done:data.items.filter(x=>x.status==='done').length,cancelled:data.items.filter(x=>x.status==='cancelled').length};
 // Dry-run reads an existing directory only; it never initializes a destination.
 if(!apply)return {...report,applied:false};
 const sourcePath=path.resolve(source),destination=path.resolve(root);
 if(sourcePath===destination||sourcePath.startsWith(destination+path.sep)||destination.startsWith(path.dirname(sourcePath)+path.sep))fail('Legacy database and notes root must be separate.');
 const store=await NotesStore.open(destination);
 const read=filename=>store.read(filename).catch(error=>{if(error.status===404)return null;throw error;});
 let journal=await read(journalPath),plan;
 if(journal){
  plan=decode(journal.text);
  if(plan.identity!==data.identity||plan.sourceFingerprint!==fingerprint||plan.target!=='Later.md'||!['planned','complete'].includes(plan.state)||typeof plan.text!=='string'||hash(Buffer.from(plan.text))!==plan.after||plan.before!==null&&!/^[a-f0-9]{64}$/.test(plan.before)||hash(JSON.stringify(plan.original))!==fingerprint)fail('Legacy data changed or journal is invalid. Review the existing import instead of importing duplicates.');
  if(plan.state==='complete')return {...report,applied:true,alreadyImported:true};
 }else{
  const current=await read('Later.md'),items=checklist(data.items);
  const text=(current?.text||'')+(items?(current?.text&&!current.text.endsWith('\n')?'\n':'')+'\n'+items+'\n':'');
  plan={...report,state:'planned',before:current?.version??null,after:hash(Buffer.from(text)),text,original:data};
  if(Buffer.byteLength(text)>store.limits.maxBytes||Buffer.byteLength(encode(plan))>store.limits.maxBytes)fail('Import output or journal exceeds 1 MiB. Split the source export before importing; nothing was written.');
  journal=await store.save({path:journalPath,text:encode(plan),expected:null});
 }
 const current=await read('Later.md');
 if((current?.version??null)!==plan.after){
  if((current?.version??null)!==plan.before)fail('Later.md changed during import. Inputs and journal are preserved; review before continuing.');
  await store.save({path:'Later.md',text:plan.text,expected:plan.before});
 }
 await store.save({path:journalPath,text:encode({...plan,state:'complete'}),expected:journal.version});
 return {...report,applied:true,alreadyImported:false};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const args=process.argv.slice(2),options={};
 try{
  for(let n=0;n<args.length;n++){const key=args[n];if(key==='--apply'){if(options.apply)fail('Duplicate --apply');options.apply=true;}else if(['--source','--root'].includes(key)&&args[n+1]&&!Object.hasOwn(options,key.slice(2))){options[key.slice(2)]=args[++n];}else fail('Usage: corilo-import-todos --source /absolute/todos.sqlite --root /absolute/notes [--apply]');}
  if(!options.source||!options.root)fail('Usage: corilo-import-todos --source /absolute/todos.sqlite --root /absolute/notes [--apply]');
  console.log(JSON.stringify(await importTodos(options),null,2));
 }catch(error){process.stderr.write('Corilo import: '+error.message+'\n');process.exitCode=1;}
}
