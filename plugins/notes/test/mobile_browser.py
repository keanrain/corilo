"""Chromium touch/device emulation against the real published Harness.

Android/iPhone profiles are browser emulation, not physical device or WebKit evidence.
Viewport reduction approximates keyboard space; it does not emulate a native IME.
"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile

from playwright.sync_api import sync_playwright, expect
from browser import ROOT, wait_for


def main():
    with tempfile.TemporaryDirectory(prefix='corilo-mobile-browser-') as temp:
        base = pathlib.Path(temp)
        vault = base / 'notes'
        vault.mkdir()
        (base / 'user-home').mkdir()
        existing = vault / '已有中文笔记.md'
        existing.write_text('移动端原有正文\n', encoding='utf-8')
        patch = base / 'notes.patch.json'
        patch.write_text(json.dumps([{'insert': [{'id': 'corilo-notes', 'name': str(ROOT / 'index.mjs'), 'config': {'root': str(vault), 'stateRoot': str(base / 'recovery')}}]}, {'id': 'workspace-controller', 'config': {'documentsDirectory': str(base / 'documents')}}]))
        log_path = base / 'host.log'
        with log_path.open('w') as log:
            host = subprocess.Popen(['node', str(ROOT / 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--patch', str(patch), '--no-open', '--port', '0'], cwd=base, stdout=log, stderr=log,
                env=dict(os.environ, HOME=str(base / 'user-home'), XDG_CONFIG_HOME=str(base / 'config'), DSH_HOME=str(base / 'home')))
            try:
                def address():
                    assert host.poll() is None, 'Harness exited before mobile test'
                    match = re.search(r'dsh web: (http://127\.0\.0\.1:\d+/\?[^\s\x1b]+)', log_path.read_text())
                    return match[1] if match else None
                url = wait_for(address)
                origin = url.split('/?')[0]
                with sync_playwright() as p:
                    browser = p.chromium.launch(headless=True, executable_path=shutil.which('chromium') or None)
                    for device in ['Pixel 7', 'iPhone 13']:
                        context = browser.new_context(**p.devices[device])
                        page = context.new_page()
                        errors, external, captures = [], [], []
                        page.on('pageerror', lambda error: errors.append(str(error)))
                        context.on('request', lambda req: external.append(req.url.split('?')[0]) if req.url.startswith('http') and not req.url.startswith(origin + '/') else None)
                        context.on('request', lambda req: captures.append(req.url) if '/api/corilo-notes/capture' in req.url else None)

                        def enter(first=False):
                            page.goto(url if first else origin)
                            page.get_by_role('button', name='Continue', exact=True).or_(page.get_by_role('button', name='Close', exact=True)).first.wait_for()
                            if page.get_by_role('button', name='Continue', exact=True).is_visible():
                                page.get_by_role('button', name='Continue', exact=True).tap()
                            page.get_by_role('button', name='Close', exact=True).tap()
                            page.get_by_role('button', name='Open sidebar', exact=True).tap()
                            page.get_by_role('button', name='笔记', exact=True).tap(timeout=20000)
                            panel = page.get_by_role('region', name='Corilo 笔记')
                            expect(panel).to_be_visible()
                            # The pinned Harness keeps its mobile sidebar open
                            # after selecting a plugin. Close its backdrop as a user would.
                            page.touchscreen.tap(page.viewport_size['width'] - 8, 220)
                            expect(panel.get_by_role('textbox', name='笔记正文', exact=True)).to_be_enabled()
                            panel.get_by_role('textbox', name='笔记正文', exact=True).tap(trial=True)
                            expect(page.get_by_text('Unable to create default workspace. Use Choose workspace to select a folder.', exact=True)).to_have_count(0)
                            return panel

                        def no_overflow(panel):
                            assert panel.evaluate('(el) => el.scrollWidth <= el.clientWidth + 1'), device
                            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), device

                        panel = enter(first=True)
                        body = panel.get_by_role('textbox', name='笔记正文', exact=True)
                        status = panel.get_by_role('status')
                        capture = panel.get_by_role('button', name='仅保存原话', exact=True)
                        expect(status).to_have_text('开始记录')
                        expect(capture).to_be_disabled()
                        body.fill(' ')
                        expect(capture).to_be_enabled()
                        body.fill('')
                        expect(capture).to_be_disabled()
                        no_overflow(panel)
                        expect(panel.get_by_role('textbox', name='搜索笔记')).not_to_be_visible()
                        first_body = body.bounding_box()
                        assert first_body and first_body['y'] < 300 and first_body['height'] >= 150, 'Core editor must be visible immediately on mobile'
                        artifact_dir = os.environ.get('CORILO_BROWSER_ARTIFACT_DIR')
                        if artifact_dir:
                            pathlib.Path(artifact_dir).mkdir(parents=True, exist_ok=True)
                            page.screenshot(path=str(pathlib.Path(artifact_dir) / ('notes-first-' + device.replace(' ', '-').lower() + '.png')), animations='disabled')
                        assert body.evaluate('(el) => parseFloat(getComputedStyle(el).fontSize)') >= 16
                        text = f'  {device} 中文原话 MobileNeedle\n第二行，零模型  '
                        body.fill(text)
                        expect(capture).to_be_enabled()
                        # Simulate space occupied by the keyboard. Focus/edit and
                        # scroll real touch controls into a reduced visible viewport.
                        page.set_viewport_size({'width': 390, 'height': 400})
                        body.tap(position={'x': 12, 'y': 12})
                        # No scroll-to-save: the narrow-screen save bar stays
                        # reachable while the editor itself has focus.
                        box = capture.bounding_box()
                        assert box and box['height'] >= 44 and 0 <= box['y'] < 400 and box['y'] + box['height'] <= 400
                        capture.tap()
                        expect(status).to_have_text('已保存')
                        captured = [item for item in vault.rglob('*.md') if item.read_text() == text]
                        assert len(captured) == 1 and len(captures) == 1
                        capture_path = captured[0].relative_to(vault).as_posix()
                        page.set_viewport_size({'width': 390, 'height': 844})
                        expect(panel.get_by_role('button', name='版本历史', exact=True)).not_to_be_visible()
                        more = panel.get_by_text('更多操作', exact=True)
                        assert more.bounding_box()['height'] >= 44
                        more.tap()
                        panel.get_by_role('button', name='版本历史', exact=True).tap()
                        expect(panel.get_by_role('region', name='版本历史列表').get_by_role('button')).to_have_count(1)
                        panel.get_by_role('button', name='回收站', exact=True).tap()
                        expect(panel.get_by_role('region', name='回收站列表')).to_contain_text('回收站为空')
                        more.tap()
                        panel.get_by_role('button', name='查找笔记', exact=True).tap()
                        library = panel.get_by_role('complementary', name='笔记列表')
                        library.get_by_role('textbox', name='搜索笔记').fill('MobileNeedle')
                        library.get_by_role('button', name='搜索', exact=True).tap()
                        library.get_by_role('button', name=capture_path, exact=True).tap()
                        expect(body).to_have_value(text)
                        expect(library).not_to_be_visible()
                        body.fill('')
                        expect(panel.get_by_role('button', name='保存笔记', exact=True)).to_be_enabled()
                        long_draft = 'https://example.invalid/' + 'a' * 300 + f'\n{device} 持久中文草稿'
                        body.fill(long_draft)
                        expect(panel.get_by_test_id('draft-persistence')).to_have_text('草稿已保存在此浏览器，尚未保存到文件。')
                        # Save failure must retain the editor, and a reload must
                        # recover that exact draft without touching disk.
                        page.route('**/api/corilo-notes/save', lambda route: route.abort())
                        panel.get_by_role('button', name='保存笔记', exact=True).tap()
                        expect(status).to_have_text('保存失败')
                        expect(body).to_have_value(long_draft)
                        assert captured[0].read_text() == text
                        page.unroute('**/api/corilo-notes/save')
                        page.once('dialog', lambda dialog: dialog.accept())
                        panel = enter()
                        candidates = panel.get_by_role('region', name='待恢复草稿')
                        candidates.locator('details').first.locator('summary').first.tap()
                        candidate = candidates.locator('li').filter(has_text=capture_path)
                        candidate.get_by_text('预览草稿', exact=True).tap()
                        expect(candidate.get_by_role('textbox', name='草稿正文预览')).to_have_value(long_draft)
                        no_overflow(panel)
                        candidate.get_by_role('button', name='恢复草稿', exact=True).tap()
                        expect(body).to_have_value(long_draft)
                        assert captured[0].read_text() == text
                        for width in [320, 390, 700]:
                            page.set_viewport_size({'width': width, 'height': 600})
                            no_overflow(panel)
                        # Landscape uses the regular two-column layout; controls
                        # remain reachable by normal page scrolling.
                        page.set_viewport_size({'width': 844, 'height': 390})
                        no_overflow(panel)
                        panel.get_by_role('button', name='保存笔记', exact=True).tap()
                        expect(status).to_have_text('已保存')
                        assert captured[0].read_text() == long_draft
                        artifact_dir = os.environ.get('CORILO_BROWSER_ARTIFACT_DIR')
                        if artifact_dir:
                            target = pathlib.Path(artifact_dir)
                            target.mkdir(parents=True, exist_ok=True)
                            page.set_viewport_size({'width': 390, 'height': 400})
                            body.evaluate('(el) => el.scrollIntoView({block: "start"})')
                            page.screenshot(path=str(target / ('notes-mobile-' + device.replace(' ', '-').lower() + '.png')))
                        assert not errors, errors
                        assert not external, external
                        context.close()
                    browser.close()
                host.terminate()
                assert host.wait(timeout=10) == 0
                print('Harness mobile Chromium passed: Pixel/iPhone touch profiles, native sidebar entry, Chinese capture/search, reduced viewport save, 320–700px and landscape layout, failed save/draft reload/recover; zero external/model requests. No physical device, native IME, or WebKit claim.')
            finally:
                if host.poll() is None:
                    host.kill()
                    host.wait()


if __name__ == '__main__':
    main()
