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
                    body.fill('直接开始写作，自动建立文档')
                    expect(panel.get_by_role('status')).to_have_text('已保存', timeout=10000)
                    assert (vault / '未命名.md').read_text() == '直接开始写作，自动建立文档'
                    assert mutations == ['create']

                    panel.get_by_role('button', name='自动保存.md', exact=True).click()
                    expect(body).to_have_value('原始正文\n')
                    # The timer belongs to the plugin, including while its page
                    # is unmounted by navigation to another Harness panel.
                    background = '切换其他页面后仍保存到主机'
                    body.fill(background)
                    page.get_by_role('button', name='Plugins', exact=True).click()
                    wait_for(lambda: (page.wait_for_timeout(25), note.read_text() == background)[1], timeout=10)
                    page.get_by_role('button', name='笔记', exact=True).click()
                    expect(body).to_have_value(background)
                    expect(panel.get_by_role('status')).to_have_text('已保存')
                    body.fill('原始正文\n')
                    expect(panel.get_by_role('status')).to_have_text('已保存', timeout=10000)
                    # The manual-workflow preference survives leaving the
                    # plugin panel, without silently saving when it remounts.
                    panel.locator('details.corilo-notes-more > summary').click()
                    panel.get_by_role('checkbox', name='自动保存', exact=True).uncheck()
                    panel.locator('details.corilo-notes-more > summary').click()
                    body.fill('关闭自动保存后的未保存输入')
                    before = len(mutations)
                    page.get_by_role('button', name='Plugins', exact=True).click()
                    page.get_by_role('button', name='笔记', exact=True).click()
                    expect(body).to_have_value('关闭自动保存后的未保存输入')
                    page.wait_for_timeout(1400)
                    assert len(mutations) == before and note.read_text() == '原始正文\n'
                    panel.locator('details.corilo-notes-more > summary').click()
                    option = panel.get_by_role('checkbox', name='自动保存', exact=True)
                    expect(option).not_to_be_checked()
                    option.check()
                    panel.locator('details.corilo-notes-more > summary').click()
                    body.fill('  自动保存保持原话\r\n第二行  ')
                    expect(panel.get_by_role('status')).to_have_text('已保存', timeout=10000)
                    # Textarea normalizes browser input line endings; the host
                    # receives precisely its current value, without formatting.
                    assert note.read_text() == body.input_value()

                    # Hold a committed response, then keep typing. The first
                    # reply must never replace the newer in-memory text.
                    held = []
                    def hold_save(route):
                        held.append((route, route.fetch()))
                    page.route('**/api/corilo-notes/save', hold_save, times=1)
                    body.fill('提交快照 A')
                    expect(panel.get_by_role('status')).to_have_text('保存中…', timeout=10000)
                    expect(body).to_be_enabled()
                    wait_for(lambda: held or page.wait_for_timeout(20))
                    body.fill('提交快照 A，期间继续输入 B')
                    assert note.read_text() == '提交快照 A'
                    page.get_by_role('button', name='Plugins', exact=True).click()
                    held[0][0].fulfill(response=held[0][1])
                    wait_for(lambda: (page.wait_for_timeout(25), note.read_text() == '提交快照 A，期间继续输入 B')[1], timeout=10)
                    page.get_by_role('button', name='笔记', exact=True).click()
                    expect(body).to_have_value('提交快照 A，期间继续输入 B')
                    expect(panel.get_by_role('status')).to_have_text('已保存', timeout=10000)
                    assert note.read_text() == body.input_value()

                    # IME composition defers automatic writes until it ends.
                    before = len(mutations)
                    body.dispatch_event('compositionstart')
                    body.fill('中文输入法正在组字')
                    page.wait_for_timeout(1400)
                    assert len(mutations) == before
                    body.dispatch_event('compositionend')
                    expect(panel.get_by_role('status')).to_have_text('已保存', timeout=10000)
                    assert note.read_text() == '中文输入法正在组字'

                    # A failed write that did not commit still stays paused
                    # across further typing, reload, recovery and more typing.
                    page.route('**/api/corilo-notes/save', lambda route: route.abort(), times=1)
                    body.fill('未提交的失败输入')
                    expect(panel.get_by_role('status')).to_have_text('保存失败', timeout=10000)
                    body.fill('失败后继续输入，暂停标记不能消失')
                    expect(panel.get_by_test_id('draft-persistence')).to_contain_text('草稿已保存在此浏览器')
                    page.once('dialog', lambda dialog: dialog.accept())
                    page.reload()
                    page.get_by_role('button', name='Close', exact=True).click()
                    page.get_by_role('button', name='笔记', exact=True).click()
                    open_drafts(panel)
                    panel.get_by_role('region', name='待恢复草稿').locator('li').filter(has_text='自动保存.md').get_by_role('button', name='恢复草稿', exact=True).click()
                    expect(body).to_have_value('失败后继续输入，暂停标记不能消失')
                    before = len(mutations)
                    body.fill('恢复后继续输入，仍需明确保存')
                    page.wait_for_timeout(1400)
                    assert len(mutations) == before
                    assert note.read_text() == '中文输入法正在组字'
                    body.press('Control+s')
                    expect(panel.get_by_role('status')).to_have_text('已保存')
                    assert note.read_text() == '恢复后继续输入，仍需明确保存'

                    # Commit A, type the original O while the reply is held,
                    # then lose that reply. O still needs recovery even though
                    # it equals the pre-request original; disk may now contain A.
                    original = body.input_value()
                    held = []
                    page.route('**/api/corilo-notes/save', hold_save, times=1)
                    body.fill('服务已提交但回复丢失')
                    expect(panel.get_by_role('status')).to_have_text('保存中…', timeout=10000)
                    wait_for(lambda: held or page.wait_for_timeout(20))
                    body.fill(original)
                    held[0][0].abort()
                    expect(panel.get_by_role('status')).to_have_text('保存失败', timeout=10000)
                    assert note.read_text() == '服务已提交但回复丢失'
                    expect(panel.get_by_test_id('draft-persistence')).to_contain_text('草稿已保存在此浏览器')
                    page.once('dialog', lambda dialog: dialog.accept())
                    page.reload()
                    page.get_by_role('button', name='Close', exact=True).click()
                    page.get_by_role('button', name='笔记', exact=True).click()
                    open_drafts(panel)
                    panel.get_by_role('region', name='待恢复草稿').locator('li').filter(has_text='自动保存.md').get_by_role('button', name='恢复草稿', exact=True).click()
                    expect(body).to_have_value(original)
                    expect(panel.get_by_role('status')).to_have_text('版本冲突')
                    before = len(mutations)
                    body.fill('失败后继续写，等待人工核对')
                    page.wait_for_timeout(1400)
                    assert len(mutations) == before
                    expect(body).to_have_value('失败后继续写，等待人工核对')

                    # Reload/recover keeps the original expected version and
                    # does not write. Stale recovery reports conflict.
                    expect(panel.get_by_test_id('draft-persistence')).to_contain_text('草稿已保存在此浏览器')
                    page.once('dialog', lambda dialog: dialog.accept())
                    page.reload()
                    page.get_by_role('button', name='Close', exact=True).click()
                    page.get_by_role('button', name='笔记', exact=True).click()
                    open_drafts(panel)
                    panel.get_by_role('region', name='待恢复草稿').locator('li').filter(has_text='自动保存.md').get_by_role('button', name='恢复草稿', exact=True).click()
                    expect(body).to_have_value('失败后继续写，等待人工核对')
                    expect(panel.get_by_role('status')).to_have_text('版本冲突')
                    before = len(mutations)
                    page.wait_for_timeout(1400)
                    assert len(mutations) == before
                    assert note.read_text() == '服务已提交但回复丢失'

                    # Preview is a safe read-only projection; no host mutation,
                    # scripts, embedded resources or plaintext formatting loss.
                    sample = '# 预览标题\n\n**重点** 和 *斜体*\n\n| 列 | 值 |\n| --- | --- |\n| 一 | 二 |\n\n```js\n<script>alert(1)</script>\n```\n\n[安全链接](https://example.invalid/path)\n\n![图片](https://example.invalid/track.png)\n\n<script>window.previewAttack=1</script>\n<img src="https://example.invalid/raw.png" onerror="window.previewAttack=2">\n\n[危险](javascript:alert(1))\n'
                    body.fill(sample)
                    panel.get_by_role('button', name='实时预览', exact=True).click()
                    preview = panel.get_by_role('region', name='Markdown 实时预览')
                    expect(preview.get_by_role('heading', name='预览标题')).to_be_visible()
                    expect(preview.locator('table')).to_have_count(1)
                    expect(preview.locator('strong')).to_have_text('重点')
                    expect(preview.locator('pre code')).to_contain_text('<script>alert(1)</script>')
                    assert preview.locator('img,iframe,script,style,object,embed').count() == 0
                    assert preview.locator('[href^="javascript:"],[onerror],[style]').count() == 0
                    safe_link = preview.get_by_role('link', name='安全链接')
                    expect(safe_link).to_have_attribute('target', '_blank')
                    expect(safe_link).to_have_attribute('rel', 'noopener noreferrer')
                    assert page.evaluate('window.previewAttack') is None
                    expect(body).to_have_value(sample)
                    assert len(mutations) == before
                    artifact_dir = os.environ.get('CORILO_BROWSER_ARTIFACT_DIR')
                    if artifact_dir:
                        destination = pathlib.Path(artifact_dir)
                        destination.mkdir(parents=True, exist_ok=True)
                        page.screenshot(path=str(destination / 'notes-live-preview-desktop.png'), animations='disabled')
                    page.set_viewport_size({'width': 390, 'height': 844})
                    expect(body).not_to_be_visible()
                    expect(preview).to_be_visible()
                    assert panel.evaluate('(el) => el.scrollWidth <= el.clientWidth + 1')
                    if artifact_dir:
                        page.screenshot(path=str(destination / 'notes-live-preview-mobile.png'), animations='disabled')
                    panel.get_by_role('button', name='编辑', exact=True).click()
                    expect(body).to_be_visible()
                    # Oversize preview is explicit, bounded and never truncates
                    # the editable/saved source.
                    large = '# 大篇\n' + '文字' * 70000
                    body.fill(large)
                    panel.get_by_role('button', name='实时预览', exact=True).click()
                    expect(preview).to_contain_text('超过 128 Ki 字符')
                    assert panel.locator('textarea[aria-label="笔记正文"]').input_value() == large
                    assert len(mutations) == before
                    panel.get_by_role('button', name='新笔记', exact=True).click()
                    expect(panel.get_by_role('alert').filter(has_text='请先核对').first).to_be_visible()
                    assert panel.locator('textarea[aria-label="笔记正文"]').input_value() == large
                    assert len(mutations) == before
                    assert not errors, errors
                    assert not external, external
                    context.close()
                    browser.close()
                host.terminate()
                assert host.wait(timeout=10) == 0
                print('Harness editor Chromium passed: automatic first document, versioned debounce, typing during in-flight save, IME, lost-reply pause, recovered stale draft without automatic write, markdown/table/code preview, sanitized links/no resource loads, 390px view switch and explicit preview size bound; zero model/external requests.')
            finally:
                if host.poll() is None:
                    host.kill()
                    host.wait()


if __name__ == '__main__':
    main()
