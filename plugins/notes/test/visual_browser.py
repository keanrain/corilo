"""Astryx token adaptation in the real Harness, light/dark and narrow/desktop.

No React 19 component runtime is imported. Scheme changes follow the host's
native system preference. Screenshots use synthetic notes and contain no URL.
"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile

from playwright.sync_api import sync_playwright, expect
from browser import ROOT, wait_for, manual_saves


def main():
    with tempfile.TemporaryDirectory(prefix='corilo-notes-visual-') as temp:
        base = pathlib.Path(temp)
        (base / 'notes').mkdir()
        (base / 'user-home').mkdir()
        note = base / 'notes/每周记录.md'
        note.write_text('# 每周记录\n\n把重要的事情记下来，留一点空间慢慢想。\n', encoding='utf-8')
        patch = base / 'notes.patch.json'
        patch.write_text(json.dumps([
            {'insert': [{'id': 'corilo-notes', 'name': str(ROOT / 'index.mjs'), 'config': {'root': str(base / 'notes'), 'stateRoot': str(base / 'state')}}]},
            {'id': 'workspace-controller', 'config': {'documentsDirectory': str(base / 'documents')}}
        ]))
        with (base / 'host.log').open('w') as log:
            process = subprocess.Popen(['node', str(ROOT / 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--patch', str(patch), '--no-open', '--port', '0'], cwd=base, stdout=log, stderr=log,
                env=dict(os.environ, HOME=str(base / 'user-home'), DSH_HOME=str(base / 'harness'), DSH_AGENTS_HOME=str(base / 'agents')))
            try:
                def address():
                    assert process.poll() is None, 'Harness exited before visual checks'
                    match = re.search(r'dsh web: (http://127\.0\.0\.1:\d+/\?[^\s\x1b]+)', (base / 'host.log').read_text())
                    return match[1] if match else None
                url = wait_for(address)
                origin = url.split('/?')[0]
                artifact_dir = pathlib.Path(os.environ['CORILO_BROWSER_ARTIFACT_DIR']) if os.environ.get('CORILO_BROWSER_ARTIFACT_DIR') else base / 'screenshots'
                artifact_dir.mkdir(parents=True, exist_ok=True)
                with sync_playwright() as p:
                    browser = p.chromium.launch(headless=True, executable_path=shutil.which('chromium') or None)
                    for scheme in ['light', 'dark']:
                        context = browser.new_context(viewport={'width': 1280, 'height': 900}, color_scheme=scheme)
                        errors, external = [], []
                        context.on('request', lambda req: external.append(req.url.split('?')[0]) if req.url.startswith('http') and not req.url.startswith(origin + '/') else None)
                        page = context.new_page()
                        page.on('pageerror', lambda error: errors.append(str(error)))
                        page.goto(url)
                        page.get_by_role('button', name='Continue', exact=True).or_(page.get_by_role('button', name='Close', exact=True)).first.wait_for()
                        if page.get_by_role('button', name='Continue', exact=True).is_visible():
                            page.get_by_role('button', name='Continue', exact=True).click()
                        page.get_by_role('button', name='Close', exact=True).click()
                        page.get_by_role('button', name='笔记', exact=True).click()
                        panel = page.get_by_role('region', name='Corilo 笔记')
                        expect(panel).to_have_attribute('data-ui', 'astryx-neutral')
                        body = panel.get_by_role('textbox', name='笔记正文', exact=True)
                        expect(body).to_be_enabled()
                        manual_saves(panel)
                        wait_for(lambda: page.evaluate('getComputedStyle(document.documentElement).colorScheme') == scheme)
                        host_style = page.evaluate('({bg:getComputedStyle(document.body).backgroundColor, scheme:document.documentElement.style.colorScheme})')
                        assert page.evaluate('getComputedStyle(document.body).getPropertyValue("--ax-color-accent")') == '', 'Plugin tokens leaked to host body'
                        assert panel.evaluate('(el) => getComputedStyle(el).backgroundColor') == ('rgb(255, 255, 255)' if scheme == 'light' else 'rgb(38, 38, 38)')
                        panel.get_by_role('button', name='每周记录.md', exact=True).click()
                        expect(body).to_have_value(note.read_text())
                        primary = panel.get_by_role('button', name='保存笔记', exact=True)
                        expect(primary).to_be_enabled()
                        expected_primary = 'rgb(27, 27, 27)' if scheme == 'light' else 'rgb(241, 241, 241)'
                        wait_for(lambda: primary.evaluate('(el) => getComputedStyle(el).backgroundColor') == expected_primary)
                        body.focus()
                        assert body.evaluate('(el) => getComputedStyle(el).outlineStyle') == 'solid'
                        assert body.evaluate('(el) => parseFloat(getComputedStyle(el).outlineWidth)') >= 2
                        page.screenshot(path=str(artifact_dir / f'notes-{scheme}-desktop.png'), animations='disabled')
                        page.set_viewport_size({'width': 390, 'height': 844})
                        panel.evaluate('(el) => el.scrollTo({top:0})')
                        assert panel.evaluate('(el) => el.scrollWidth <= el.clientWidth + 1')
                        assert body.evaluate('(el) => parseFloat(getComputedStyle(el).fontSize)') >= 16
                        assert 150 <= body.bounding_box()['height'] <= 270, 'Mobile editor should leave room for save and recovery feedback'
                        assert primary.bounding_box()['height'] >= 44
                        page.screenshot(path=str(artifact_dir / f'notes-{scheme}-mobile.png'), animations='disabled')
                        # State styling does not replace business feedback or hide drafts.
                        body.fill('一段尚未保存的中文。')
                        expect(panel.get_by_role('status')).to_have_text('未保存')
                        expect(panel.get_by_test_id('draft-persistence')).to_have_text('草稿已保存在此浏览器，尚未保存到文件。')
                        page.route('**/api/corilo-notes/save', lambda route: route.abort())
                        primary.click()
                        expect(panel.get_by_role('status')).to_have_text('保存失败')
                        expect(body).to_have_value('一段尚未保存的中文。')
                        assert panel.get_by_role('status').evaluate('(el) => getComputedStyle(el).color') != panel.evaluate('(el) => getComputedStyle(el).color')
                        page.screenshot(path=str(artifact_dir / f'notes-{scheme}-failure.png'), animations='disabled')
                        assert page.evaluate('({bg:getComputedStyle(document.body).backgroundColor, scheme:document.documentElement.style.colorScheme})') == host_style
                        assert not errors, errors
                        assert not external, external
                        context.close()
                    browser.close()
                process.terminate()
                assert process.wait(timeout=10) == 0
                print('Harness notes visual checks passed: Astryx token marker, native light/dark scheme, desktop/390px controls, primary/focus/failure states, input retention and no host token/style leakage; zero model/external requests.')
            finally:
                if process.poll() is None:
                    process.kill(); process.wait()


if __name__ == '__main__':
    main()
