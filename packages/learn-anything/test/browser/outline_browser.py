"""Real Chromium component regression; simulated host transport, no model or DSH e2e."""
import os, pathlib, shutil, socket, subprocess, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright, expect
root = pathlib.Path(__file__).resolve().parents[2]
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
with tempfile.TemporaryFile(mode='w+') as log:
    process = subprocess.Popen(['node','test/browser/outline-fixture.mjs'],cwd=root,env=dict(os.environ,PORT=str(port)),stdout=log,stderr=log)
    try:
        url=f'http://127.0.0.1:{port}/'
        for _ in range(100):
            try:
                urllib.request.urlopen(url, timeout=1).close()
                break
            except OSError:
                if process.poll() is not None:
                    log.seek(0)
                    raise AssertionError(log.read())
                time.sleep(.1)
        with sync_playwright() as p:
            options={'headless':True}
            if shutil.which('chromium'): options['executable_path']=shutil.which('chromium')
            browser=p.chromium.launch(**options)
            page=browser.new_page()
            errors=[]
            page.on('pageerror',lambda e: errors.append(str(e)))
            page.goto(url)
            page.get_by_role('button',name='编辑路线',exact=True).click()
            page.get_by_label('章节',exact=True).fill('我的路线')
            point=page.get_by_label('知识点',exact=True).filter(visible=True)
            page.locator('input[value="知识点一"]').fill('我的新标题')
            page.get_by_role('checkbox').first.check()
            page.evaluate('window.failSave=true')
            page.get_by_role('button',name='保存草稿',exact=True).click()
            expect(page.get_by_role('status')).to_contain_text('草稿已保留')
            expect(page.get_by_label('章节',exact=True)).to_have_value('我的路线')
            page.evaluate('switchLanguage()')
            expect(page.get_by_role('button',name='Save draft',exact=True)).to_be_visible()
            expect(page.get_by_label('Chapter',exact=True)).to_have_value('我的路线')
            page.evaluate('window.failSave=false')
            page.get_by_role('button',name='Save draft',exact=True).click()
            expect(page.get_by_role('status')).to_have_text('Saved')
            assert page.evaluate('calls.at(-1).data.chapters[0].kps[0].skipped') is True
            page.get_by_role('button',name='Confirm and lock',exact=True).click()
            expect(page.get_by_role('button',name='Edit route',exact=True)).to_have_count(0)
            assert page.evaluate('calls.at(-1).data.status')=='active'
            assert not errors,errors
            browser.close()
        print('Outline browser regression passed (simulated host transport).')
    finally:
        process.terminate()
        process.wait(timeout=5)
