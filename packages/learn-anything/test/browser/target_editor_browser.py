"""Chromium editor rendering with simulated transport; no DSH/model integration claim."""
import os, pathlib, shutil, socket, subprocess, time, urllib.request
from playwright.sync_api import sync_playwright, expect
root = pathlib.Path(__file__).resolve().parents[2]
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
server = subprocess.Popen(['node', 'test/browser/smoke.mjs'], cwd=root, env=dict(os.environ, PORT=str(port)), stdout=subprocess.DEVNULL)
try:
    url = f'http://127.0.0.1:{port}/editor'
    for _ in range(150):
        try:
            urllib.request.urlopen(url, timeout=1).close()
            break
        except OSError:
            time.sleep(.1)
    with sync_playwright() as p:
        options = {'headless': True}
        if shutil.which('chromium'): options['executable_path'] = shutil.which('chromium')
        browser = p.chromium.launch(**options)
        page = browser.new_page()
        page.goto(url)
        page.get_by_role('button', name='编辑靶图').click()
        page.get_by_label('你的解释').fill('我的规律：满足 X 就是 Y。')
        page.get_by_label('个人批注').fill('回头比较反例')
        page.get_by_role('button', name='添加个人例子').click()
        page.get_by_label('例子输入').fill('X')
        page.get_by_label('例子输出').fill('Y')
        page.evaluate('window.failSave = true')
        page.get_by_role('button', name='保存笔记').click()
        expect(page.get_by_role('alert')).to_contain_text('Version conflict')
        expect(page.get_by_label('你的解释')).to_have_value('我的规律：满足 X 就是 Y。')
        expect(page.get_by_label('个人批注')).to_have_value('回头比较反例')
        page.evaluate('window.failSave = false')
        page.get_by_role('button', name='保存笔记').click()
        expect(page.locator('#saved')).to_contain_text('我的规律：满足 X 就是 Y。')
        page.get_by_role('button', name='编辑靶图').click()
        expect(page.get_by_label('例子输入')).to_have_value('X')
        page.get_by_role('button', name='删除个人例子').click()
        expect(page.get_by_label('例子输入')).to_have_count(0)
        session_editor = page.locator('#session-editor')
        page.evaluate("window.showEditorSession('a')")
        session_editor.get_by_role('button', name='编辑靶图').click()
        session_editor.get_by_label('你的解释').fill('Private draft from session A')
        page.evaluate("window.showEditorSession('b')")
        expect(session_editor.get_by_role('button', name='编辑靶图')).to_be_visible()
        expect(session_editor.get_by_label('你的解释')).to_have_count(0)
        session_editor.get_by_role('button', name='编辑靶图').click()
        expect(session_editor.get_by_label('你的解释')).not_to_have_value('Private draft from session A')
        session_editor.get_by_label('你的解释').fill('Saving session B')
        page.evaluate('window.holdSave = true')
        session_editor.get_by_role('button', name='保存笔记').click()
        page.wait_for_function('typeof window.releaseSave === "function"')
        page.evaluate("window.showEditorSession('c')")
        expect(session_editor.get_by_role('button', name='编辑靶图')).to_be_visible()
        page.evaluate('window.releaseSave()')
        page.wait_for_timeout(50)
        assert page.evaluate('window.editorSessions.length') == 0, 'Old-session receipt must not update the new card'
        browser.close()
    print('Target editor Chromium: save, conflict recovery, personal examples and cross-session isolation passed (simulated transport)')
finally:
    server.terminate()
    server.wait(timeout=5)
