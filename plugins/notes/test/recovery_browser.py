"""Exercise Git history/trash through the actual published Harness notes page."""
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
from playwright.sync_api import sync_playwright, expect
from browser import wait_for

ROOT = pathlib.Path(__file__).resolve().parents[1]


def main():
    with tempfile.TemporaryDirectory(prefix='corilo-recovery-browser-') as temp:
        base = pathlib.Path(temp)
        vault = base / 'notes'
        vault.mkdir()
        (base / 'user-home').mkdir()
        note = vault / '可恢复.md'
        first_text = '需要保留的最初版本\n'
        note.write_text(first_text)
        patch = base / 'notes.patch.yml'
        patch.write_text(json.dumps([{'insert': [{'id': 'corilo-notes', 'name': str(ROOT / 'index.mjs'), 'config': {'root': str(vault), 'stateRoot': str(base / 'recovery')}}]}]))
        log_path = base / 'host.log'
        with log_path.open('w') as log:
            process = subprocess.Popen(['node', str(ROOT / 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--patch', str(patch), '--no-open', '--port', '0'], cwd=base, stdout=log, stderr=log,
                env=dict(os.environ, HOME=str(base / 'user-home'), XDG_CONFIG_HOME=str(base / 'config'), DSH_HOME=str(base / 'home')))
            try:
                def address():
                    assert process.poll() is None, 'Harness exited before recovery test'
                    match = re.search(r'dsh web: (http://127\.0\.0\.1:\d+/\?[^\s\x1b]+)', log_path.read_text())
                    return match[1] if match else None
                url = wait_for(address)
                origin = url.split('/?')[0]
                with sync_playwright() as p:
                    browser = p.chromium.launch(headless=True, executable_path=shutil.which('chromium') or None)
                    context = browser.new_context(viewport={'width': 1280, 'height': 1000})
                    errors, external = [], []
                    context.on('request', lambda req: external.append(req.url.split('?')[0]) if req.url.startswith('http') and not req.url.startswith(origin + '/') else None)
                    page = context.new_page()
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.goto(url)
                    page.get_by_role('button', name='Continue', exact=True).click()
                    page.get_by_role('button', name='Close', exact=True).click()
                    page.get_by_role('button', name='笔记', exact=True).click()
                    panel = page.get_by_role('region', name='Corilo 笔记')
                    panel.get_by_role('button', name='可恢复.md', exact=True).click()
                    body = panel.get_by_role('textbox', name='笔记正文', exact=True)
                    expect(body).to_have_value(first_text)
                    body.fill('第二次保存的内容')
                    panel.get_by_role('button', name='保存笔记', exact=True).click()
                    expect(panel.get_by_role('status')).to_have_text('已保存')
                    assert note.read_text() == '第二次保存的内容'
                    panel.get_by_role('button', name='版本历史', exact=True).click()
                    listing = panel.get_by_role('region', name='版本历史列表')
                    first_hash = hashlib.sha256(first_text.encode()).hexdigest()[:8]
                    listing.get_by_role('button').filter(has_text=first_hash).last.click()
                    expect(panel.get_by_role('textbox', name='历史正文', exact=True)).to_have_value(first_text)
                    # A restore uses the editor's current read version; an external
                    # edit between preview and restore must survive unchanged.
                    note.write_text('外部新增内容')
                    panel.get_by_role('button', name='恢复此版本', exact=True).click()
                    expect(panel.get_by_role('status')).to_have_text('版本冲突')
                    expect(body).to_have_value('第二次保存的内容')
                    assert note.read_text() == '外部新增内容'
                    # Reload a clean editor, preview again, restore through the UI.
                    page.reload()
                    page.get_by_role('button', name='Close', exact=True).click()
                    page.get_by_role('button', name='笔记', exact=True).click()
                    panel.get_by_role('button', name='可恢复.md', exact=True).click()
                    expect(body).to_have_value('外部新增内容')
                    panel.get_by_role('button', name='版本历史', exact=True).click()
                    listing.get_by_role('button').filter(has_text=first_hash).last.click()
                    panel.get_by_role('button', name='恢复此版本', exact=True).click()
                    expect(panel.get_by_role('status')).to_have_text('已保存')
                    expect(body).to_have_value(first_text)
                    assert note.read_text() == first_text
                    # Stale deletion fails as well; then re-read by reopening.
                    note.write_text('不能被误删的外部版本')
                    page.once('dialog', lambda dialog: dialog.accept())
                    panel.get_by_role('button', name='移入回收站', exact=True).click()
                    expect(panel.get_by_role('status')).to_have_text('版本冲突')
                    assert note.read_text() == '不能被误删的外部版本'
                    panel.get_by_role('button', name='可恢复.md', exact=True).click()
                    expect(body).to_have_value('不能被误删的外部版本')
                    page.once('dialog', lambda dialog: dialog.accept())
                    panel.get_by_role('button', name='移入回收站', exact=True).click()
                    expect(body).to_have_value('')
                    assert not note.exists()
                    panel.get_by_role('button', name='回收站', exact=True).click()
                    trash = panel.get_by_role('region', name='回收站列表')
                    expect(trash.get_by_role('button', name='恢复已删除笔记', exact=True)).to_have_count(1)
                    note.write_text('占用原路径的新笔记')
                    trash.get_by_role('button', name='恢复已删除笔记', exact=True).click()
                    expect(panel.get_by_role('alert').filter(has_text='笔记已变化')).to_be_visible()
                    assert note.read_text() == '占用原路径的新笔记'
                    trash.get_by_role('textbox').fill('另一个恢复文件.md')
                    trash.get_by_role('button', name='恢复已删除笔记', exact=True).click()
                    expect(panel.get_by_role('alert').filter(has_text='已恢复为')).to_be_visible()
                    assert (vault / '另一个恢复文件.md').read_text() == '不能被误删的外部版本'
                    assert note.read_text() == '占用原路径的新笔记'
                    identity = context.request.post(origin + '/api/corilo-notes/identity', data={}).json()['value']
                    assert identity['recoveryEnabled'] is True
                    mismatch = context.request.post(origin + '/api/corilo-notes/save', headers={'x-corilo-library-id': 'wrong-library'}, data={'path': '禁止跨库.md', 'text': 'wrong root', 'expected': None}).json()
                    assert mismatch['error']['code'] == 'notes/library-changed'
                    assert not (vault / '禁止跨库.md').exists()
                    assert not any(x.name.startswith('.') for x in vault.iterdir()), 'Recovery state belongs outside the notes root'
                    assert not errors, errors
                    assert not external, external
                    browser.close()
                process.terminate()
                assert process.wait(timeout=10) == 0
                print('Harness recovery Chromium passed: version preview/restore, stale restore/delete refusal, recoverable deletion, non-overwriting trash restore, root identity fence, no model calls.')
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()


if __name__ == '__main__':
    main()
