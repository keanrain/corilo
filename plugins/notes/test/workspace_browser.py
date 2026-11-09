"""Real Harness autosave/preview acceptance; synthetic Markdown, no model calls."""
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
from playwright.sync_api import sync_playwright, expect
from browser import ROOT, wait_for, open_drafts


def main():
    with tempfile.TemporaryDirectory(prefix='corilo-editor-') as temp:
        base = pathlib.Path(temp)
        vault = base / 'notes'
        vault.mkdir()
        note = vault / '自动保存.md'
        note.write_text('原始正文\n')
        patch = base / 'notes.patch.json'
        patch.write_text(json.dumps([
            {'insert': [{'id': 'corilo-notes', 'name': str(ROOT / 'index.mjs'), 'config': {'root': str(vault), 'stateRoot': str(base / 'state')}}]},
            {'id': 'workspace-controller', 'config': {'documentsDirectory': str(base / 'documents')}}
        ]))
        log_path = base / 'host.log'
        with log_path.open('w') as log:
            host = subprocess.Popen(['node', str(ROOT / 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--patch', str(patch), '--no-open', '--port', '0'],
                cwd=base, stdout=log, stderr=log, env=dict(os.environ, HOME=str(base / 'user-home'), DSH_HOME=str(base / 'harness'), DSH_AGENTS_HOME=str(base / 'agents'), XDG_CONFIG_HOME=str(base / 'config')))
            try:
                def address():
                    assert host.poll() is None
                    match = re.search(r'dsh web: (http://127\.0\.0\.1:\d+/\?[^\s\x1b]+)', log_path.read_text())
                    return match[1] if match else None
                url = wait_for(address)
                origin = url.split('/?')[0]
                with sync_playwright() as p:
                    browser = p.chromium.launch(headless=True, executable_path=shutil.which('chromium') or None)
                    context = browser.new_context(viewport={'width': 1400, 'height': 1000})
                    errors, external, mutations = [], [], []
                    context.on('request', lambda request: external.append(request.url.split('?')[0]) if request.url.startswith('http') and not request.url.startswith(origin + '/') else None)
                    context.on('request', lambda request: mutations.append(request.url.split('/')[-1]) if re.search(r'/api/corilo-notes/(save|capture|create)$', request.url) else None)
                    page = context.new_page()
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.goto(url)
                    page.get_by_role('button', name='Continue', exact=True).click()
                    page.get_by_role('button', name='Close', exact=True).click()
                    page.get_by_role('button', name='笔记', exact=True).click()
                    panel = page.get_by_role('region', name='Corilo 笔记')
                    body = panel.get_by_role('textbox', name='笔记正文', exact=True)
                    expect(body).to_be_enabled()
                    # Default core journey: start writing, name the document
                    # in place, and create the next one without a submit form.
                    words = '把值得回看的想法留在这里。\n\n- 一个观察\n- 下一步行动\n'
                    body.fill(words)
                    expect(panel.get_by_role('status')).to_have_text('已保存', timeout=10000)
                    assert (vault / '未命名.md').read_text() == words
                    expect(panel.get_by_role('button', name='保存笔记', exact=True)).to_have_count(0)
                    expect(panel.get_by_role('button', name='仅保存原话', exact=True)).to_have_count(0)
                    title = panel.get_by_role('textbox', name='笔记标题', exact=True)
                    expect(title).to_have_value('未命名')
                    title.click()
                    edit_title = panel.get_by_role('textbox', name='新笔记名称', exact=True)
                    edit_title.dispatch_event('compositionstart')
                    edit_title.fill('读书札记')
                    edit_title.dispatch_event('blur')
                    page.wait_for_timeout(80)
                    assert (vault / '未命名.md').exists() and not (vault / '读书札记.md').exists(), 'IME blur must not rename'
                    edit_title.dispatch_event('compositionend')
                    edit_title.press('Enter')
                    expect(title).to_have_value('读书札记')
                    assert not (vault / '未命名.md').exists()
                    assert (vault / '读书札记.md').read_text() == words
                    body.fill('刚写完就点标题，不必先找保存按钮。')
                    title.click()
                    expect(edit_title).to_be_visible()
                    assert (vault / '读书札记.md').read_text() == '刚写完就点标题，不必先找保存按钮。'
                    edit_title.fill('取消的标题')
                    edit_title.press('Escape')
                    expect(title).to_have_value('读书札记')
                    expect(body).to_be_focused()
                    assert not (vault / '取消的标题.md').exists()
                    body.fill('离开前尚未到防抖时间的修改')
                    panel.get_by_role('button', name='自动保存.md', exact=True).click()
                    expect(body).to_have_value('原始正文\n')
                    assert (vault / '读书札记.md').read_text() == '离开前尚未到防抖时间的修改'
                    panel.get_by_role('button', name='读书札记.md', exact=True).click()
                    expect(body).to_have_value('离开前尚未到防抖时间的修改')
                    body.fill(words)
                    panel.get_by_role('button', name='读书札记.md', exact=True).click()
                    expect(panel.get_by_role('status')).to_have_text('已保存', timeout=10000)
                    expect(body).to_be_enabled()
                    expect(body).to_have_value(words)
                    assert (vault / '读书札记.md').read_text() == words
                    panel.get_by_role('button', name='实时预览', exact=True).click()
                    expect(panel.get_by_role('region', name='Markdown 实时预览')).to_contain_text('一个观察')
                    assert panel.evaluate('(el) => el.scrollWidth <= el.clientWidth + 1')
                    artifacts = os.environ.get('CORILO_BROWSER_ARTIFACT_DIR')
                    if artifacts:
                        pathlib.Path(artifacts).mkdir(parents=True, exist_ok=True)
                        page.screenshot(path=str(pathlib.Path(artifacts) / 'notes-workspace-desktop.png'), animations='disabled')
                    panel.get_by_role('button', name='新笔记', exact=True).click()
                    expect(body).to_be_visible()
                    expect(body).to_be_focused()
                    expect(title).to_have_value('未命名')
                    assert (vault / '未命名.md').read_text() == ''
                    body.fill('新建后直接输入，自动保存。')
                    expect(panel.get_by_role('status')).to_have_text('已保存', timeout=10000)
                    assert (vault / '未命名.md').read_text() == '新建后直接输入，自动保存。'

                    phone_context = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
                    phone = phone_context.new_page()
                    phone.on('pageerror', lambda error: errors.append(str(error)))
                    phone_context.on('request', lambda request: external.append(request.url.split('?')[0]) if request.url.startswith('http') and not request.url.startswith(origin + '/') else None)
                    phone.goto(url)
                    phone.get_by_role('button', name='Continue', exact=True).or_(phone.get_by_role('button', name='Close', exact=True)).first.wait_for()
                    if phone.get_by_role('button', name='Continue', exact=True).is_visible():
                        phone.get_by_role('button', name='Continue', exact=True).click()
                    phone.get_by_role('button', name='Close', exact=True).click()
                    phone.get_by_role('button', name='Open sidebar', exact=True).tap()
                    phone.get_by_role('button', name='笔记', exact=True).tap()
                    phone.touchscreen.tap(382, 220)
                    mobile = phone.get_by_role('region', name='Corilo 笔记')
                    mobile.get_by_role('button', name='查找笔记', exact=True).tap()
                    mobile.get_by_role('button', name='读书札记.md', exact=True).tap()
                    expect(mobile.get_by_role('textbox', name='笔记正文')).to_have_value(words)
                    expect(mobile.get_by_role('complementary', name='笔记列表')).not_to_be_visible()
                    assert mobile.evaluate('(el) => el.scrollWidth <= el.clientWidth + 1')
                    mobile.get_by_role('button', name='实时预览', exact=True).tap()
                    expect(mobile.get_by_role('textbox', name='笔记正文')).not_to_be_visible()
                    expect(mobile.get_by_role('region', name='Markdown 实时预览')).to_contain_text('下一步行动')
                    expect(mobile.locator('.corilo-notes-popover')).not_to_be_visible()
                    if artifacts:
                        phone.screenshot(path=str(pathlib.Path(artifacts) / 'notes-workspace-mobile.png'), animations='disabled')
                    mobile.get_by_role('button', name='新笔记', exact=True).tap()
                    expect(mobile.get_by_role('textbox', name='笔记正文')).to_be_visible()
                    phone_context.close()
                    # Lost first-create replies must be resolvable through the
                    # actual file list, without retrying or losing the input.
                    check_page = context.new_page()
                    check_page.on('pageerror', lambda error: errors.append(str(error)))
                    check_page.goto(origin)
                    check_page.get_by_role('button', name='Close', exact=True).click()
                    check_page.get_by_role('button', name='笔记', exact=True).click()
                    check_panel = check_page.get_by_role('region', name='Corilo 笔记')
                    check_body = check_panel.get_by_role('textbox', name='笔记正文')
                    creates = []
                    def lose_create(route):
                        result = route.fetch().json()
                        assert result['ok']
                        creates.append(result['value']['path'])
                        route.abort()
                    check_page.route('**/api/corilo-notes/create', lose_create, times=1)
                    check_body.fill('首次保存已落盘但回复丢失，仍能核对。')
                    expect(check_panel.get_by_role('status')).to_have_text('保存失败', timeout=10000)
                    check_page.wait_for_timeout(1200)
                    assert len(creates) == 1
                    check_page.once('dialog', lambda dialog: dialog.accept())
                    check_panel.get_by_role('button', name=creates[0], exact=True).click()
                    expect(check_panel.get_by_role('status')).to_have_text('已保存')
                    expect(check_body).to_have_value('首次保存已落盘但回复丢失，仍能核对。')
                    assert len(creates) == 1
                    check_page.close()
                    assert not errors, errors
                    assert not external, external
                    context.close()
                    browser.close()
                host.terminate()
                assert host.wait(timeout=10) == 0
                print('Harness notes workspace passed: direct writing creates a real note, title edits in place, new-document autofocus, quiet autosave, desktop preview and 390px browse/preview/new; zero model/external requests.')
            finally:
                if host.poll() is None:
                    host.kill()
                    host.wait()


if __name__ == '__main__':
    main()
