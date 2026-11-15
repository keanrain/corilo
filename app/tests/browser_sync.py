"""Actual browser/host/Git integration with synthetic bare remotes, no GitHub credentials."""
import os
import pathlib
import shutil
import subprocess
import tempfile
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]

def git(cwd, *args):
    return subprocess.check_output(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', *args], cwd=cwd, stderr=subprocess.PIPE, text=True).strip()

def main():
    with tempfile.TemporaryDirectory(prefix='corilo-browser-sync-') as temp:
        base=pathlib.Path(temp); vault=base/'notes'; vault.mkdir()
        note=vault/'note.md'; note.write_text('base\n')
        remote=base/'remote.git'; git(base,'init','--bare','--initial-branch=main',str(remote))
        # Only this test injects local transport validation. Production accepts private GitHub HTTPS only.
        source="""
import { startHost } from './app/host/server.mjs';
import { GitSync } from './app/host/sync.mjs';
const base=process.env.CORILO_SYNC_FIXTURE;
const host=await startHost({vault:base+'/notes',configDir:base+'/config',piAgentDir:base+'/pi',syncFactory:(v,c)=>new GitSync(v,c,async(_,url)=>{if(url!==base+'/remote.git')throw new Error('fixture remote mismatch');return url;})});
console.log(host.url);
process.on('SIGTERM',async()=>{await host.close();process.exit(0);});
"""
        process=subprocess.Popen(['node','--input-type=module','-e',source],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=dict(os.environ,CORILO_SYNC_FIXTURE=temp))
        try:
            url=process.stdout.readline().strip(); assert url.startswith('http://127.0.0.1:')
            with sync_playwright() as p:
                options={'headless':True}
                if shutil.which('chromium'): options['executable_path']=shutil.which('chromium')
                browser=p.chromium.launch(**options); page=browser.new_page(); errors=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(url); page.wait_for_function('() => coriloReady')
                page.locator('#corilo-sync-toggle').click()
                # Binding errors must remain visible rather than disappear on the next poll.
                page.locator('#corilo-sync-url').fill('invalid')
                page.locator('#corilo-sync-bind').click()
                page.wait_for_function("() => !coriloSyncRequest && document.getElementById('corilo-sync-error').textContent.includes('fixture remote mismatch')")
                page.locator('#corilo-sync-url').fill(str(remote)); page.locator('#corilo-sync-bind').click()
                page.wait_for_function('() => !coriloSyncRequest && !!coriloSyncState.url')
                page.locator('#corilo-sync-run').click()
                page.wait_for_function("() => !coriloSyncRequest && coriloSyncState.phase==='synced'")
                assert git(remote,'show','main:note.md')=='base'
                other=base/'other'; git(base,'clone',str(remote),str(other))
                (other/'note.md').write_text('remote edit\n'); git(other,'add','.'); git(other,'commit','-m','remote edit'); git(other,'push','origin','main')
                page.evaluate("() => editor.setValue('# note\\nlocal edit\\n')")
                page.locator('#corilo-sync-run').click()
                page.wait_for_function("() => !coriloSyncRequest && coriloSyncState.phase==='conflict'")
                assert note.read_text()=='local edit\n'
                assert page.locator('#corilo-conflicts pre').all_text_contents()==['local edit\n','remote edit\n']
                page.locator('#corilo-conflicts select').select_option('both')
                page.locator('#corilo-sync-resolve').click()
                page.wait_for_function("() => !coriloSyncRequest && coriloSyncState.phase==='synced'")
                assert note.read_text()=='local edit\n'
                assert next(vault.glob('note.remote-*.md')).read_text()=='remote edit\n'
                assert git(remote,'show','main:note.md')=='local edit'
                # Foreground idle polling pulls a new remote file without pressing Sync.
                git(other,'pull','--ff-only','origin','main')
                (other/'foreground.md').write_text('automatic pull')
                git(other,'add','.'); git(other,'commit','-m','foreground update'); git(other,'push','origin','main')
                remote_head=git(other,'rev-parse','HEAD')
                page.bring_to_front()
                page.evaluate('() => { coriloSyncDue=0; coriloLastInteraction=Date.now()-4000; }')
                page.wait_for_function('(head) => !coriloSyncRequest && coriloSyncState.lastSuccess?.commit===head',arg=remote_head)
                assert (vault/'foreground.md').read_text()=='automatic pull'
                assert page.evaluate("() => !!getMemFile('/foreground.md')")
                page.locator('#corilo-sync-unbind').click()
                page.wait_for_function("() => !coriloSyncRequest && coriloSyncState.phase==='unbound'")
                assert note.exists() and remote.exists()
                assert not errors,errors
                browser.close()
                print('Browser Git sync passed: bind/error feedback, push, conflict previews, preserve both, foreground automatic pull, unbind; no real GitHub/model calls')
        finally:
            process.terminate()
            try: process.wait(timeout=15)
            except subprocess.TimeoutExpired: process.kill(); process.wait()
            if process.returncode not in (0,-15): print(process.stderr.read())

if __name__=='__main__': main()
