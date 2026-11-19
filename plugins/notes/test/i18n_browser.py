"""Real Harness locale checks for owned notes UI; user text is never translated."""
import json, os, pathlib, re, shutil, subprocess, tempfile, time
from playwright.sync_api import sync_playwright, expect
ROOT = pathlib.Path(__file__).resolve().parents[1]


def run():
    with tempfile.TemporaryDirectory(prefix='corilo-notes-i18n-') as temp:
        base = pathlib.Path(temp)
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, executable_path=shutil.which('chromium') or None)
            for interface in ['filesmd', 'classic']:
                work = base / interface
                work.mkdir()
                notes = work / 'notes'
                notes.mkdir()
                original = '笔记 Notes — user content stays unchanged\n'
                (notes / 'Language.md').write_text(original)
                overlay = work / 'overlay.json'
                overlay.write_text(json.dumps([{'insert': [{'id': 'corilo-notes', 'name': str(ROOT / 'index.mjs'), 'config': {'root': str(notes), 'interface': interface}}]}]))
                with (work / 'host.log').open('w') as log:
                    host = subprocess.Popen(['node', str(ROOT / 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--patch', str(overlay), '--no-open', '--port', '0'], cwd=work, stdout=log, stderr=log, env=dict(os.environ, HOME=str(work / 'home'), DSH_HOME=str(work / 'harness'), DSH_AGENTS_HOME=str(work / 'agents'), XDG_CONFIG_HOME=str(work / 'config')))
                    try:
                        url = None
                        for _ in range(400):
                            match = re.search(r'dsh web: (http://127\.0\.0\.1:\d+/\?[^\s\x1b]+)', (work / 'host.log').read_text())
                            if match:
                                url = match[1]
                                break
                            assert host.poll() is None, 'Harness failed before readiness'
                            time.sleep(.1)
                        assert url, 'Harness readiness timed out'
                        for locale in ['en-US', 'zh-CN']:
                            context = browser.new_context(locale=locale, viewport={'width': 1440, 'height': 1000})
                            page = context.new_page()
                            errors = []
                            page.on('pageerror', lambda error: errors.append(str(error)))
                            page.goto(url)
                            first = page.get_by_role('button', name=re.compile('^(Continue|继续)$'))
                            first.or_(page.get_by_role('button', name=re.compile('^(Close|关闭)$'))).first.wait_for()
                            if first.is_visible():
                                first.click()
                            page.get_by_role('button', name=re.compile('^(Close|关闭)$')).click()
                            english = locale == 'en-US'
                            def switch_language():
                                page.get_by_role('button', name='Account menu' if english else '账号菜单', exact=True).click()
                                page.get_by_role('menuitem', name='Settings' if english else '设置', exact=True).click()
                                page.get_by_role('button', name='English' if english else '中文', exact=True).click()
                                page.get_by_role('menuitem', name='中文' if english else 'English', exact=True).click()
                                page.get_by_role('button', name='关闭' if english else 'Close', exact=True).last.click()

                            page.get_by_role('button', name='Notes' if english else '笔记', exact=True).click()
                            if interface == 'filesmd':
                                iframe = page.locator('iframe')
                                expect(iframe).to_have_attribute('title', 'Corilo Files.md workspace' if english else 'Corilo Files.md 工作区')
                                frame = iframe.content_frame
                                expect(frame.locator('#corilo-status')).to_have_text('Saved to host' if english else '已保存到主机')
                                expect(frame.locator('#corilo-copy')).to_have_text('Save a copy' if english else '保存副本')
                                # Files.md interface strings follow the language too; note names never do.
                                capture = 'Dump your thoughts...' if english else '想到什么，先记下来…'
                                expect(frame.locator('#chat-input')).to_have_attribute('placeholder', capture)
                                expect(frame.locator('#new-file')).to_have_attribute('aria-label', 'New File (⌘N)' if english else '新建笔记（⌘N）')
                                expect(frame.locator('#sidebar .sidebar-chat')).to_have_text('chat' if english else '收集')
                                expect(frame.locator('#sidebar')).to_contain_text('Language')
                                # Change only the display language while the iframe holds unsaved text.
                                actual = page.frames[-1]
                                if not english:
                                    defaults = []
                                    def inspect_prompt(dialog):
                                        defaults.append((dialog.message, dialog.default_value))
                                        dialog.dismiss()
                                    page.once('dialog', inspect_prompt)
                                    actual.evaluate("() => prompt('Rename folder:', 'New Folder')")
                                    assert defaults == [('重命名文件夹：', 'New Folder')], defaults
                                actual.evaluate("async()=>{await openFile('/Language.md');}")
                                actual.evaluate("()=>{clearInterval(window.saver);editor.replaceRange('保留草稿', {line:editor.lastLine(),ch:0});}")
                                before = actual.evaluate('()=>editor.getValue()')
                                switch_language()
                                expect(frame.locator('#corilo-copy')).to_have_text('保存副本' if english else 'Save a copy')
                                expect(frame.locator('#new-file')).to_have_attribute('aria-label', '新建笔记（⌘N）' if english else 'New File (⌘N)')
                                expect(frame.locator('#sidebar .sidebar-chat')).to_have_text('收集' if english else 'chat')
                                assert actual.evaluate('()=>editor.getValue()') == before
                                actual.evaluate('async()=>{await syncCurrentFile();}')
                            else:
                                panel = page.get_by_role('region', name='Corilo notes' if english else 'Corilo 笔记', exact=True)
                                expect(panel.get_by_role('button', name='New note' if english else '新笔记', exact=True)).to_be_visible()
                                body = panel.get_by_role('textbox', name='Note body' if english else '笔记正文', exact=True)
                                body.fill('Untouched 用户输入')
                                switch_language()
                                switched = page.get_by_role('textbox', name='笔记正文' if english else 'Note body', exact=True)
                                expect(switched).to_have_text('Untouched 用户输入')
                            assert not errors, errors
                            context.close()
                    finally:
                        host.terminate()
                        try:
                            host.wait(timeout=10)
                        except subprocess.TimeoutExpired:
                            host.kill()
                            host.wait()
            browser.close()
    print('Notes localization passed: English/Chinese Harness startup, live owned UI switching, iframe and CodeMirror drafts preserved.')


if __name__ == '__main__':
    run()
