"""Published Harness + actual Corilo client bundle, Chromium, synthetic disk data.

No model/provider mock, no old app UI, no real credentials or knowledge base.
"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import time
from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parents[1]


def wait_for(check, timeout=40):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        time.sleep(.1)
    raise AssertionError('Timed out waiting for Harness or disk evidence')


def manual_saves(panel):
    """Exercise explicit-save/draft flows through the user's visible setting.

    Dedicated editor_browser.py covers the default automatic-save mode.
    """
    more = panel.locator('details.corilo-notes-more')
    was_open = more.get_attribute('open') is not None
    if not was_open:
        more.locator('summary').first.click()
    panel.get_by_role('checkbox', name='自动保存', exact=True).uncheck()
    if not was_open:
        more.locator('summary').first.click()
    panel.evaluate('(el) => el.scrollTo({top: 0})')


def main():
    with tempfile.TemporaryDirectory(prefix='corilo-harness-browser-') as temp:
        base = pathlib.Path(temp)
        vault = base / 'notes'
        vault.mkdir()
        (base / 'user-home').mkdir()
        note = vault / '已有笔记.md'
        note.write_text('磁盘初稿\n', encoding='utf-8')
        patch = base / 'notes.patch.yml'
        patch.write_text(json.dumps([{'insert': [{'id': 'corilo-notes', 'name': str(ROOT / 'index.mjs'), 'config': {'root': str(vault)}}]}]))
        # Never print the launcher URL, auth cookie, or complete host logs.
        log_path = base / 'host.log'
        with log_path.open('w') as log:
            process = subprocess.Popen(['node', str(ROOT / 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--patch', str(patch), '--no-open', '--port', '0'], cwd=base, stdout=log, stderr=log,
                env=dict(os.environ, HOME=str(base / 'user-home'), XDG_CONFIG_HOME=str(base / 'config'), DSH_HOME=str(base / 'home')))
            try:
                def address():
                    assert process.poll() is None, 'Harness exited before browser test'
                    match = re.search(r'dsh web: (http://127\.0\.0\.1:\d+/\?[^\s\x1b]+)', log_path.read_text())
                    return match[1] if match else None
                url = wait_for(address)
                origin = url.split('/?')[0]
                with sync_playwright() as p:
                    browser = p.chromium.launch(headless=True, executable_path=shutil.which('chromium') or None)
                    context = browser.new_context(viewport={'width': 1280, 'height': 900})
                    page = context.new_page()
                    errors, external, writes = [], [], []
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    context.on('page', lambda new_page: new_page.on('pageerror', lambda error: errors.append(str(error))))
                    context.on('request', lambda req: external.append(req.url.split('?')[0]) if req.url.startswith('http') and not req.url.startswith(origin + '/') else None)
                    context.on('request', lambda req: writes.append(req.url) if '/api/corilo-notes/capture' in req.url else None)
                    unauth = context.request.post(origin + '/api/corilo-notes/list', data={})
                    assert unauth.status == 401, f'Unauthenticated API status: {unauth.status}'
                    page.goto(url)
                    page.get_by_role('button', name='Continue', exact=True).click()
                    page.get_by_role('button', name='Close', exact=True).click()
                    page.get_by_role('button', name='笔记', exact=True).click(timeout=20000)
                    panel = page.get_by_role('region', name='Corilo 笔记')
                    expect(panel).to_be_visible()
                    manual_saves(panel)
                    expect(panel.get_by_role('button', name='已有笔记.md', exact=True)).to_be_visible()
                    body = panel.get_by_role('textbox', name='笔记正文', exact=True)
                    status = panel.get_by_role('status')
                    text = '  原话中文，不需模型\n第二行 <script>不会执行</script>  '
                    body.fill(text)
                    expect(status).to_have_text('未保存')
                    panel.get_by_role('button', name='仅保存原话', exact=True).click()
                    expect(status).to_have_text('已保存')
                    captured = [x for x in vault.rglob('*.md') if x != note]
                    assert len(captured) == 1 and captured[0].read_text() == text
                    assert len(writes) == 1
                    panel.get_by_role('button', name='已有笔记.md', exact=True).click()
                    expect(body).to_have_value('磁盘初稿\n')
                    body.fill('浏览器修改\n')
                    # Pause the real host response to prove pending state/duplicate prevention.
                    page.route('**/api/corilo-notes/save', lambda route: (time.sleep(.4), route.continue_()))
                    panel.get_by_role('button', name='保存笔记', exact=True).click()
                    expect(status).to_have_text('保存中…')
                    expect(body).to_be_disabled()
                    expect(status).to_have_text('已保存')
                    page.unroute('**/api/corilo-notes/save')
                    assert note.read_text() == '浏览器修改\n'
                    body.fill('冲突仍保留的草稿')
                    note.write_text('外部较新版本\n')
                    panel.get_by_role('button', name='保存笔记', exact=True).click()
                    expect(status).to_have_text('版本冲突')
                    expect(body).to_have_value('冲突仍保留的草稿')
                    assert note.read_text() == '外部较新版本\n'
                    panel.get_by_role('button', name='查看最新内容', exact=True).click()
                    expect(panel.get_by_role('textbox', name='磁盘最新内容', exact=True)).to_have_value('外部较新版本\n')
                    expect(body).to_have_value('冲突仍保留的草稿')
                    panel.get_by_role('button', name='草稿另存为新笔记', exact=True).click()
                    expect(status).to_have_text('已保存')
                    assert any(x.read_text() == '冲突仍保留的草稿' for x in vault.rglob('*.md'))
                    assert note.read_text() == '外部较新版本\n'
                    panel.get_by_role('button', name='新笔记', exact=True).click()
                    panel.get_by_role('textbox', name='笔记文件名', exact=True).fill('../非法.md')
                    body.fill('失败草稿')
                    panel.get_by_role('button', name='保存笔记', exact=True).click()
                    expect(status).to_have_text('保存失败')
                    expect(body).to_have_value('失败草稿')
                    panel.get_by_role('textbox', name='笔记文件名', exact=True).fill('连接测试.md')
                    page.route('**/api/corilo-notes/save', lambda route: route.abort())
                    panel.get_by_role('button', name='保存笔记', exact=True).click()
                    expect(status).to_have_text('保存失败')
                    expect(body).to_have_value('失败草稿')
                    assert not (vault / '连接测试.md').exists()
                    page.unroute('**/api/corilo-notes/save')
                    # Refreshing the list must not replace the pending draft.
                    panel.get_by_role('button', name='刷新列表', exact=True).click()
                    expect(body).to_have_value('失败草稿')
                    page.get_by_role('button', name='Plugins', exact=True).click()
                    page.get_by_role('button', name='笔记', exact=True).click()
                    expect(body).to_have_value('失败草稿')
                    expect(status).to_have_text('保存失败')
                    # A second real browser page updates the same disk through the same host.
                    second = context.new_page()
                    second.goto(origin)
                    second.get_by_role('button', name='Close', exact=True).click()
                    second.get_by_role('button', name='笔记', exact=True).click()
                    other = second.get_by_role('region', name='Corilo 笔记')
                    other.get_by_role('button', name='已有笔记.md', exact=True).click()
                    expect(other.get_by_role('textbox', name='笔记正文', exact=True)).to_have_value('外部较新版本\n')
                    other.get_by_role('textbox', name='笔记正文', exact=True).fill('另一页面保存')
                    other.get_by_role('button', name='保存笔记', exact=True).click()
                    expect(other.get_by_role('status')).to_have_text('已保存')
                    assert note.read_text() == '另一页面保存'
                    second.close()
                    panel.get_by_role('button', name='保存笔记', exact=True).click()
                    expect(status).to_have_text('已保存')
                    assert (vault / '连接测试.md').read_text() == '失败草稿'
                    page.reload()
                    page.get_by_role('button', name='Close', exact=True).click()
                    page.get_by_role('button', name='笔记', exact=True).click()
                    manual_saves(panel)
                    panel.get_by_role('button', name='连接测试.md', exact=True).click()
                    expect(body).to_have_value('失败草稿')
                    # Authenticated requests with a hostile Origin still fail before file access.
                    rejected = context.request.post(origin + '/api/corilo-notes/list', headers={'Origin': 'https://untrusted.invalid'}, data={'type': 'client-request', 'rpcId': 'origin-test', 'method': 'list', 'payload': {}})
                    assert rejected.status == 403
                    rejected = context.request.post(origin + '/api/corilo-notes/list', headers={'Host': 'untrusted.invalid'}, data={})
                    assert rejected.status == 403
                    for payload in [[], {'unexpected': True}]:
                        result = context.request.post(origin + '/api/corilo-notes/list', data=payload).json()
                        assert result['ok'] is False and result['error']['code'] == 'notes/400'
                    invalid = context.request.post(origin + '/api/corilo-notes/save', data={'path': 'existing.md', 'text': 'invalid', 'expected': ['a' * 64]}).json()
                    assert invalid['ok'] is False and invalid['error']['code'] == 'notes/400'
                    expect(panel.get_by_role('textbox', name='搜索笔记')).to_be_visible()
                    panel.get_by_role('textbox', name='搜索笔记').fill('连接测试')
                    panel.get_by_role('button', name='搜索', exact=True).click()
                    expect(panel.get_by_role('button', name='已有笔记.md', exact=True)).to_have_count(0)
                    expect(panel.get_by_role('button', name='连接测试.md', exact=True)).to_be_visible()
                    artifact_dir = os.environ.get('CORILO_BROWSER_ARTIFACT_DIR')
                    if artifact_dir:
                        pathlib.Path(artifact_dir).mkdir(parents=True, exist_ok=True)
                        page.screenshot(path=str(pathlib.Path(artifact_dir) / 'notes-desktop.png'))
                    page.set_viewport_size({'width': 390, 'height': 844})
                    page.wait_for_function("() => { const r=document.querySelector('.corilo-notes').getBoundingClientRect(); return r.x >= 0 && r.right <= innerWidth + 1; }")
                    expect(body).to_be_visible()
                    assert panel.evaluate('(el) => el.scrollWidth <= el.clientWidth + 1')
                    body.click(position={'x': 5, 'y': 5})
                    body.fill('窄屏中文草稿')
                    panel.get_by_role('button', name='保存笔记', exact=True).click()
                    expect(status).to_have_text('已保存')
                    assert (vault / '连接测试.md').read_text() == '窄屏中文草稿'
                    if artifact_dir:
                        panel.evaluate('(el) => { el.scrollTop = 0; }')
                        page.screenshot(path=str(pathlib.Path(artifact_dir) / 'notes-narrow.png'), animations='disabled')
                    # A normal title needs no Markdown suffix, and saving from
                    # the keyboard uses exactly the same versioned host service.
                    panel.get_by_role('button', name='新笔记', exact=True).click()
                    expect(body).to_be_focused()
                    panel.get_by_role('textbox', name='笔记文件名').fill('键盘记录')
                    body.fill('  标题和正文分别保存，原话不改写。  ')
                    panel.get_by_role('button', name='新笔记', exact=True).click()
                    expect(body).to_have_value('')
                    titled_draft = panel.get_by_role('region', name='待恢复草稿').locator('li').filter(has_text='键盘记录')
                    titled_draft.get_by_role('button', name='恢复草稿', exact=True).click()
                    expect(body).to_have_value('  标题和正文分别保存，原话不改写。  ')
                    body.dispatch_event('keydown', {'key': 's', 'ctrlKey': True, 'isComposing': True})
                    page.wait_for_timeout(80)
                    assert not (vault / '键盘记录.md').exists(), 'IME composition must not submit'
                    body.press('Control+s')
                    expect(status).to_have_text('已保存')
                    assert (vault / '键盘记录.md').read_text() == '  标题和正文分别保存，原话不改写。  '
                    panel.get_by_role('button', name='查找笔记', exact=True).click()
                    expect(body).not_to_be_visible()
                    panel.get_by_role('button', name='返回正文', exact=True).click()
                    expect(body).to_be_visible()
                    panel.get_by_role('button', name='新笔记', exact=True).click()
                    panel.get_by_role('textbox', name='笔记文件名').fill('已有格式.markdown')
                    body.fill('保留原有 Markdown 扩展名')
                    body.press('Control+s')
                    expect(status).to_have_text('已保存')
                    assert (vault / '已有格式.markdown').read_text() == '保留原有 Markdown 扩展名'
                    assert not (vault / '已有格式.markdown.md').exists()
                    assert not errors, errors
                    assert not external, external
                    browser.close()
                process.terminate()
                assert process.wait(timeout=10) == 0
                print('Harness notes Chromium passed: load, list/search/read/edit, exact capture, pending, conflict/copy, failures/draft remount, two pages, reload, 390px layout/edit, auth/Host/Origin, malformed payloads, zero external/model requests.')
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()


if __name__ == '__main__':
    main()
