"""English UI and native live locale switching; user data stays unchanged."""
import json, os, pathlib, re, shutil, subprocess, tempfile, time
from playwright.sync_api import sync_playwright, expect
ROOT = pathlib.Path(__file__).resolve().parents[1]

def switch_language(page, current, target):
    page.get_by_role('button', name='Account menu' if current == 'English' else '账号菜单', exact=True).click()
    page.get_by_role('menuitem', name='Settings' if current == 'English' else '设置', exact=True).click()
    page.get_by_role('button', name=current, exact=True).click()
    page.get_by_role('menuitem', name=target, exact=True).click()
    page.get_by_role('button', name='关闭' if target == '中文' else 'Close', exact=True).last.click()

def run(planner):
    with tempfile.TemporaryDirectory(prefix='corilo-todos-i18n-') as tmp:
        base = pathlib.Path(tmp)
        patch = base/'patch.json'
        patch.write_text(json.dumps([{'insert':[{'id':'corilo-todos','name':str(ROOT/'index.mjs'),'config':{'root':str(base/'data'),'planner':planner}}]}, {'id':'workspace-controller','config':{'documentsDirectory':str(base/'workspace')}}]))
        with (base/'host.log').open('w') as log:
            env = dict(os.environ, DSH_HOME=str(base/'home'), DSH_AGENTS_HOME=str(base/'agents'), XDG_CONFIG_HOME=str(base/'config'))
            host = subprocess.Popen(['node',str(ROOT/'node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',str(patch),'--no-open','--port','0'], cwd=base, env=env, stdout=log, stderr=log)
            try:
                url = None
                for _ in range(600):
                    assert host.poll() is None, (base/'host.log').read_text()[-3000:]
                    match = re.search(r'dsh web: (http://127\.0\.0\.1:\d+/\?[^\s\x1b]+)', (base/'host.log').read_text())
                    if match: url=match[1]; break
                    time.sleep(.1)
                assert url
                with sync_playwright() as p:
                    browser = p.chromium.launch(headless=True, executable_path=shutil.which('chromium'))
                    context = browser.new_context(locale='en-US', viewport={'width':1400,'height':950})
                    page = context.new_page(); errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
                    page.goto(url)
                    page.get_by_role('button',name='Continue',exact=True).or_(page.get_by_role('button',name='Close',exact=True)).first.wait_for()
                    if page.get_by_role('button',name='Continue',exact=True).is_visible(): page.get_by_role('button',name='Continue',exact=True).click()
                    page.get_by_role('button',name='Close',exact=True).click()
                    page.get_by_role('button',name='Tasks',exact=True).click()
                    title = '保存 user content'
                    if planner:
                        expect(page.get_by_role('button',name='New task',exact=True)).to_be_enabled(timeout=20000)
                        page.get_by_role('button',name='New task',exact=True).click()
                        form = page.get_by_role('form',name='Item details')
                        form.get_by_label('Title',exact=True).fill(title)
                        form.get_by_label('Description',exact=True).fill('未保存 is user content')
                        # Native settings overlay must not remount the editor or lose its draft.
                        switch_language(page, 'English', '中文')
                        form = page.get_by_role('form',name='事项详情')
                        expect(form.get_by_label('标题',exact=True)).to_have_value(title)
                        expect(form.get_by_label('说明',exact=True)).to_have_value('未保存 is user content')
                        form.get_by_role('button',name='保存',exact=True).click()
                        expect(page.get_by_role('status')).to_contain_text('已保存')
                        page.on('dialog',lambda d:d.accept())
                        form.get_by_role('button',name='关闭',exact=True).click()
                        switch_language(page, '中文', 'English')
                        page.get_by_role('button',name='All',exact=True).click()
                        expect(page.get_by_role('button',name=title,exact=True)).to_be_visible()
                        page.get_by_role('button',name='New event',exact=True).click()
                        form = page.get_by_role('form',name='Item details')
                        form.get_by_label('Title',exact=True).fill('全天 event')
                        end = form.get_by_label('End (all-day end date is exclusive)',exact=True)
                        original_end = end.input_value()
                        end.fill('2000-01-01')
                        form.get_by_role('button',name='Save',exact=True).click()
                        expect(page.get_by_role('alert')).to_contain_text('End must be after start')
                        end.fill(original_end)
                        form.get_by_role('button',name='Save',exact=True).click()
                        expect(page.get_by_role('status')).to_contain_text('Saved')
                        form.get_by_role('button',name='Close',exact=True).click()
                        page.get_by_role('button',name='Calendar',exact=True).click()
                        for name in ['week','day','list','month']:
                            page.locator('.fc').get_by_role('button',name=name,exact=True).click()
                    else:
                        region = page.get_by_role('region',name='Corilo Tasks')
                        quick = region.get_by_role('textbox',name='Quick add task',exact=True)
                        quick.fill(title)
                        switch_language(page, 'English', '中文')
                        region = page.get_by_role('region',name='Corilo 待办')
                        quick = region.get_by_role('textbox',name='快速新增待办',exact=True)
                        expect(quick).to_have_value(title)
                        quick.press('Enter')
                        expect(region.get_by_role('button',name=title,exact=True)).to_be_visible()
                        switch_language(page, '中文', 'English')
                        region = page.get_by_role('region',name='Corilo Tasks')
                        region.get_by_role('button',name=title,exact=True).click()
                        expect(region.get_by_role('textbox',name='Task title',exact=True)).to_have_value(title)
                    assert not errors, errors
                    browser.close()
            finally:
                host.terminate(); host.wait(timeout=15)

if __name__ == '__main__':
    run(True); run(False)
    print('PASS: planner and v1 English UI, native language switching, preserved drafts/user text, calendar labels')
