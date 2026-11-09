"""Browser draft recovery against the published Harness and two real disk roots."""
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright, expect
from browser import ROOT, wait_for, manual_saves, open_drafts


def main():
    with tempfile.TemporaryDirectory(prefix='corilo-drafts-browser-') as temp:
        base = pathlib.Path(temp)
        (base / 'user-home').mkdir()
        first_root, second_root = base / 'first-notes', base / 'second-notes'
        first_root.mkdir()
        second_root.mkdir()
        note = first_root / '已有笔记.md'
        note.write_text('原始磁盘内容\n')
        (second_root / '已有笔记.md').write_text('另一个知识库\n')
        child = None
        logs = []

        def launch(root, port=0):
            nonlocal child
            patch = base / 'notes.patch.yml'
            patch.write_text(json.dumps([{'insert': [{'id': 'corilo-notes', 'name': str(ROOT / 'index.mjs'), 'config': {'root': str(root)}}]}]))
            log_path = base / f'host-{len(logs)}.log'
            log = log_path.open('w')
            logs.append(log)
            child = subprocess.Popen(['node', str(ROOT / 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--patch', str(patch), '--no-open', '--port', str(port)], cwd=base, stdout=log, stderr=log,
                env=dict(os.environ, HOME=str(base / 'user-home'), XDG_CONFIG_HOME=str(base / 'config'), DSH_HOME=str(base / 'home')))

            def address():
                assert child.poll() is None, 'Harness exited before draft browser test'
                match = re.search(r'dsh web: (http://127\.0\.0\.1:\d+/\?[^\s\x1b]+)', log_path.read_text())
                return match[1] if match else None
            return wait_for(address)

        def stop():
            if child and child.poll() is None:
                child.terminate()
                assert child.wait(timeout=10) == 0

        def enter(page, url, first=False):
            page.goto(url)
            if first:
                page.get_by_role('button', name='Continue', exact=True).click()
            page.get_by_role('button', name='Close', exact=True).click()
            page.get_by_role('button', name='笔记', exact=True).click()
            panel = page.get_by_role('region', name='Corilo 笔记')
            expect(panel.get_by_test_id('draft-persistence')).not_to_have_text('正在读取浏览器草稿…')
            manual_saves(panel)
            return panel

        try:
            url = launch(first_root)
            port = urlsplit(url).port
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True, executable_path=shutil.which('chromium') or None)
                context = browser.new_context(viewport={'width': 1280, 'height': 900})
                # Exercise the real Harness plugin with the secure-context-only
                # API absent, as on a plain HTTP LAN origin. No Host is mocked.
                context.add_init_script("Object.defineProperty(Crypto.prototype, 'randomUUID', { value: undefined, configurable: true });")
                errors, external = [], []
                context.on('page', lambda page: page.on('pageerror', lambda error: errors.append(str(error))))
                context.on('request', lambda req: external.append(req.url.split('?')[0]) if req.url.startswith('http') and not req.url.startswith(f'http://127.0.0.1:{port}/') else None)
                page = context.new_page()
                # Accept the browser's genuine unsaved-page warning during these
                # explicit reload/restart checks. The warning itself remains enabled.
                dialogs = []
                page.on('dialog', lambda dialog: (dialogs.append(dialog.type), dialog.accept()))
                panel = enter(page, url, first=True)
                body = panel.get_by_role('textbox', name='笔记正文', exact=True)
                panel.get_by_role('button', name='已有笔记.md', exact=True).click()
                body.fill('浏览器持久草稿\n尚未写磁盘')
                expect(panel.get_by_test_id('draft-persistence')).to_contain_text('草稿已保存在此浏览器')
                assert note.read_text() == '原始磁盘内容\n'
                page.get_by_role('button', name='Plugins', exact=True).click()
                # Draft protection and the leave guard outlive the notes panel.
                panel = enter(page, url)
                assert 'beforeunload' in dialogs, 'Unsaved warning must survive switching away from notes'
                open_drafts(panel)
                expect(panel.get_by_role('region', name='待恢复草稿')).to_be_visible()
                expect(body).to_have_value('')
                open_drafts(panel)
                panel.get_by_role('button', name='恢复草稿', exact=True).click()
                expect(body).to_have_value('浏览器持久草稿\n尚未写磁盘')
                assert note.read_text() == '原始磁盘内容\n'
                expect(panel.get_by_test_id('draft-persistence')).to_contain_text('草稿已保存在此浏览器')
                note.write_text('磁盘已由其他设备更新\n')
                panel = enter(page, url)
                open_drafts(panel)
                panel.get_by_role('button', name='恢复草稿', exact=True).click()
                expect(body).to_have_value('浏览器持久草稿\n尚未写磁盘')
                expect(panel.get_by_role('status')).to_have_text('版本冲突')
                assert note.read_text() == '磁盘已由其他设备更新\n'
                panel.get_by_role('button', name='草稿另存为新笔记', exact=True).click()
                expect(panel.get_by_role('status')).to_have_text('已保存')
                assert any(path.read_text() == '浏览器持久草稿\n尚未写磁盘' for path in first_root.rglob('*.md'))
                # Two live pages share IndexedDB but own independent records.
                # The observer deliberately acts on a candidate read before the
                # writer protects newer text, for both recovery and discard.
                concurrent = browser.new_context(viewport={'width': 1280, 'height': 900})
                concurrent.on('page', lambda opened: opened.on('pageerror', lambda error: errors.append(str(error))))
                writer, observer = concurrent.new_page(), concurrent.new_page()
                for opened in [writer, observer]:
                    opened.on('dialog', lambda dialog: dialog.accept())
                writer_panel = enter(writer, url)
                writer_body = writer_panel.get_by_role('textbox', name='笔记正文', exact=True)
                writer_panel.get_by_role('textbox', name='笔记标题', exact=True).fill('并发草稿.md')
                writer_body.fill('旧草稿 A1')
                expect(writer_panel.get_by_test_id('draft-persistence')).to_contain_text('草稿已保存在此浏览器')
                observer_panel = enter(observer, url)
                open_drafts(observer_panel)
                expect(observer_panel.get_by_role('region', name='待恢复草稿')).to_be_visible()
                writer_body.fill('较新草稿 A2')
                expect(writer_panel.get_by_test_id('draft-persistence')).to_contain_text('草稿已保存在此浏览器')
                open_drafts(observer_panel)
                observer_panel.get_by_role('button', name='恢复草稿', exact=True).click()
                expect(observer_panel.get_by_role('textbox', name='笔记正文', exact=True)).to_have_value('旧草稿 A1')
                expect(observer_panel.get_by_role('alert')).to_contain_text('较新版本已保留')
                open_drafts(observer_panel)
                expect(observer_panel.get_by_role('region', name='待恢复草稿')).to_be_visible()
                writer_body.fill('最新草稿 A3')
                expect(writer_panel.get_by_test_id('draft-persistence')).to_contain_text('草稿已保存在此浏览器')
                observer_panel.get_by_role('button', name='丢弃草稿', exact=True).click()
                expect(observer_panel.get_by_role('alert')).to_contain_text('较新版本已保留')
                # Read the actual browser database after the transaction settles;
                # neither stale action may erase the writer's latest recovery copy.
                saved_texts = observer.evaluate("""async () => {
                  const db = await new Promise((resolve, reject) => {
                    const request = indexedDB.open('corilo-notes-drafts', 1);
                    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
                  });
                  try { return await new Promise((resolve, reject) => {
                    const request = db.transaction('drafts').objectStore('drafts').getAll();
                    request.onsuccess = () => resolve(request.result.map(record => record.draft.text));
                    request.onerror = () => reject(request.error);
                  }); } finally { db.close(); }
                }""")
                assert '最新草稿 A3' in saved_texts and '旧草稿 A1' in saved_texts
                assert not (first_root / '并发草稿.md').exists()
                concurrent.close()
                # A new unsaved draft remains recoverable only for its own root.
                panel.get_by_role('button', name='新笔记', exact=True).click()
                body.fill('属于第一个知识库的私有草稿')
                expect(panel.get_by_test_id('draft-persistence')).to_contain_text('草稿已保存在此浏览器')
                stop()
                other_url = launch(second_root, port)
                panel = enter(page, other_url)
                expect(panel.get_by_role('region', name='待恢复草稿')).to_have_count(0)
                expect(body).to_have_value('')
                panel.get_by_role('button', name='已有笔记.md', exact=True).click()
                expect(body).to_have_value('另一个知识库\n')
                stop()
                original_url = launch(first_root, port)
                panel = enter(page, original_url)
                open_drafts(panel)
                expect(panel.get_by_role('region', name='待恢复草稿')).to_be_visible()
                open_drafts(panel)
                panel.get_by_role('button', name='恢复草稿', exact=True).click()
                expect(body).to_have_value('属于第一个知识库的私有草稿')
                expect(panel.get_by_test_id('draft-persistence')).to_contain_text('草稿已保存在此浏览器')
                # Browser storage rejection must stay visible while ordinary file
                # saving remains usable. This is a browser fault, not a fake Host.
                broken = browser.new_context(viewport={'width': 1280, 'height': 900})
                broken.add_init_script("indexedDB.open = () => { throw new DOMException('blocked', 'SecurityError'); };")
                broken_page = broken.new_page()
                broken_page.on('dialog', lambda dialog: dialog.accept())
                broken_panel = enter(broken_page, original_url)
                expect(broken_panel.get_by_test_id('draft-persistence')).to_have_text('草稿保护失败，请保存文件后再关闭。')
                expect(broken_panel.get_by_role('alert')).to_contain_text('浏览器草稿保护不可用')
                broken_body = broken_panel.get_by_role('textbox', name='笔记正文', exact=True)
                broken_body.fill('草稿存储失败仍可保存文件')
                broken_panel.get_by_role('button', name='仅保存原话', exact=True).click()
                expect(broken_panel.get_by_role('status')).to_have_text('已保存')
                assert any(path.read_text() == '草稿存储失败仍可保存文件' for path in first_root.rglob('*.md'))
                broken.close()
                assert not errors, errors
                assert not external, external
                browser.close()
            stop()
            print('Harness draft Chromium passed: IndexedDB recovery, panel-switch reload, no automatic disk overwrite, stale-version conflict/copy, concurrent stale recovery/discard preserves newer drafts, root isolation on same origin, visible storage failure with file-save fallback.')
        finally:
            if child and child.poll() is None:
                child.kill()
                child.wait()
            for log in logs:
                log.close()


if __name__ == '__main__':
    main()
