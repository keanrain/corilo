"""Exercise the real draft manager with Chromium IndexedDB, without a host/model."""
import pathlib
import shutil
import subprocess
import tempfile
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]


def main():
    with tempfile.TemporaryDirectory(prefix='corilo-draft-stash-') as temp:
        bundle = pathlib.Path(temp) / 'draft-runtime.js'
        subprocess.run(['node', '--input-type=module', '-e', '''
          import {createRequire} from 'node:module';
          const {build}=createRequire(process.argv[1]+'/package.json')('esbuild');
          await build({absWorkingDir:process.argv[1],entryPoints:['client/drafts.mjs'],outfile:process.argv[2],bundle:true,format:'iife',globalName:'DraftRuntime',platform:'browser'});
        ''', str(ROOT), str(bundle)], check=True)
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, executable_path=shutil.which('chromium') or None)
            page = browser.new_page()
            page.route('http://corilo-stash.invalid/', lambda route: route.fulfill(status=200, content_type='text/html', body='<html></html>'))
            page.goto('http://corilo-stash.invalid/')
            page.add_script_tag(content=bundle.read_text())
            result = page.evaluate('''async () => {
              const assert = (ok, message) => { if (!ok) throw Error(message); };
              const fresh = () => ({path:'',text:'',original:'',expected:null,status:'clean',error:'',latest:null});
              const dirty = text => ({...fresh(),path:'draft.md',text,status:'dirty'});
              const create = () => DraftRuntime.createDraftRecovery(async()=>({id:'stash-fixture'}));
              const settled = handle => new Promise(resolve => {
                if (handle.getSnapshot().status !== 'pending') return resolve();
                const stop = handle.subscribe(() => {
                  if (handle.getSnapshot().status !== 'pending') { stop(); resolve(); }
                });
              });
              let handle = create(); await handle.start();
              const text = '  原话\\r\\n第二行\\n';
              handle.track(dirty(text)); await settled(handle);
              const saved = await handle.stash(dirty(text));
              assert(saved.draft.text === text, 'stash preserves exact text');
              handle.track(fresh()); await settled(handle);
              assert(handle.getSnapshot().candidates.length === 1, 'fresh does not delete independent stash');
              handle.dispose();
              handle = create(); await handle.start();
              assert(handle.getSnapshot().candidates[0].id === saved.id, 'stash survives manager remount');
              assert(handle.getSnapshot().candidates[0].draft.text === text, 'preview retains all text');

              // Fail after add, before deleting the page copy. The transaction
              // must roll back the new candidate and preserve the old record.
              handle.track(dirty('failed stash text')); await settled(handle);
              const originalDelete = IDBObjectStore.prototype.delete;
              IDBObjectStore.prototype.delete = function () { throw Error('injected delete failure'); };
              let rejected = false;
              try { await handle.stash(dirty('failed stash text')); }
              catch { rejected = true; }
              finally { IDBObjectStore.prototype.delete = originalDelete; }
              assert(rejected, 'failure rejects rather than permitting editor clear');
              assert(handle.needsLeaveWarning(), 'failed stash still warns about current unsaved input');
              handle.dispose();
              handle = create(); await handle.start();
              const candidates = handle.getSnapshot().candidates;
              assert(candidates.length === 2, 'failed transaction leaves original records only');
              assert(candidates.some(r => r.draft.text === 'failed stash text'), 'current page recovery survives failure');
              assert(candidates.filter(r => r.draft.text === text).length === 1, 'existing independent stash unchanged');
              handle.dispose();

              // Disposing during asynchronous identity discovery must not open
              // a database or publish a completed startup after unmount.
              let identify;
              const closed = DraftRuntime.createDraftRecovery(()=>new Promise(resolve=>{identify=resolve;}));
              const starting = closed.start(); closed.dispose();
              identify({id:'disposed-fixture'}); await starting;
              assert(!closed.getSnapshot().ready, 'disposed startup does not publish ready');
              return {preserved:true,rollback:true,remount:true,disposed:true};
            }''')
            assert result == {'preserved': True, 'rollback': True, 'remount': True, 'disposed': True}, result
            browser.close()
    print('Chromium draft stash passed: exact text, fresh/remount recovery, atomic failure rollback, disposed startup.')


if __name__ == '__main__':
    main()
