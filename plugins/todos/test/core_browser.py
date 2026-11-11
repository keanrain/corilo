"""Current todo UI against published Harness; synthetic data, no model calls."""
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import time
import uuid
from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parents[1]


def wait_for(check, timeout=40):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        value = check()
        if value:
            return value
        time.sleep(.05)
    raise AssertionError('Timed out waiting for real Harness or database evidence')


def main():
    with tempfile.TemporaryDirectory(prefix='corilo-core-todos-') as temp:
        base = pathlib.Path(temp)
        data = base / 'todos'
        # Seed old-format data with the real store. Current UI/API must leave it
        # unchanged; only complete export includes retired cancelled records.
        seed = subprocess.run(['node', '--input-type=module', '-e', '''
          import {TodoStore} from './storage.mjs';import {randomUUID} from 'node:crypto';
          const store=await TodoStore.open(process.argv[1]);
          const linked=await store.create({requestId:randomUUID(),title:'已有待办',body:'旧说明',notePath:'原有/关联.md'});
          const old=await store.create({requestId:randomUUID(),title:'已退役的取消记录',body:'保留原样'});
          const cancelled=await store.update({requestId:randomUUID(),id:old.id,expected:old.version,patch:{status:'cancelled'}});
          console.log(JSON.stringify({linked,cancelled,identity:store.identity}));store.close();
        ''', str(data)], cwd=ROOT, text=True, capture_output=True, check=True)
        old = json.loads(seed.stdout)
        patch = base / 'overlay.json'
        patch.write_text(json.dumps([{'insert': [{'id': 'corilo-todos', 'name': str(ROOT / 'index.mjs'), 'config': {'root': str(data)}}]},
            {'id': 'workspace-controller', 'config': {'documentsDirectory': str(base / 'workspace')}}]))
        log_path = base / 'host.log'
        with log_path.open('w') as log:
            host = subprocess.Popen(['node', str(ROOT / 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--patch', str(patch), '--no-open', '--port', '0'], cwd=base,
                stdout=log, stderr=log, env=dict(os.environ, HOME=str(base / 'home'), DSH_HOME=str(base / 'runtime'), DSH_AGENTS_HOME=str(base / 'agents'), XDG_CONFIG_HOME=str(base / 'config')))
            try:
                def address():
                    assert host.poll() is None
                    match = re.search(r'dsh web: (http://127\.0\.0\.1:\d+/\?[^\s\x1b]+)', log_path.read_text())
                    return match[1] if match else None
                url = wait_for(address)
                origin = url.split('/?')[0]
                with sync_playwright() as p:
                    browser = p.chromium.launch(headless=True, executable_path=shutil.which('chromium') or None)
                    context = browser.new_context(viewport={'width': 1400, 'height': 950}, accept_downloads=True)
                    context.add_init_script('''window.todoDbOpens=0;const original=indexedDB.open.bind(indexedDB);
                      indexedDB.open=(name,...args)=>{if(String(name).startsWith('corilo-todos')){window.todoDbOpens++;throw Error('No todo draft database expected');}return original(name,...args);};''')
                    errors, external, mutations = [], [], []
                    context.on('request', lambda req: external.append(req.url.split('?')[0]) if req.url.startswith('http') and not req.url.startswith(origin + '/') else None)
                    context.on('request', lambda req: mutations.append(req.post_data_json) if re.search('/api/corilo-todos/(create|update)$', req.url) else None)
                    page = context.new_page()
                    page.on('pageerror', lambda error: errors.append(str(error)))

                    def enter(target):
                        target.goto(url)
                        target.get_by_role('button', name='Continue', exact=True).or_(target.get_by_role('button', name='Close', exact=True)).first.wait_for()
                        if target.get_by_role('button', name='Continue', exact=True).is_visible():
                            target.get_by_role('button', name='Continue', exact=True).click()
                        target.get_by_role('button', name='Close', exact=True).click()
                        if target.viewport_size['width'] <= 700:
                            target.get_by_role('button', name='Open sidebar', exact=True).click()
                        target.get_by_role('button', name='待办', exact=True).click()
                        if target.viewport_size['width'] <= 700:
                            target.touchscreen.tap(target.viewport_size['width'] - 8, 220)
                        result = target.get_by_role('region', name='Corilo 待办')
                        expect(result.get_by_role('textbox', name='快速新增待办')).to_be_enabled()
                        return result

                    panel = enter(page)
                    quick = panel.get_by_role('textbox', name='快速新增待办')
                    library = panel.get_by_role('complementary', name='待办列表')
                    assert panel.locator('details, .corilo-todos-drafts, .corilo-todos-extra').count() == 0
                    assert panel.get_by_role('checkbox', name='离开详情时保存').count() == 0
                    assert panel.get_by_role('button', name='已取消', exact=True).count() == 0
                    assert panel.get_by_role('button', name='新待办', exact=True).count() == 0
                    headers = {'x-corilo-todos-id': old['identity']}
                    def api(method, args):
                        result = context.request.post(origin + '/api/corilo-todos/' + method, headers=headers, data=args).json()
                        assert result['ok'], result
                        return result['value']
                    for args in [{'status': 'cancelled'}]:
                        assert not context.request.post(origin + '/api/corilo-todos/list', headers=headers, data=args).json()['ok']
                    for patch_fields in [{'status': 'cancelled'}, {'notePath': '新/路径.md'}]:
                        result = context.request.post(origin + '/api/corilo-todos/update', headers=headers, data={'requestId': str(uuid.uuid4()), 'id': old['linked']['id'], 'expected': 1, 'patch': patch_fields}).json()
                        assert not result['ok']
                    assert api('identity', {})['id'] == old['identity']
                    assert len(api('list', {'status': 'all'})['items']) == 1
                    assert 'notePath' not in api('get', {'id': old['linked']['id']})
                    for title in ['整理读书笔记', '准备周末清单']:
                        quick.fill(title)
                        quick.press('Enter')
                        expect(quick).to_have_value('')
                        expect(quick).to_be_focused()
                        expect(library.get_by_role('button', name=title, exact=True)).to_be_visible()
                    library.get_by_role('button', name='已有待办', exact=True).click()
                    body = panel.get_by_role('textbox', name='待办说明')
                    expect(body).to_have_value('旧说明')
                    assert panel.get_by_role('textbox', name='关联笔记路径').count() == 0
                    assert panel.get_by_role('button', name='保存待办', exact=True).count() == 0
                    # Completion and reopening from a stale detail must use the
                    # same explicit reconciliation as stale text edits. A list
                    # refresh alone must not leave the checkbox retrying forever.
                    for action, original_status, target in [('完成待办', 'open', 'done'), ('重新打开待办', 'done', 'open')]:
                        stale = api('get', {'id': old['linked']['id']})
                        remote_body = '另一设备修改，准备' + action
                        latest = api('update', {'requestId': str(uuid.uuid4()), 'id': stale['id'], 'expected': stale['version'], 'patch': {'body': remote_body}})
                        checkbox = panel.get_by_role('checkbox', name=action, exact=True)
                        before = len(mutations)
                        checkbox.click()
                        compare = panel.get_by_role('button', name='查看最新待办', exact=True)
                        expect(compare).to_be_visible()
                        expect(checkbox).to_be_disabled()
                        expect(body).to_have_value(stale['body'])
                        expect(panel.locator('.corilo-todos-save-state')).to_have_text('版本冲突')
                        page.wait_for_timeout(200)
                        assert len(mutations) == before + 1, 'Conflicts must not automatically retry'
                        assert mutations[-1]['expected'] == stale['version']
                        assert api('get', {'id': stale['id']}) == latest
                        assert latest['status'] == original_status
                        compare.click()
                        expect(panel.get_by_role('textbox', name='最新待办说明')).to_have_value(remote_body)
                        page.once('dialog', lambda dialog: dialog.accept())
                        panel.get_by_role('button', name='采用最新待办', exact=True).click()
                        expect(body).to_have_value(remote_body)
                        expect(checkbox).to_be_enabled()
                        checkbox.click()
                        expect(panel.get_by_role('checkbox', name='重新打开待办' if target == 'done' else '完成待办', exact=True)).to_be_enabled()
                        result = api('get', {'id': stale['id']})
                        assert result['status'] == target
                        assert result['body'] == remote_body
                        assert result['version'] == latest['version'] + 1
                        assert mutations[-1]['expected'] == latest['version']
                    exports = []
                    downloads = []
                    page.on('request', lambda req: exports.append(req.url) if req.url.endswith('/api/corilo-todos/export') else None)
                    page.on('download', lambda item: downloads.append(item))
                    export_button = panel.get_by_role('button', name='导出待办 JSON', exact=True)
                    # Export must flush the current edit before downloading.
                    body.fill('直接导出时先保存的说明')
                    with page.expect_download() as saved_download:
                        export_button.click()
                    saved_export = json.loads(pathlib.Path(saved_download.value.path()).read_text())
                    assert next(x for x in saved_export['items'] if x['id'] == old['linked']['id'])['body'] == '直接导出时先保存的说明'
                    assert api('get', {'id': old['linked']['id']})['body'] == '直接导出时先保存的说明'
                    # Known validation failures cannot yield an incomplete export.
                    title_input = panel.get_by_role('textbox', name='待办标题', exact=True)
                    title_input.fill('')
                    count = len(exports), len(downloads)
                    export_button.click()
                    expect(panel.get_by_role('button', name='重试保存', exact=True)).to_be_visible()
                    assert (len(exports), len(downloads)) == count
                    title_input.fill('已有待办')
                    panel.get_by_role('button', name='重试保存', exact=True).click()
                    expect(panel.get_by_role('button', name='重试保存', exact=True)).to_have_count(0)
                    # A stale edit must stop export and preserve the input.
                    current = api('get', {'id': old['linked']['id']})
                    api('update', {'requestId': str(uuid.uuid4()), 'id': current['id'], 'expected': current['version'], 'patch': {'body': '外部更新，不能覆盖'}})
                    body.fill('导出前仍保留的冲突输入')
                    export_button.click()
                    expect(panel.get_by_role('button', name='查看最新待办', exact=True)).to_be_visible()
                    expect(body).to_have_value('导出前仍保留的冲突输入')
                    export_button.click()
                    page.wait_for_timeout(200)
                    assert (len(exports), len(downloads)) == count
                    panel.get_by_role('button', name='查看最新待办', exact=True).click()
                    page.once('dialog', lambda dialog: dialog.accept())
                    panel.get_by_role('button', name='采用最新待办', exact=True).click()
                    # Lost save replies also stop export until explicit same-UUID retry.
                    def lose_export_save(route):
                        assert route.fetch().json()['ok']
                        route.abort()
                    page.route('**/api/corilo-todos/update', lose_export_save, times=1)
                    body.fill('导出前保存响应丢失')
                    export_button.click()
                    retry_save = panel.get_by_role('button', name='重试保存', exact=True)
                    expect(retry_save).to_be_visible()
                    original_save = mutations[-1]
                    assert (len(exports), len(downloads)) == count
                    retry_save.click()
                    expect(retry_save).to_have_count(0)
                    assert mutations[-1] == original_save
                    with page.expect_download() as recovered_download:
                        export_button.click()
                    recovered_export = json.loads(pathlib.Path(recovered_download.value.path()).read_text())
                    assert next(x for x in recovered_export['items'] if x['id'] == current['id'])['body'] == '导出前保存响应丢失'
                    body.fill('新版只修改正文')
                    panel.get_by_role('button', name='返回列表').click()
                    assert api('get', {'id': old['linked']['id']})['body'] == '新版只修改正文'
                    # Unknown creates keep the original UUID for an explicit retry.
                    def lose(route):
                        assert route.fetch().json()['ok']
                        route.abort()
                    page.route('**/api/corilo-todos/create', lose, times=1)
                    quick.fill('新增回复丢失')
                    quick.press('Enter')
                    retry = panel.get_by_role('button', name='重试新增')
                    expect(retry).to_be_visible()
                    original = mutations[-1]
                    count = len(mutations)
                    page.wait_for_timeout(1100)
                    assert len(mutations) == count
                    assert page.evaluate("()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;}")
                    retry.click()
                    expect(quick).to_have_value('')
                    assert mutations[-1] == original
                    assert len([x for x in api('export', {})['items'] if x['title'] == '新增回复丢失']) == 1
                    # A stale detail edit must remain visible and block leaving.
                    library.get_by_role('button', name='已有待办', exact=True).click()
                    expect(body).to_have_value('新版只修改正文')
                    item = api('get', {'id': old['linked']['id']})
                    api('update', {'requestId': str(uuid.uuid4()), 'id': item['id'], 'expected': item['version'], 'patch': {'body': '另一个页面的更新'}})
                    body.fill('当前输入保留')
                    panel.get_by_role('button', name='返回列表').click()
                    expect(panel.get_by_role('button', name='查看最新待办')).to_be_visible()
                    expect(body).to_have_value('当前输入保留')
                    panel.get_by_role('button', name='查看最新待办').click()
                    page.once('dialog', lambda dialog: dialog.accept())
                    panel.get_by_role('button', name='保留输入，按最新版本编辑').click()
                    panel.get_by_role('button', name='返回列表').click()
                    assert api('get', {'id': item['id']})['body'] == '当前输入保留'
                    library.get_by_role('checkbox', name='完成：准备周末清单', exact=True).click()
                    expect(library.get_by_role('button', name='准备周末清单', exact=True)).to_have_count(0)
                    panel.get_by_role('button', name='撤销完成').click()
                    expect(library.get_by_role('button', name='准备周末清单', exact=True)).to_be_visible()
                    with page.expect_download() as download:
                        panel.get_by_role('button', name='导出待办 JSON').click()
                    exported = json.loads(pathlib.Path(download.value.path()).read_text())
                    assert exported['format'] == 'corilo-todos-v1'
                    assert next(x for x in exported['items'] if x['id'] == old['cancelled']['id']) == old['cancelled']
                    assert next(x for x in exported['items'] if x['id'] == old['linked']['id'])['notePath'] == '原有/关联.md'
                    assert page.evaluate('window.todoDbOpens') == 0
                    shots = pathlib.Path(os.environ.get('CORILO_BROWSER_ARTIFACT_DIR', str(base / 'shots')))
                    shots.mkdir(parents=True, exist_ok=True)
                    panel.screenshot(path=str(shots / 'desktop.png'))
                    phone_context = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
                    phone_context.on('request', lambda req: external.append(req.url.split('?')[0]) if req.url.startswith('http') and not req.url.startswith(origin + '/') else None)
                    phone = phone_context.new_page()
                    phone.on('pageerror', lambda error: errors.append(str(error)))
                    mobile = enter(phone)
                    assert mobile.evaluate('(el)=>el.scrollWidth<=el.clientWidth+1')
                    mobile.get_by_role('button', name='已有待办', exact=True).tap()
                    expect(mobile.get_by_role('complementary', name='待办列表')).not_to_be_visible()
                    mobile_body = mobile.get_by_role('textbox', name='待办说明')
                    mobile_body.fill('手机返回即保存')
                    mobile.get_by_role('button', name='返回列表').tap()
                    assert api('get', {'id': old['linked']['id']})['body'] == '手机返回即保存'
                    mobile.screenshot(path=str(shots / 'mobile.png'))
                    phone_context.close()
                    assert errors == [], errors
                    assert external == [], external
                    browser.close()
                print('Core todos Harness passed: no draft database/manual mode/association/cancellation/new form; core CRUD, save-on-leave, same-UUID unknown retry, text/status conflicts with explicit reconciliation, completion/undo, legacy-preserving export and desktop/mobile; zero model/external requests.')
            finally:
                host.terminate()
                host.wait(timeout=20)


if __name__ == '__main__':
    main()
