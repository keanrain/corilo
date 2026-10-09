"""Real Chromium + disk checks. Uses synthetic notes and never calls a model."""
import json
import os
import pathlib
import subprocess
import tempfile
import time
import shutil
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]

def wait_for(check, timeout=12):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if check(): return
        time.sleep(.1)
    raise AssertionError('Timed out waiting for disk result')

def main():
    with tempfile.TemporaryDirectory(prefix='corilo-browser-') as temp:
        base = pathlib.Path(temp); vault = base/'notes'; vault.mkdir()
        note = vault/'笔记.md'; note.write_text('初始正文\n')
        process = subprocess.Popen(['node','app/host/cli.mjs','--no-open','--vault',str(vault),'--config',str(base/'config')], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=dict(os.environ, PI_CODING_AGENT_DIR=str(base/'pi')))
        try:
            process.stdout.readline()
            url = process.stdout.readline().strip()
            assert url.startswith('http://127.0.0.1:'), 'Host startup failed'
            with sync_playwright() as p:
                options = {'headless': True}
                if shutil.which('chromium'): options['executable_path'] = shutil.which('chromium')
                browser = p.chromium.launch(**options)
                page = browser.new_page(viewport={'width':1280,'height':850})
                errors = []; external = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.on('request', lambda req: external.append(req.url) if req.url.startswith('http') and not req.url.startswith(url.split('/#')[0]) else None)
                page.goto(url)
                page.wait_for_function("() => typeof coriloReady !== 'undefined' && coriloReady")
                assert page.title() == 'Corilo 可里'
                assert page.locator('#corilo-config, #corilo-key').count() == 0
                page.locator('#corilo-toggle').click()
                page.locator('.CodeMirror').first.click()
                page.keyboard.press('Control+End')
                page.keyboard.insert_text('浏览器编辑成功')
                wait_for(lambda: '浏览器编辑成功' in note.read_text())
                page.reload(); page.wait_for_function('() => coriloReady')
                assert '浏览器编辑成功' in page.locator('.CodeMirror').first.inner_text()
                page.locator('#corilo-input').fill('无需 AI 的原话')
                page.locator('#corilo-capture').click()
                wait_for(lambda: any('无需 AI 的原话' == f.read_text() for f in vault.glob('收集/*.md')))
                page.wait_for_function("() => currentEditor.path && currentEditor.path.includes('收集/')")
                # Re-read a real external/Pi-style disk modification through the full editor.
                note.write_text('外部文件更新\n')
                page.locator('#corilo-toggle').click()
                page.locator('#corilo-refresh').click()
                page.evaluate("async () => { await coriloReload(); await openFile('/笔记.md'); }")
                page.wait_for_function("() => editor.getValue().includes('外部文件更新')")
                # Pause autosave to deterministically introduce an external conflict.
                page.evaluate('() => clearInterval(window.saver)')
                page.locator('.CodeMirror').first.click(); page.keyboard.press('Control+End'); page.keyboard.insert_text('未保存草稿')
                note.write_text('外部最新版本\n')
                message = page.evaluate('async () => { try { await syncCurrentFile(); return null; } catch(e) { coriloError(e); return e.message; } }')
                assert '其他位置修改' in message
                assert note.read_text() == '外部最新版本\n'
                assert '未保存草稿' in page.locator('.CodeMirror').first.inner_text()
                page.locator('#corilo-save-draft').click()
                wait_for(lambda: any('未保存草稿' in f.read_text() for f in vault.glob('收集/*.md')))
                assert note.read_text() == '外部最新版本\n'
                page.wait_for_function("() => document.getElementById('corilo-save-draft').hidden")
                assert not (vault/'archive/Log.txt').exists(), 'Diagnostics must not enter the knowledge library'
                out = ROOT/'.local'; out.mkdir(exist_ok=True)
                page.screenshot(path=str(out/'corilo-browser.png'), full_page=True)
                assert not errors, errors
                assert not external, external
                result = {'checks':['full Files.md editor loads','browser edit persists on disk','reload reads saved Markdown','capture without AI','external disk edit reloads','conflicting save preserves draft and external file','save conflicted draft as a separate file','no knowledge-library diagnostic logs'], 'pageErrors':errors,'externalRequests':external,'modelCalls':0}
                (out/'corilo-browser-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
                print(json.dumps(result,ensure_ascii=False))
                browser.close()
        finally:
            process.terminate()
            try: process.wait(timeout=15)
            except subprocess.TimeoutExpired: process.kill(); process.wait()
            if process.returncode not in (0,-15): print(process.stderr.read())

if __name__ == '__main__': main()
