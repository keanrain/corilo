"""Real Harness rename UI, exact bytes, anchored history and lost replies."""
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import time

from playwright.sync_api import sync_playwright, expect
from browser import ROOT, wait_for, manual_saves


def main():
    with tempfile.TemporaryDirectory(prefix='corilo-rename-browser-') as temp:
        base = pathlib.Path(temp)
        vault = base / 'notes'
        vault.mkdir()
        original = vault / '原名.md'
        exact = b'\xef\xbb\xbf' + '原话\r\n  空白原样保留  \n'.encode()
        original.write_bytes(exact)
        (vault / '已有.md').write_text('不能覆盖')
        (base / 'user-home').mkdir()
        patch = base / 'patch.json'
        patch.write_text(json.dumps([{'insert': [{'id': 'corilo-notes', 'name': str(ROOT / 'index.mjs'), 'config': {'root': str(vault), 'stateRoot': str(base / 'state')}}]}]))
        with (base / 'host.log').open('w') as log:
            host = subprocess.Popen(['node', str(ROOT / 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--patch', str(patch), '--no-open', '--port', '0'], cwd=base, stdout=log, stderr=log,
                env=dict(os.environ, HOME=str(base / 'user-home'), DSH_HOME=str(base / 'harness'), DSH_AGENTS_HOME=str(base / 'agents')))
            try:
                def address():
                    assert host.poll() is None
                    match = re.search(r'dsh web: (http://127\.0\.0\.1:\d+/\?[^\s\x1b]+)', (base / 'host.log').read_text())
                    return match[1] if match else None
                url = wait_for(address)
                origin = url.split('/?')[0]
                with sync_playwright() as p:
                    browser = p.chromium.launch(headless=True, executable_path=shutil.which('chromium') or None)
                    context = browser.new_context(viewport={'width': 1280, 'height': 900})
                    errors, external, renames = [], [], []
                    page = context.new_page()
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    context.on('request', lambda req: external.append(req.url.split('?')[0]) if req.url.startswith('http') and not req.url.startswith(origin + '/') else None)
                    page.on('request', lambda req: renames.append(req.post_data_json) if '/api/corilo-notes/rename' in req.url else None)
                    page.goto(url)
                    page.get_by_role('button', name='Continue', exact=True).click()
                    page.get_by_role('button', name='Close', exact=True).click()
                    page.get_by_role('button', name='笔记', exact=True).click()
                    panel = page.get_by_role('region', name='Corilo 笔记')
                    body = panel.get_by_role('textbox', name='笔记正文', exact=True)
                    manual_saves(panel)
                    panel.get_by_role('button', name='原名.md', exact=True).click()
                    panel.get_by_role('button', name='重命名笔记', exact=True).click()
                    field = panel.get_by_role('textbox', name='新笔记名称', exact=True)
                    expect(field).to_be_focused()
                    expect(body).to_be_disabled()
                    expect(panel.get_by_role('button', name='新笔记', exact=True)).to_be_disabled()
                    more = panel.locator('details.corilo-notes-more')
                    more.locator('summary').first.click()
                    expect(panel.get_by_role('button', name='移入回收站', exact=True)).to_be_disabled()
                    expect(panel.get_by_role('button', name='版本历史', exact=True)).to_be_disabled()
                    field.fill('已有')
                    panel.get_by_role('button', name='确认重命名', exact=True).click()
                    expect(panel.get_by_role('alert')).to_contain_text('已存在')
                    assert original.read_bytes() == exact and (vault / '已有.md').read_text() == '不能覆盖'
                    field.fill('新名字')
                    held = []
                    def hold_reply(route):
                        held.append((route, route.fetch()))
                    page.route('**/api/corilo-notes/rename', hold_reply, times=1)
                    panel.get_by_role('button', name='确认重命名', exact=True).click()
                    deadline = time.monotonic() + 10
                    while not held and time.monotonic() < deadline:
                        page.wait_for_timeout(25)
                    assert held, 'Rename request must reach the host'
                    page.get_by_role('button', name='Plugins', exact=True).click()
                    page.get_by_role('button', name='笔记', exact=True).click()
                    expect(body).to_be_disabled()
                    held[0][0].fulfill(response=held[0][1])
                    expect(field).to_have_count(0)
                    expect(body).to_be_enabled()
                    assert not original.exists() and (vault / '新名字.md').read_bytes() == exact

                    # Reuse of the earlier name creates a distinct later note.
                    identity = context.request.post(origin + '/api/corilo-notes/identity', data={}).json()['value']['id']
                    result = context.request.post(origin + '/api/corilo-notes/save', headers={'x-corilo-library-id': identity}, data={'path': '原名.md', 'text': '后来新建的另一篇', 'expected': None}).json()
                    assert result['ok']
                    if more.get_attribute('open') is None:
                        more.locator('summary').first.click()
                    panel.get_by_role('button', name='版本历史', exact=True).click()
                    panel.get_by_role('button', name='查看重命名前历史：原名.md', exact=True).click()
                    history = panel.get_by_role('region', name='版本历史列表')
                    history.locator('li').first.get_by_role('button').first.click()
                    expect(panel.get_by_role('textbox', name='历史正文', exact=True)).to_have_value(exact.decode().replace('\r\n', '\n'))
                    expect(panel.get_by_role('button', name='恢复此版本', exact=True)).to_be_disabled()

                    # The host commits before its response is lost. No retry is
                    # allowed until explicit read-only verification and choice.
                    panel.get_by_role('button', name='重命名笔记', exact=True).click()
                    field.fill('最终名字')
                    def lose_reply(route):
                        assert route.fetch().json()['ok']
                        route.abort()
                    page.route('**/api/corilo-notes/rename', lose_reply, times=1)
                    panel.get_by_role('button', name='确认重命名', exact=True).click()
                    verify = panel.get_by_role('button', name='核对新旧文件', exact=True)
                    expect(verify).to_be_visible()
                    count = len(renames)
                    page.wait_for_timeout(1200)
                    assert len(renames) == count
                    assert not (vault / '新名字.md').exists() and (vault / '最终名字.md').read_bytes() == exact
                    # An unresolved rename remains discoverable after a reload.
                    page.once('dialog', lambda dialog: dialog.accept())
                    page.reload()
                    page.get_by_role('button', name='Close', exact=True).click()
                    page.get_by_role('button', name='笔记', exact=True).click()
                    panel.get_by_role('button', name='恢复草稿', exact=True).click()
                    expect(verify).to_be_visible()
                    verify.click()
                    panel.get_by_role('button', name='打开新文件', exact=True).click()
                    expect(body).to_be_enabled()
                    expect(panel.get_by_role('textbox', name='笔记文件名')).to_have_value('最终名字.md')

                    # Following earlier names is discoverable after a reload.
                    page.reload()
                    page.get_by_role('button', name='Close', exact=True).click()
                    page.get_by_role('button', name='笔记', exact=True).click()
                    panel.get_by_role('button', name='最终名字.md', exact=True).click()
                    more.locator('summary').first.click()
                    panel.get_by_role('button', name='版本历史', exact=True).click()
                    panel.get_by_role('button', name='查看重命名前历史：新名字.md', exact=True).click()
                    expect(panel.get_by_role('button', name='查看重命名前历史：原名.md', exact=True)).to_be_visible()
                    assert not errors, errors
                    assert not external, external
                    browser.close()
                host.terminate()
                assert host.wait(timeout=10) == 0
                print('Harness rename Chromium passed: no-overwrite, exact BOM/CRLF, mutation lock, anchored old history after filename reuse/reload, lost reply verification without retry; zero model/external requests.')
            finally:
                if host.poll() is None:
                    host.kill(); host.wait()


if __name__ == '__main__':
    main()
