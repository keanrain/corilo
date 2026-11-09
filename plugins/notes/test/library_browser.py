"""Large synthetic library + draft handoff in the published Harness, no model."""
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
    with tempfile.TemporaryDirectory(prefix='corilo-library-browser-') as temp:
        base = pathlib.Path(temp)
        vault = base / 'notes'
        vault.mkdir()
        (base / 'user-home').mkdir()
        for index in range(2010):
            (vault / f'{index:04}.md').write_text(f'合成笔记 {index}\n', encoding='utf-8')
        large_text = 'x' * (1024 * 1024 - 100) + '\n后页大文件结束\n'
        for index in range(9):
            (vault / f'z-large-{index:02}.md').write_text(large_text, encoding='utf-8')
        assert len(list(vault.glob('*.md'))) > 2000
        assert sum(path.stat().st_size for path in vault.glob('*.md')) > 8 * 1024 * 1024
        note_a = vault / '0000.md'
        original_a = note_a.read_text()
        patch = base / 'notes.patch.yml'
        patch.write_text(json.dumps([{'insert': [{'id': 'corilo-notes', 'name': str(ROOT / 'index.mjs'), 'config': {'root': str(vault)}}]}]))
        log_path = base / 'host.log'
        with log_path.open('w') as log:
            host = subprocess.Popen(['node', str(ROOT / 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--patch', str(patch), '--no-open', '--port', '0'], cwd=base, stdout=log, stderr=log,
                env=dict(os.environ, HOME=str(base / 'user-home'), XDG_CONFIG_HOME=str(base / 'config'), DSH_HOME=str(base / 'home')))
            try:
                def address():
                    assert host.poll() is None, 'Harness exited before large library test'
                    match = re.search(r'dsh web: (http://127\.0\.0\.1:\d+/\?[^\s\x1b]+)', log_path.read_text())
                    return match[1] if match else None
                url = wait_for(address)
                origin = url.split('/?')[0]
                with sync_playwright() as p:
                    browser = p.chromium.launch(headless=True, executable_path=shutil.which('chromium') or None)
                    context = browser.new_context(viewport={'width': 1280, 'height': 900})
                    page = context.new_page()
                    errors, external, captures = [], [], []
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    context.on('request', lambda req: external.append(req.url.split('?')[0]) if req.url.startswith('http') and not req.url.startswith(origin + '/') else None)
                    context.on('request', lambda req: captures.append(req.url) if '/api/corilo-notes/capture' in req.url else None)

                    def enter(first=False):
                        page.goto(url if first else origin)
                        if first:
                            page.get_by_role('button', name='Continue', exact=True).click()
                        page.get_by_role('button', name='Close', exact=True).click()
                        page.get_by_role('button', name='笔记', exact=True).click()
                        panel = page.get_by_role('region', name='Corilo 笔记')
                        expect(panel.get_by_role('textbox', name='笔记正文', exact=True)).to_be_enabled()
                        manual_saves(panel)
                        return panel

                    panel = enter(first=True)
                    library = panel.get_by_role('complementary', name='笔记列表')
                    body = panel.get_by_role('textbox', name='笔记正文', exact=True)
                    status = panel.get_by_role('status')
                    expect(library.locator('ul > li')).to_have_count(100)
                    expect(library.get_by_role('button', name='0100.md', exact=True)).to_have_count(0)
                    library.get_by_role('button', name='加载更多笔记', exact=True).click()
                    expect(library.locator('ul > li')).to_have_count(200)
                    library.get_by_role('button', name='0100.md', exact=True).click()
                    expect(body).to_have_value('合成笔记 100\n')

                    library.get_by_text('按路径打开', exact=True).click()
                    library.get_by_role('textbox', name='要打开的笔记路径', exact=True).fill('z-large-08.md')
                    library.get_by_role('button', name='打开路径', exact=True).click()
                    expect(panel.get_by_role('textbox', name='笔记文件名', exact=True)).to_have_value('z-large-08.md')
                    assert body.input_value() == large_text

                    # Ordinary capture remains zero-model even in a library
                    # beyond the legacy list count/aggregate-body budgets.
                    panel.get_by_role('button', name='新笔记', exact=True).click()
                    capture_text = '  自动命名正文搜索针 LibraryNeedle873\n第二行保留  '
                    body.fill(capture_text)
                    panel.get_by_role('button', name='仅保存原话', exact=True).click()
                    expect(status).to_have_text('已保存')
                    captured = list((vault / '收集').glob('*.md'))
                    assert len(captured) == 1 and captured[0].read_text() == capture_text
                    capture_path = captured[0].relative_to(vault).as_posix()
                    search = library.get_by_role('textbox', name='搜索笔记', exact=True)
                    search.fill('LibraryNeedle873')
                    library.get_by_role('button', name='搜索', exact=True).click()
                    expect(library.get_by_role('button', name=capture_path, exact=True)).to_be_visible(timeout=20000)
                    expect(library.locator('ul > li')).to_have_count(1)
                    expect(library.get_by_text(re.compile('第 1 行 ·'))).to_be_visible()
                    library.get_by_role('button', name=capture_path, exact=True).click()
                    expect(body).to_have_value(capture_text)
                    assert len(captures) == 1

                    library.get_by_role('button', name='刷新列表', exact=True).click()
                    library.get_by_role('button', name='0000.md', exact=True).click()
                    expect(body).to_have_value(original_a)
                    draft_a = 'A 的未保存完整草稿\n' + '后续正文。' * 30
                    body.fill(draft_a)
                    panel.get_by_role('button', name='新笔记', exact=True).click()
                    expect(body).to_have_value('')
                    candidate_a = panel.get_by_role('region', name='待恢复草稿').locator('li').filter(has_text='0000.md')
                    expect(candidate_a).to_have_count(1)
                    candidate_a.get_by_text('预览草稿', exact=True).click()
                    expect(candidate_a.get_by_role('textbox', name='草稿正文预览', exact=True)).to_have_value(draft_a)
                    assert note_a.read_text() == original_a
                    panel.get_by_role('textbox', name='笔记文件名', exact=True).fill('B.md')
                    body.fill('B 已保存正文')
                    panel.get_by_role('button', name='保存笔记', exact=True).click()
                    expect(status).to_have_text('已保存')
                    assert (vault / 'B.md').read_text() == 'B 已保存正文'
                    candidate_a.get_by_role('button', name='恢复草稿', exact=True).click()
                    expect(body).to_have_value(draft_a)
                    assert note_a.read_text() == original_a

                    # Clicking another file must also retain the active draft.
                    library.get_by_role('button', name='0001.md', exact=True).click()
                    expect(body).to_have_value('合成笔记 1\n')
                    draft_c = 'C 当前编辑草稿，刷新后仍保留'
                    body.fill(draft_c)
                    expect(panel.get_by_test_id('draft-persistence')).to_have_text('草稿已保存在此浏览器，尚未保存到文件。')
                    panel = enter()
                    body = panel.get_by_role('textbox', name='笔记正文', exact=True)
                    candidates = panel.get_by_role('region', name='待恢复草稿')
                    candidate_a = candidates.locator('li').filter(has_text='0000.md')
                    candidate_c = candidates.locator('li').filter(has_text='0001.md')
                    expect(candidate_a).to_have_count(1)
                    expect(candidate_c).to_have_count(1)
                    candidate_a.get_by_text('预览草稿', exact=True).click()
                    expect(candidate_a.get_by_role('textbox', name='草稿正文预览', exact=True)).to_have_value(draft_a)
                    candidate_c.get_by_role('button', name='恢复草稿', exact=True).click()
                    expect(body).to_have_value(draft_c)
                    # Restoring A while C is unsaved retains C as a candidate.
                    candidate_a.get_by_role('button', name='恢复草稿', exact=True).click()
                    expect(body).to_have_value(draft_a)
                    expect(candidates.locator('li').filter(has_text='0001.md')).to_have_count(1)
                    assert note_a.read_text() == original_a
                    assert (vault / '0001.md').read_text() == '合成笔记 1\n'
                    assert not errors, errors
                    assert not external, external
                    browser.close()
                host.terminate()
                assert host.wait(timeout=10) == 0
                print('Harness library Chromium passed: >2000 files/>8MiB, pagination, large direct read, capture-body search, draft stash/preview/reload/handoff; zero external/model requests.')
            finally:
                if host.poll() is None:
                    host.kill()
                    host.wait()


if __name__ == '__main__':
    main()
