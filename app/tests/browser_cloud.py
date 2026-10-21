"""Actual cloud UI and disk/database flow; fixture identity service is synthetic."""
import os
import shutil
import tempfile
import zipfile
from pathlib import Path
from playwright.sync_api import sync_playwright
origin=os.environ['CORILO_TEST_CLOUD_ORIGIN']
with sync_playwright() as p:
    options={'headless':True}
    if shutil.which('chromium'): options['executable_path']=shutil.which('chromium')
    browser=p.chromium.launch(**options)
    page=browser.new_page(viewport={'width':390,'height':844})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(origin)
    page.wait_for_url('**/login')
    page.locator('[name=email]').fill(os.environ['CORILO_TEST_EMAIL'])
    page.locator('[name=password]').fill('synthetic-password')
    page.locator('button').click()
    page.wait_for_function('() => typeof coriloReady !== "undefined" && coriloReady')
    assert page.locator('#corilo-send').is_disabled()
    assert page.locator('#corilo-sync-toggle').count()==0
    page.locator('#corilo-input').fill('Cloud browser note')
    page.locator('#corilo-capture').click()
    page.wait_for_function('() => editor.getValue().includes("Cloud browser note")')
    with page.expect_download() as exported:
        page.locator('#corilo-export').click()
    with tempfile.TemporaryDirectory() as tmp:
        target=Path(tmp)/'notes.zip'; exported.value.save_as(target)
        with zipfile.ZipFile(target) as archive:
            assert any(b'Cloud browser note' in archive.read(name) for name in archive.namelist() if name.endswith('.md'))
    assert page.locator('#corilo-status').inner_text()=='已保存到云端'
    # A separate browser context is a second device, with its own login session.
    other_context=browser.new_context()
    other=other_context.new_page(); other.goto(origin)
    other.locator('[name=email]').fill(os.environ['CORILO_TEST_EMAIL'])
    other.locator('[name=password]').fill('synthetic-password')
    other.locator('button').click()
    other.wait_for_function('() => typeof coriloReady !== "undefined" && coriloReady')
    page.locator('#corilo-input').fill('Second device sees this')
    page.locator('#corilo-capture').click()
    page.wait_for_function('() => editor.getValue().includes("Second device sees this")')
    created_path=page.evaluate('() => editor.path')
    other.wait_for_function('path => !!getMemFile(path)', arg=created_path)
    other_context.close()

    page.locator('#corilo-logout').click()
    page.wait_for_url('**/login')
    page.goto(origin+'/api/state')
    assert '请重新登录' in page.locator('body').inner_text()
    assert not errors,errors
    browser.close()
print('Cloud browser checks passed: login, mobile capture, ZIP download, second-device refresh, logout; real PostgreSQL and files, synthetic identity')
