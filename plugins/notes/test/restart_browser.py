"""Published Harness restarted through the Corilo CLI on one loopback port.

Synthetic data only. This tests process restart, not a machine reboot or systemd.
The same browser origin, knowledge root and Harness home are retained.
"""
import json
import os
import pathlib
import re
import shutil
import socket
import subprocess
import tempfile

from playwright.sync_api import sync_playwright, expect
from browser import ROOT, wait_for, manual_saves, open_drafts


def main():
    with tempfile.TemporaryDirectory(prefix='corilo-restart-browser-') as temp:
        base = pathlib.Path(temp)
        for name in ['user-home', 'harness', 'agents', 'documents']:
            (base / name).mkdir()
        env = dict(os.environ, HOME=str(base / 'user-home'),
                   XDG_CONFIG_HOME=str(base / 'config'),
                   DSH_HOME=str(base / 'harness'), DSH_AGENTS_HOME=str(base / 'agents'))
        # Public home-level patch avoids depending on Linux xdg-user-dir in
        # this isolated fixture; Corilo's overlay remains a strict single plugin.
        (base / 'harness/cordis.patch.yml').write_text(json.dumps([
            {'id': 'workspace-controller', 'config': {'documentsDirectory': str(base / 'documents')}}
        ]))
        config = base / 'notes.patch.json'
        cli = ROOT / 'cli.mjs'
        subprocess.run(['node', str(cli), 'init', '--root', str(base / 'notes'),
                        '--state-root', str(base / 'state'), '--config', str(config)],
                       cwd=base, env=env, capture_output=True, check=True)
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            port = reservation.getsockname()[1]
        origin = f'http://127.0.0.1:{port}'
        process = None
        logs = []

        def start(iteration):
            nonlocal process
            log_path = base / f'host-{iteration}.log'
            log = log_path.open('w')
            logs.append(log)
            process = subprocess.Popen(['node', str(cli), 'start', '--config', str(config), '--port', str(port)],
                                       cwd=base, env=env, stdout=log, stderr=log)

            def address():
                assert process.poll() is None, 'CLI exited before Harness readiness'
                match = re.search(r'dsh web: (http://127\.0\.0\.1:\d+/\?[^\s\x1b]+)', log_path.read_text())
                return match[1] if match else None

            url = wait_for(address)
            assert url.split('/?')[0] == origin
            return url

        def stop():
            process.terminate()
            assert process.wait(timeout=15) == 0, 'CLI did not forward a clean SIGTERM shutdown'

        try:
            url = start(1)
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True, executable_path=shutil.which('chromium') or None)
                context = browser.new_context(viewport={'width': 1280, 'height': 1000})
                anonymous = p.request.new_context()
                errors, external, captures = [], [], []
                context.on('request', lambda req: external.append(req.url.split('?')[0])
                           if req.url.startswith('http') and not req.url.startswith(origin + '/') else None)
                context.on('request', lambda req: captures.append(req.url.split('?')[0])
                           if '/api/corilo-notes/capture' in req.url else None)
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))

                def anonymous_refused():
                    assert anonymous.get(origin).status == 401
                    assert anonymous.post(origin + '/api/corilo-notes/list', data={}).status == 401

                def enter(target, first=False):
                    page.goto(target)
                    page.get_by_role('button', name='Continue', exact=True).or_(page.get_by_role('button', name='Close', exact=True)).first.wait_for()
                    if first:
                        page.get_by_role('button', name='Continue', exact=True).click()
                    page.get_by_role('button', name='Close', exact=True).click()
                    page.get_by_role('button', name='笔记', exact=True).click()
                    panel = page.get_by_role('region', name='Corilo 笔记')
                    expect(panel.get_by_role('textbox', name='笔记正文', exact=True)).to_be_enabled()
                    expect(page.get_by_text('Unable to create default workspace. Use Choose workspace to select a folder.', exact=True)).to_have_count(0)
                    manual_saves(panel)
                    return panel

                anonymous_refused()
                panel = enter(url, first=True)
                body = panel.get_by_role('textbox', name='笔记正文', exact=True)
                saved_text = '服务重启前已保存的中文正文\n'
                body.fill(saved_text)
                panel.get_by_role('button', name='仅保存原话', exact=True).click()
                expect(panel.get_by_role('status')).to_have_text('已保存')
                captured = list((base / 'notes/收集').glob('*.md'))
                assert len(captured) == 1 and captured[0].read_text() == saved_text
                relative = captured[0].relative_to(base / 'notes').as_posix()
                if panel.locator('details.corilo-notes-more').get_attribute('open') is None:
                    panel.locator('details.corilo-notes-more > summary').click()
                panel.get_by_role('button', name='版本历史', exact=True).click()
                listing = panel.get_by_role('region', name='版本历史列表')
                expect(listing.get_by_role('button')).to_have_count(1)
                revision_label = listing.get_by_role('button').inner_text()
                draft = '服务重启期间保留的浏览器草稿，尚未落盘\n'
                body.fill(draft)
                expect(panel.get_by_test_id('draft-persistence')).to_have_text('草稿已保存在此浏览器，尚未保存到文件。')
                assert captured[0].read_text() == saved_text
                assert len(captures) == 1
                stop()
                next_url = start(2)
                # Launch tokens are process scoped; the persistent signed
                # browser cookie is retained by Harness's credential provider.
                assert next_url != url, 'Harness should rotate its process launch token'
                anonymous_refused()
                assert anonymous.get(url).status == 401, 'Previous launch token must not admit a fresh browser'
                page.once('dialog', lambda dialog: dialog.accept())
                panel = enter(origin)
                assert page.url.rstrip('/') == origin
                open_drafts(panel)
                candidates = panel.get_by_role('region', name='待恢复草稿')
                candidate = candidates.locator('li').filter(has_text=relative)
                candidate.get_by_text('预览草稿', exact=True).click()
                expect(candidate.get_by_role('textbox', name='草稿正文预览')).to_have_value(draft)
                open_drafts(panel)
                candidate.get_by_role('button', name='恢复草稿', exact=True).click()
                expect(body).to_have_value(draft)
                assert captured[0].read_text() == saved_text, 'Draft recovery must not write a file'
                if panel.locator('details.corilo-notes-more').get_attribute('open') is None:
                    panel.locator('details.corilo-notes-more > summary').click()
                panel.get_by_role('button', name='版本历史', exact=True).click()
                expect(listing.get_by_role('button')).to_have_count(1)
                expect(listing.get_by_role('button')).to_have_text(revision_label)
                listing.get_by_role('button').click()
                expect(panel.get_by_role('textbox', name='历史正文', exact=True)).to_have_value(saved_text)
                panel.get_by_role('button', name='保存笔记', exact=True).click()
                expect(panel.get_by_role('status')).to_have_text('已保存')
                assert captured[0].read_text() == draft
                assert len(captures) == 1, 'Restart and reconnect must not duplicate capture'
                assert not errors, errors
                assert not external, external
                anonymous.dispose()
                browser.close()
            stop()
            print('Harness CLI restart Chromium passed: fixed loopback port, persistent browser authentication, rotated launch token, anonymous 401, notes/history and IndexedDB draft recovery, no duplicate capture or model/external requests. Process restart only; no systemd/reboot claim.')
        finally:
            if process and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            for log in logs:
                log.close()


if __name__ == '__main__':
    main()
