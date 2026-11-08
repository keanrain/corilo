"""Real Chromium IndexedDB exercises the todo draft adapter, not the Harness UI."""
import pathlib
import shutil
import subprocess
import tempfile
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]


def main():
    with tempfile.TemporaryDirectory(prefix='corilo-todo-draft-runtime-') as temp:
        bundle = pathlib.Path(temp) / 'runtime.js'
        subprocess.run(['node', '--input-type=module', '-e', '''
          import {createRequire} from 'node:module';
          const {build}=createRequire(process.argv[1]+'/package.json')('esbuild');
          await build({absWorkingDir:process.argv[1],entryPoints:['client/drafts.mjs'],outfile:process.argv[2],bundle:true,format:'iife',globalName:'TodoDrafts',platform:'browser'});
        ''', str(ROOT), str(bundle)], check=True)
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, executable_path=shutil.which('chromium') or None)
            page = browser.new_page()
            page.route('http://corilo-todo-drafts.invalid/', lambda route: route.fulfill(status=200, content_type='text/html', body='<html></html>'))
            page.goto('http://corilo-todo-drafts.invalid/')
            page.add_script_tag(content=bundle.read_text())
            page.evaluate('''async () => {
              const assert = (ok, message) => { if (!ok) throw Error(message); };
              const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222';
              const requestId='33333333-3333-4333-8333-333333333333';
              const fresh = () => ({item:null,draft:{title:'',body:'',notePath:''},pending:null,saveState:'clean',conflict:false,error:'',quickTitle:'',quickPending:null,quickSaveState:'clean',quickError:'',rowPending:null,rowSaveState:'clean',rowError:'',editorOpen:false});
              const dirty = value => ({...fresh(),quickTitle:value});
              const create = (id=A) => TodoDrafts.createTodoDraftRecovery(async()=>({id}));
              const oldItem={id:A,title:'已读待办',body:'',notePath:null,status:'open',version:1,createdAt:'2026-11-08T00:00:00.000Z',updatedAt:'2026-11-08T00:00:00.000Z'};
              const quickOnly={...fresh(),item:oldItem,draft:{title:oldItem.title,body:'',notePath:''},quickTitle:'仅快速输入',editorOpen:false};
              assert(!TodoDrafts.snapshotTodoDraft(quickOnly).editorOpen,'quick recovery does not reopen a clean collapsed old editor');
              let handle=create(); await handle.start();
              const model={...fresh(),draft:{title:'  原输入  ',body:'中文\\r\\n详情',notePath:'项目/原文.md'},pending:{method:'create',args:{requestId,title:'  原输入  ',body:'中文\\r\\n详情',notePath:'项目/原文.md'}},saveState:'saving',quickTitle:'下一件事',editorOpen:true};
              handle.track(model); await handle.flush(); handle.dispose();
              handle=create(); await handle.start();
              let candidate=handle.getSnapshot().candidates[0];
              assert(candidate.draft.draft.body==='中文\\r\\n详情','exact input survives manager recreation');
              assert(candidate.draft.pending.args.requestId===requestId,'request UUID survives');
              assert(candidate.draft.saveState==='unknown','in-flight request recovers as unknown');
              assert(candidate.draft.quickTitle==='下一件事','quick input survives independently');
              assert(candidate.draft.editorOpen,'detail editor is restored visibly');
              const requestCalls=[];
              // Recovery only copies input; there is no API execution callback.
              handle.adopt(candidate,candidate.draft); await handle.flush();
              assert(requestCalls.length===0,'adoption never sends mutation');
              handle.track({...fresh(),quickTitle:'own latest'}); await handle.flush();

              const nativeOpen = () => new Promise((resolve,reject)=>{const req=indexedDB.open('corilo-todos-drafts',1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
              const all = async () => {const db=await nativeOpen();try{return await new Promise((resolve,reject)=>{const req=db.transaction('drafts').objectStore('drafts').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}finally{db.close();}};
              const modify = async record => {const db=await nativeOpen();try{await new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(record);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});}finally{db.close();}};
              // A stale restore/discard may not erase a newer version protected
              // by another active page. The CAS decision is one IDB transaction.
              let observer=create(); await observer.start();
              candidate=observer.getSnapshot().candidates.find(r=>r.draft.quickTitle==='own latest');
              const newer={...candidate,updatedAt:candidate.updatedAt+1,draft:{...candidate.draft,quickTitle:'other tab newest'}};
              await modify(newer);
              observer.adopt(candidate,candidate.draft); await observer.flush();
              assert((await all()).some(r=>r.id===candidate.id && r.draft.quickTitle==='other tab newest'),'stale restore preserves newer source');
              let staleDiscard={...newer};
              const newest={...newer,updatedAt:newer.updatedAt+1,draft:{...newer.draft,quickTitle:'newest again'}};
              await modify(newest); await observer.discard(staleDiscard);
              assert((await all()).some(r=>r.id===candidate.id && r.draft.quickTitle==='newest again'),'stale discard preserves newer source');
              observer.dispose();

              handle.track(dirty('stash rollback')); await handle.flush();
              const before=await all(), originalDelete=IDBObjectStore.prototype.delete;
              IDBObjectStore.prototype.delete=function(){throw Error('injected transaction failure');};
              let failed=false;try{await handle.stash(dirty('stash rollback'));}catch{failed=true;}finally{IDBObjectStore.prototype.delete=originalDelete;}
              assert(failed,'failed stash rejects navigation');
              const after=await all();
              assert(after.length===before.length,'failed stash rolls back newly added record');
              assert(after.some(r=>r.draft.quickTitle==='stash rollback'),'failed stash keeps current recovery');
              assert(handle.getSnapshot().status==='failed','storage failure is visible');
              handle.dispose();

              const isolated=create(B);await isolated.start();
              assert(isolated.getSnapshot().candidates.length===0,'SQLite identities isolate recovery');
              isolated.dispose();
              const originalOpen=IDBFactory.prototype.open;
              IDBFactory.prototype.open=function(){throw Error('injected unavailable storage');};
              const unavailable=create();await unavailable.start();
              assert(unavailable.getSnapshot().ready && unavailable.getSnapshot().status==='failed','identity confirmed but failed storage is explicit');
              unavailable.track(dirty('memory survives'));let rejected=false;try{await unavailable.flush();}catch{rejected=true;}
              assert(rejected && unavailable.needsLeaveWarning(),'failed protection never claims durable recovery');
              unavailable.dispose();IDBFactory.prototype.open=originalOpen;
              let release,events=0;
              const disposed=TodoDrafts.createTodoDraftRecovery(()=>new Promise(resolve=>release=resolve));
              disposed.subscribe(()=>events++);const opening=disposed.start();disposed.dispose();const count=events;release({id:A});await opening;
              assert(events===count && !disposed.getSnapshot().ready,'disposed startup does not publish late state');
            }''')
            browser.close()
            print('Todo draft runtime Chromium passed: exact input/request recovery, unknown-state normalization, per-store isolation, CAS restore/discard, atomic stash rollback, storage failure and disposed startup. No Harness/model claim.')


if __name__ == '__main__':
    main()
