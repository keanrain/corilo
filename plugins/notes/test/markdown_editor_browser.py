"""Real Harness autosave/preview acceptance; synthetic Markdown, no model calls."""
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
from playwright.sync_api import sync_playwright, expect
from editor_support import expect_editor_value
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
                    expect(body).to_be_editable()
                    assert panel.locator('textarea[aria-label="笔记正文"]').count() == 0
                    body.fill('记录重点')
                    body.press('Control+a')
                    body.press('Control+b')
                    expect_editor_value(body, '**记录重点**')
                    expect(panel.locator('.corilo-md-strong').first).to_be_visible()
                    expect(panel.get_by_role('status')).to_have_text('已保存', timeout=10000)
                    # A save acknowledgement must keep undo history and selection.
                    body.press('Control+z')
                    expect_editor_value(body, '记录重点')
                    body.press('Control+Shift+Z')
                    expect_editor_value(body, '**记录重点**')
                    body.press('Control+a')
                    panel.get_by_role('button', name='加粗', exact=True).click()
                    expect_editor_value(body, '记录重点')
                    panel.get_by_role('button', name='标题', exact=True).click()
                    expect_editor_value(body, '## 记录重点')
                    body.fill('- 第一项')
                    body.press('Control+End')
                    body.press('Enter')
                    page.keyboard.insert_text('第二项')
                    expect_editor_value(body, '- 第一项\n- 第二项')
                    body.press('Control+f')
                    expect(panel.locator('.cm-search input[name="search"]')).to_be_visible()
                    panel.locator('.cm-search input[name="search"]').fill('第二项')
                    panel.locator('.cm-search input[name="search"]').press('End')
                    expect(panel.locator('.cm-searchMatch').first).to_be_visible()
                    page.keyboard.press('Escape')
                    expect(panel.locator('.cm-search')).not_to_be_visible()
                    # Editing one line must leave BOM, mixed line endings and
                    # surrounding whitespace in the rest of the file intact.
                    mixed = b'\xef\xbb\xbf# Title\r\nfirst\nlast  '
                    (vault / '原样.md').write_bytes(mixed)
                    panel.get_by_role('button', name='刷新列表', exact=True).click()
                    panel.get_by_role('button', name='原样.md', exact=True).click()
                    expect_editor_value(body, mixed.decode().replace('\r\n', '\n'))
                    expect(body).to_be_editable()
                    body.press('Control+z')
                    expect_editor_value(body, mixed.decode().replace('\r\n', '\n'))
                    body.press('Control+End')
                    page.keyboard.insert_text('!')
                    expect_editor_value(body, mixed.decode().replace('\r\n', '\n') + '!')
                    expect(panel.get_by_role('status')).to_have_text('已保存', timeout=10000)
                    wait_for(lambda: (vault / '原样.md').read_bytes() == mixed + b'!')
                    body.press('Control+z')
                    expect(panel.get_by_role('status')).to_have_text('已保存', timeout=10000)
                    assert (vault / '原样.md').read_bytes() == mixed
                    sample = '# 写作空间\n\n用 **重点** 和 *强调* 整理想法。\n\n## 接下来\n\n- 记录想法\n- 整理资料\n\n> 留下值得记住的一句话。\n\n使用 `Markdown`，资料仍是自己的文件。'
                    body.fill(sample)
                    expect(panel.locator('.corilo-md-h1').first).to_be_visible()
                    expect(panel.locator('.corilo-md-code').first).to_be_visible()
                    body.press('Control+End')
                    expect(panel.locator('.cm-line').first).to_have_text('写作空间')
                    body.press('Control+Home')
                    expect(panel.locator('.cm-line').first).to_have_text('# 写作空间')
                    body.press('Control+End')
                    expect(panel.get_by_role('status')).to_have_text('已保存', timeout=10000)
                    shots = pathlib.Path('/workspace/work/editor-v29')
                    shots.mkdir(parents=True, exist_ok=True)
                    panel.screenshot(path=str(shots / 'desktop.png'))
                    phone_context = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
                    phone_context.on('request', lambda request: external.append(request.url.split('?')[0]) if request.url.startswith('http') and not request.url.startswith(origin + '/') else None)
                    phone = phone_context.new_page()
                    phone.on('pageerror', lambda error: errors.append(str(error)))
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
                    mobile.get_by_role('button', name='原样.md', exact=True).tap()
                    expect_editor_value(mobile.get_by_role('textbox', name='笔记正文'), sample)
                    assert mobile.evaluate('(el) => el.scrollWidth <= el.clientWidth + 2')
                    assert mobile.get_by_role('button', name='加粗', exact=True).bounding_box()['height'] >= 44
                    mobile.screenshot(path=str(shots / 'mobile.png'))
                    phone_context.close()
                    assert external == [], external
                    assert errors == [], errors
                    browser.close()
                print('Harness CodeMirror passed: styled Markdown, format keyboard/buttons, list continuation, search, undo after autosave, exact mixed-newline preservation, desktop/mobile; zero external/model requests.')
            finally:
                host.terminate()
                host.wait(timeout=20)


if __name__ == '__main__':
    main()
