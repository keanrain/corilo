"""Regression checks for integration paths missed by the initial smoke test."""
import os
import pathlib
import subprocess
import tempfile
import shutil
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]

def main():
    with tempfile.TemporaryDirectory(prefix='corilo-review-') as temp:
        root = pathlib.Path(temp); vault = root/'notes'; vault.mkdir()
        (vault/'source.md').write_text('source content')
        (vault/'target').mkdir(); (vault/'target/source.md').write_text('keep target')
        (vault/'split.md').write_text('original')
        env = dict(os.environ, PI_CODING_AGENT_DIR=str(root/'pi'))
        child = subprocess.Popen(['node','app/host/cli.mjs','--no-open','--vault',str(vault),'--config',str(root/'config')],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
        try:
            child.stdout.readline(); url=child.stdout.readline().strip()
            assert url.startswith('http://127.0.0.1:'),child.stderr.read()
            with sync_playwright() as p:
                options={'headless':True}
                if shutil.which('chromium'):options['executable_path']=shutil.which('chromium')
                browser=p.chromium.launch(**options); page=browser.new_page()
                page.goto(url); page.wait_for_function('() => coriloReady')
                page.evaluate('() => clearInterval(window.saver)')
                failures=[]
                page.evaluate("() => openFile('/source.md')")
                page.evaluate("async () => { try { await moveCurrentFile('/target'); } catch(e) {} }")
                if not (vault/'source.md').exists() or (vault/'target/source.md').read_text()!='keep target':
                    failures.append('moving current file overwrote the existing target')
                # Destructive actions must use displayed versions, not fresh stat tokens.
                (vault/'source.md').write_text('new remote content')
                for action in ["remove('/source.md')", "rename('/source.md','/renamed.md')"]:
                    status=page.evaluate("async action => { try { await eval(action); return 200; } catch(e) { return e.status; } }",action)
                    assert status==409, 'A stale browser deleted/moved a newer file'
                assert (vault/'source.md').read_text()=='new remote content'
                (vault/'target/new.md').write_text('new child')
                status=page.evaluate("async () => { try { await removeDir('/target'); return 200; } catch(e) { return e.status; } }")
                assert status==409 and (vault/'target/new.md').exists(), 'A stale directory deletion lost a new child'
                page.evaluate('() => coriloReload()')
                page.evaluate("async () => { await moveDir('/target','/renamed-target'); await removeDir('/renamed-target'); }")
                assert not (vault/'renamed-target').exists()
                page.evaluate("async () => { await openFile('/source.md'); await moveFile('/source.md','/moved.md'); await remove('/moved.md'); }")
                assert not (vault/'source.md').exists() and not (vault/'moved.md').exists()
                page.evaluate("() => openFile('/split.md')")
                (vault/'split.md').write_text('external version')
                page.evaluate("() => openFile('/split.md', false, 'editor2-textarea')")
                page.evaluate("() => editor.replaceRange(' draft', {line:1,ch:8})")
                error=page.evaluate("async () => { try { await syncCurrentFile(); return null; } catch(e) { return e.message; } }")
                if error is None or (vault/'split.md').read_text()!='external version':
                    failures.append('opening split view refreshed the stale editor write token')
                # Reset only synthetic drafts, then exercise a disk-origin filename as text.
                page.evaluate('() => {editor.markClean(); editor2.markClean();}')
                name='<img src=x onerror=window.filenameExecuted=1>.md'
                (vault/name).write_text('fixture')
                page.evaluate('() => coriloReload()')
                page.wait_for_timeout(150)
                if page.evaluate('() => !!window.filenameExecuted') or page.locator('#tree img').count():
                    failures.append('filename was interpreted as executable HTML')
                # Hold an earlier save, edit again, and submit twice while a stale idle poll arrives.
                (vault/'send.md').write_text('original')
                page.evaluate("async () => { await coriloReload(); await openFile('/send.md'); }")
                held=[]; posted=[]
                def hold_first_write(route):
                    if 'send.md' in route.request.url and not held: held.append(route)
                    else: route.continue_()
                page.route('**/api/fs/write?*',hold_first_write)
                def inspect_submission(route):
                    posted.append((vault/'send.md').read_text())
                    route.fulfill(status=400,json={'error':'Synthetic submission rejection; no model called'})
                page.route('**/api/agent/prompt',inspect_submission)
                page.evaluate("() => { editor.replaceRange(' first', {line:1,ch:8}); window.pendingSave=syncCurrentFile(); }")
                for _ in range(100):
                    if held:break
                    page.wait_for_timeout(20)
                assert held,'Expected a pending editor save'
                page.evaluate("() => { editor.replaceRange(' second', {line:1,ch:14}); document.getElementById('corilo-input').value='review fixture'; window.firstSend=document.getElementById('corilo-send').onclick(); window.secondSend=document.getElementById('corilo-send').onclick(); }")
                page.wait_for_timeout(800) # the ordinary idle-state poll must not unlock submission
                assert page.evaluate("() => editor.getOption('readOnly')"), 'Idle poll unlocked an in-flight submission'
                held[0].continue_()
                page.evaluate('async () => { await window.firstSend; await window.secondSend; }')
                if posted != ['original first second']:
                    failures.append('agent submission missed the newest draft or submitted twice')
                assert page.locator('#corilo-input').input_value()=='review fixture'
                browser.close()
                assert not failures, failures
                print('Review regressions passed: move collision, stale file/tree deletion and moves, independent split editor versions, literal filenames, final draft flush and duplicate-submit prevention')
        finally:
            child.terminate()
            try:child.wait(timeout=15)
            except subprocess.TimeoutExpired:child.kill();child.wait()

if __name__=='__main__':main()
