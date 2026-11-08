"""Actual Harness UI reload recovery, request identity and library isolation.

Chromium uses synthetic local data. No model or external service is involved.
"""
import json
import os
import pathlib
import re
import shutil
import socket
import subprocess
import tempfile
import uuid

from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parents[1]


def main():
    with tempfile.TemporaryDirectory(prefix='corilo-todo-drafts-harness-') as temp:
        base = pathlib.Path(temp)
        for directory in ['user-home', 'harness', 'agents', 'documents']:
            (base / directory).mkdir()
        with socket.socket() as reserved:
            reserved.bind(('127.0.0.1', 0))
            port = reserved.getsockname()[1]
        origin = f'http://127.0.0.1:{port}'
        patch = base / 'todos.patch.json'
        env = dict(os.environ, HOME=str(base / 'user-home'), DSH_HOME=str(base / 'harness'),
                   DSH_AGENTS_HOME=str(base / 'agents'), XDG_CONFIG_HOME=str(base / 'config'))
        host = None
        streams = []

        def start(name):
            nonlocal host
            patch.write_text(json.dumps([
                {'insert': [{'id': 'corilo-todos', 'name': str(ROOT / 'index.mjs'), 'config': {'root': str(base / name)}}]},
                {'id': 'workspace-controller', 'config': {'documentsDirectory': str(base / 'documents')}}
            ]))
            log_path = base / f'{name}-{len(streams)}.log'
            log = log_path.open('w')
            streams.append(log)
            host = subprocess.Popen(['node', str(ROOT / 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--patch', str(patch), '--no-open', '--port', str(port)], cwd=base, stdout=log, stderr=log, env=env)
            import time
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                assert host.poll() is None, 'Harness exited before readiness'
                match = re.search(r'dsh web: (http://127\.0\.0\.1:\d+/\?[^\s\x1b]+)', log_path.read_text())
                if match:
                    return match[1]
                time.sleep(.1)
            raise AssertionError('Harness readiness timed out')

        def stop():
            host.terminate()
            assert host.wait(timeout=15) == 0

        try:
            url = start('todos-a')
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True, executable_path=shutil.which('chromium') or None)
                context = browser.new_context(viewport={'width': 1280, 'height': 1000})
                page = context.new_page()
                errors, external, creates, updates = [], [], [], []
                page.on('pageerror', lambda error: errors.append(str(error)))
                context.on('request', lambda req: external.append(req.url.split('?')[0]) if req.url.startswith('http') and not req.url.startswith(origin + '/') else None)
                context.on('request', lambda req: creates.append(req.post_data_json) if '/api/corilo-todos/create' in req.url else None)
                context.on('request', lambda req: updates.append(req.post_data_json) if '/api/corilo-todos/update' in req.url else None)

                def enter(target, address=origin):
                    target.goto(address)
                    target.get_by_role('button', name='Continue', exact=True).or_(target.get_by_role('button', name='Close', exact=True)).first.wait_for()
                    if target.get_by_role('button', name='Continue', exact=True).is_visible():
                        target.get_by_role('button', name='Continue', exact=True).click()
                    target.get_by_role('button', name='Close', exact=True).click()
                    target.get_by_role('button', name='待办', exact=True).click(timeout=20000)
                    panel = target.get_by_role('region', name='Corilo 待办')
                    expect(panel).to_be_visible()
                    return panel

                # The UI-specific selectors below intentionally exercise the
                # production page, rather than importing the draft module.
                panel = enter(page, url)
                quick = panel.get_by_role('textbox', name='快速新增待办', exact=True)
                expect(quick).to_be_enabled()
                quick.fill('刷新后继续记录的中文待办')
                expect(panel.get_by_test_id('todo-draft-persistence')).to_contain_text('草稿已保存在此浏览器')
                page.once('dialog', lambda dialog: dialog.accept())
                panel = enter(page)
                panel.get_by_text(re.compile(r'^恢复草稿（\d+）$')).click()
                recovery = panel.get_by_role('region', name='待恢复待办草稿')
                expect(recovery).to_be_visible()
                recovery.get_by_role('button', name='恢复草稿', exact=True).first.click()
                expect(quick).to_have_value('刷新后继续记录的中文待办')
                assert creates == [], 'Restore must not create a todo automatically'

                def lost_reply(route):
                    response = route.fetch()
                    assert response.json()['ok'] is True
                    route.abort()
                page.route('**/api/corilo-todos/create', lost_reply)
                panel.get_by_role('button', name='添加', exact=True).click()
                expect(panel.get_by_role('button', name='重试新增', exact=True)).to_be_visible()
                expect(panel.get_by_test_id('todo-draft-persistence')).to_contain_text('草稿已保存在此浏览器')
                page.unroute('**/api/corilo-todos/create')
                original_request = creates[-1]
                page.once('dialog', lambda dialog: dialog.accept())
                panel = enter(page)
                count = len(creates)
                panel.get_by_text(re.compile(r'^恢复草稿（\d+）$')).click()
                panel.get_by_role('region', name='待恢复待办草稿').get_by_role('button', name='恢复草稿', exact=True).first.click()
                expect(panel.get_by_role('button', name='重试新增', exact=True)).to_be_visible()
                assert len(creates) == count, 'Unknown result recovery must not automatically retry'
                panel.get_by_role('button', name='重试新增', exact=True).click()
                expect(quick).to_have_value('')
                assert creates[-1] == original_request, 'Explicit retry must preserve its exact UUID and payload'
                identity = context.request.post(origin + '/api/corilo-todos/identity', data={}).json()['value']['id']
                exported = context.request.post(origin + '/api/corilo-todos/export', headers={'x-corilo-todos-id': identity}, data={}).json()['value']
                assert len(exported['items']) == 1, 'Reload retry must not duplicate the committed todo'

                # Preserve the originally read integer version when restoring
                # an editor draft. New disk content must still cause a conflict.
                saved = exported['items'][0]
                panel.get_by_role('button', name=saved['title'], exact=True).click()
                body = panel.get_by_role('textbox', name='待办说明', exact=True)
                body.fill('恢复后的详情仍沿用旧版本')
                expect(panel.get_by_test_id('todo-draft-persistence')).to_contain_text('草稿已保存在此浏览器')
                changed = context.request.post(origin + '/api/corilo-todos/update', headers={'x-corilo-todos-id': identity}, data={
                    'requestId': str(uuid.uuid4()), 'id': saved['id'], 'expected': saved['version'], 'patch': {'body': '其他页面的较新内容'}
                }).json()
                assert changed['ok'] is True
                page.once('dialog', lambda dialog: dialog.accept())
                panel = enter(page)
                panel.get_by_text(re.compile(r'^恢复草稿（\d+）$')).click()
                panel.get_by_role('region', name='待恢复待办草稿').get_by_role('button', name='恢复草稿', exact=True).first.click()
                expect(body).to_have_value('恢复后的详情仍沿用旧版本')
                panel.get_by_role('button', name='保存待办', exact=True).click()
                expect(panel.get_by_role('status')).to_have_text('版本冲突')
                expect(body).to_have_value('恢复后的详情仍沿用旧版本')
                panel.get_by_role('button', name='查看最新待办', exact=True).click()
                page.once('dialog', lambda dialog: dialog.accept())
                panel.get_by_role('button', name='采用最新待办', exact=True).click()
                expect(body).to_have_value('其他页面的较新内容')

                # A lost row-completion acknowledgement also survives reload;
                # restore and retry retain its exact update UUID and version.
                page.route('**/api/corilo-todos/update', lost_reply)
                panel.get_by_role('checkbox', name='完成：' + saved['title'], exact=True).click()
                expect(panel.get_by_role('button', name='重试列表操作', exact=True)).to_be_visible()
                expect(panel.get_by_test_id('todo-draft-persistence')).to_contain_text('草稿已保存在此浏览器')
                page.unroute('**/api/corilo-todos/update')
                original_update = updates[-1]
                page.once('dialog', lambda dialog: dialog.accept())
                panel = enter(page)
                panel.get_by_text(re.compile(r'^恢复草稿（\d+）$')).click()
                panel.get_by_role('region', name='待恢复待办草稿').get_by_role('button', name='恢复草稿', exact=True).first.click()
                expect(panel.get_by_role('button', name='重试列表操作', exact=True)).to_be_visible()
                count_updates = len(updates)
                panel.get_by_role('button', name='重试列表操作', exact=True).click()
                expect(panel.get_by_role('button', name='撤销完成', exact=True)).to_be_visible()
                assert len(updates) == count_updates + 1 and updates[-1] == original_update
                item = context.request.post(origin + '/api/corilo-todos/get', headers={'x-corilo-todos-id': identity}, data={'id': saved['id']}).json()['value']
                assert item['version'] == changed['value']['version'] + 1 and item['status'] == 'done'
                panel.get_by_role('button', name='撤销完成', exact=True).click()
                expect(panel.get_by_role('button', name=saved['title'], exact=True)).to_be_visible()

                quick.fill('仅属于资料库 A 的草稿')
                expect(panel.get_by_test_id('todo-draft-persistence')).to_contain_text('草稿已保存在此浏览器')
                stop()
                url_b = start('todos-b')
                page.once('dialog', lambda dialog: dialog.accept())
                panel = enter(page, url_b)
                expect(quick).to_have_value('')
                expect(panel.get_by_role('region', name='待恢复待办草稿')).to_have_count(0)
                stop()
                url_a = start('todos-a')
                panel = enter(page, url_a)
                panel.get_by_text(re.compile(r'^恢复草稿（\d+）$')).click()
                recovery = panel.get_by_role('region', name='待恢复待办草稿')
                expect(recovery).to_be_visible()
                recovery.get_by_role('button', name='恢复草稿', exact=True).first.click()
                expect(quick).to_have_value('仅属于资料库 A 的草稿')

                failed_context = browser.new_context(viewport={'width': 1280, 'height': 1000})
                failed_context.add_init_script("IDBFactory.prototype.open = function () { throw Error('synthetic IDB failure'); };")
                failed_context.on('request', lambda req: external.append(req.url.split('?')[0]) if req.url.startswith('http') and not req.url.startswith(origin + '/') else None)
                failed = failed_context.new_page()
                failed.on('pageerror', lambda error: errors.append(str(error)))
                failed_panel = enter(failed, url_a)
                expect(failed_panel.get_by_text('浏览器草稿保护不可用', exact=False)).to_be_visible()
                failed_panel.get_by_role('textbox', name='快速新增待办', exact=True).fill('存储失败仍可直接保存')
                failed_panel.get_by_role('button', name='添加', exact=True).click()
                expect(failed_panel.get_by_role('textbox', name='快速新增待办', exact=True)).to_have_value('')
                failed_export = failed_context.request.post(origin + '/api/corilo-todos/export', headers={'x-corilo-todos-id': identity}, data={}).json()['value']
                assert len(failed_export['items']) == 2
                assert not errors, errors
                assert not external, external
                failed_context.close()
                context.close()
                browser.close()
            stop()
            print('Harness todo drafts Chromium passed: reload recovery, original editor version conflicts, quick/row unknown-result retries with original UUIDs, no duplicate mutations, SQLite identity isolation on same origin and visible IndexedDB failure with direct-save fallback; zero model/external requests.')
        finally:
            if host and host.poll() is None:
                host.kill()
                host.wait()
            for stream in streams:
                stream.close()


if __name__ == '__main__':
    main()
