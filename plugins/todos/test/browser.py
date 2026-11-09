"""Real published Harness + Corilo personal todos, synthetic data only.

Chromium desktop and 390px touch emulation are not physical phone acceptance.
No model, external service, credentials or existing user data are used.
"""
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


def wait_for(check, timeout=45):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = check()
        if result:
            return result
        time.sleep(.1)
    raise AssertionError('Timed out waiting for real Harness evidence')


def manual_saves(panel):
    """Preserve explicit-save reliability scenarios via the visible setting."""
    more = panel.locator('details.corilo-todos-more')
    was_open = more.get_attribute('open') is not None
    if not was_open:
        more.locator('summary').first.click()
    panel.get_by_role('checkbox', name='离开详情时保存', exact=True).uncheck()
    if not was_open:
        more.locator('summary').first.click()
    panel.evaluate('(el) => el.scrollTo({top: 0})')


def main():
    with tempfile.TemporaryDirectory(prefix='corilo-todos-browser-') as temp:
        base = pathlib.Path(temp)
        for directory in ['user-home', 'harness', 'agents', 'documents']:
            (base / directory).mkdir()
        patch = base / 'todos.patch.json'
        patch.write_text(json.dumps([
            {'insert': [
                {'id': 'corilo-todos', 'name': str(ROOT / 'index.mjs'), 'config': {'root': str(base / 'todos')}},
                {'id': 'corilo-notes', 'name': str(ROOT.parent / 'notes/index.mjs'), 'config': {'root': str(base / 'notes'), 'stateRoot': str(base / 'notes-state')}}
            ]},
            {'id': 'workspace-controller', 'config': {'documentsDirectory': str(base / 'documents')}}
        ]))
        log_path = base / 'host.log'
        with log_path.open('w') as log:
            host = subprocess.Popen(['node', str(ROOT / 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--patch', str(patch), '--no-open', '--port', '0'],
                cwd=base, stdout=log, stderr=log, env=dict(os.environ, HOME=str(base / 'user-home'), DSH_HOME=str(base / 'harness'), DSH_AGENTS_HOME=str(base / 'agents'), XDG_CONFIG_HOME=str(base / 'config')))
            try:
                def address():
                    assert host.poll() is None, 'Harness exited before readiness'
                    match = re.search(r'dsh web: (http://127\.0\.0\.1:\d+/\?[^\s\x1b]+)', log_path.read_text())
                    return match[1] if match else None
                url = wait_for(address)
                origin = url.split('/?')[0]
                with sync_playwright() as p:
                    browser = p.chromium.launch(headless=True, executable_path=shutil.which('chromium') or None)
                    context = browser.new_context(viewport={'width': 1280, 'height': 1000}, accept_downloads=True)
                    page = context.new_page()
                    errors, external, creates = [], [], []
                    context.on('request', lambda req: external.append(req.url.split('?')[0]) if req.url.startswith('http') and not req.url.startswith(origin + '/') else None)
                    context.on('request', lambda req: creates.append(req.post_data_json) if '/api/corilo-todos/create' in req.url else None)
                    context.on('page', lambda new: new.on('pageerror', lambda error: errors.append(str(error))))
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    anonymous = p.request.new_context()
                    assert anonymous.get(origin).status == 401
                    assert anonymous.post(origin + '/api/corilo-todos/list', data={}).status == 401

                    def enter(target, first=False):
                        target.goto(url if first else origin)
                        target.get_by_role('button', name='Continue', exact=True).or_(target.get_by_role('button', name='Close', exact=True)).first.wait_for()
                        if target.get_by_role('button', name='Continue', exact=True).is_visible():
                            target.get_by_role('button', name='Continue', exact=True).click()
                        target.get_by_role('button', name='Close', exact=True).click()
                        narrow = target.viewport_size['width'] <= 700
                        if narrow:
                            target.get_by_role('button', name='Open sidebar', exact=True).click()
                        target.get_by_role('button', name='待办', exact=True).click(timeout=20000)
                        if narrow:
                            target.mouse.click(target.viewport_size['width'] - 8, 220)
                            target.wait_for_function("() => document.getAnimations().every(animation => animation.playState !== 'running')")
                        panel = target.get_by_role('region', name='Corilo 待办')
                        expect(panel).to_be_visible()
                        manual_saves(panel)
                        return panel

                    panel = enter(page, first=True)
                    # Both plugins are genuinely mounted in one host. Write a
                    # referenced note through its own direct UI, without a model.
                    note_text = '这篇笔记由笔记页面保存，待办只关联它的相对路径。\n'
                    page.get_by_role('button', name='笔记', exact=True).click()
                    notes_panel = page.get_by_role('region', name='Corilo 笔记')
                    notes_more = notes_panel.locator('details.corilo-notes-more > summary')
                    notes_more.click()
                    notes_panel.get_by_role('checkbox', name='自动保存', exact=True).uncheck()
                    notes_more.click()
                    notes_panel.get_by_role('textbox', name='笔记标题', exact=True).fill('读书/第二章.md')
                    notes_panel.get_by_role('textbox', name='笔记正文', exact=True).fill(note_text)
                    notes_panel.get_by_role('button', name='保存笔记', exact=True).click()
                    expect(notes_panel.get_by_role('status')).to_have_text('已保存')
                    assert (base / 'notes/读书/第二章.md').read_text() == note_text
                    page.get_by_role('button', name='待办', exact=True).click()
                    identity = context.request.post(origin + '/api/corilo-todos/identity', data={}).json()['value']['id']
                    headers = {'x-corilo-todos-id': identity}

                    def api(method, args, extra=None):
                        response = context.request.post(origin + '/api/corilo-todos/' + method, data=args, headers={**headers, **(extra or {})})
                        assert response.status == 200
                        result = response.json()
                        assert result['ok'], result
                        return result['value']

                    # The page API stays behind the host's own auth/trust checks.
                    bad_origin = context.request.post(origin + '/api/corilo-todos/list', data={}, headers={**headers, 'Origin': 'https://untrusted.invalid'})
                    assert bad_origin.status == 403
                    changed = context.request.post(origin + '/api/corilo-todos/list', data={}, headers={'x-corilo-todos-id': 'different-store'}).json()
                    assert not changed['ok'] and changed['error']['code'] == 'todos/library-changed'
                    missing = context.request.post(origin + '/api/corilo-todos/list', data={}).json()
                    assert not missing['ok'] and missing['error']['code'] == 'todos/library-changed'
                    invalid = context.request.post(origin + '/api/corilo-todos/list', data={'unexpected': True}, headers=headers).json()
                    assert not invalid['ok'] and invalid['error']['code'] == 'todos/400'
                    assert api('list', {'status': 'all'})['items'] == []

                    panel.get_by_text('更多操作', exact=True).click()
                    panel.get_by_role('button', name='新待办', exact=True).click()
                    title = panel.get_by_role('textbox', name='待办标题', exact=True)
                    body = panel.get_by_role('textbox', name='待办说明', exact=True)
                    note = panel.get_by_role('textbox', name='关联笔记路径', exact=True)
                    status = panel.get_by_role('status')
                    library = panel.get_by_role('complementary', name='待办列表')
                    filtering = library.get_by_role('group', name='待办状态筛选')
                    first_title = '准备周末读书会'
                    first_body = '带上中文笔记，讨论第二章。\n不需要模型或提醒服务。'
                    title.fill(first_title)
                    body.fill(first_body)
                    panel.get_by_text('更多设置', exact=True).click()
                    note.fill('读书/第二章.md')
                    panel.get_by_role('button', name='创建待办', exact=True).click()
                    expect(status).to_have_text('已保存')
                    created = api('list', {'status': 'all'})['items']
                    assert len(created) == 1
                    first = created[0]
                    assert first['title'] == first_title and first['body'] == first_body and first['notePath'] == '读书/第二章.md'
                    expect(panel.get_by_test_id('todo-record-state')).to_contain_text('未完成')
                    panel.get_by_role('checkbox', name='完成待办', exact=True).click()
                    expect(panel.get_by_test_id('todo-record-state')).to_contain_text('已完成')
                    filtering.get_by_role('button', name='已完成', exact=True).click()
                    expect(library.locator('li')).to_have_count(1)
                    expect(library.locator('li')).to_contain_text(first_title)
                    panel.get_by_role('button', name='取消待办', exact=True).click()
                    expect(panel.get_by_test_id('todo-record-state')).to_contain_text('已取消')
                    filtering.get_by_role('button', name='已取消', exact=True).click()
                    expect(library.locator('li')).to_have_count(1)
                    panel.get_by_role('checkbox', name='重新打开待办', exact=True).click()
                    expect(panel.get_by_test_id('todo-record-state')).to_contain_text('未完成')
                    filtering.get_by_role('button', name='未完成', exact=True).click()
                    expect(library.locator('li')).to_have_count(1)
                    title.fill(first_title + '（已确认）')
                    title.press('Control+s')
                    expect(status).to_have_text('已保存')
                    assert api('get', {'id': first['id']})['title'] == first_title + '（已确认）'
                    library.get_by_role('textbox', name='搜索待办').fill('读书会')
                    library.get_by_role('button', name='搜索', exact=True).click()
                    expect(library.locator('li')).to_have_count(1)
                    library.get_by_role('textbox', name='搜索待办').fill('')
                    library.get_by_role('button', name='搜索', exact=True).click()

                    # Let the real server commit, then lose just its response.
                    # The explicit retry must reuse the same requestId/payload.
                    panel.get_by_role('button', name='新待办', exact=True).click()
                    lost_title = '提交响应丢失也只创建一次'
                    title.fill(lost_title)
                    body.fill('同一个请求编号，人工确认后重试。')
                    committed = []
                    def lose_reply(route):
                        response = route.fetch()
                        value = response.json()
                        assert value['ok']
                        committed.append(value['value'])
                        route.abort()
                    page.route('**/api/corilo-todos/create', lose_reply, times=1)
                    panel.get_by_role('button', name='创建待办', exact=True).click()
                    expect(status).to_have_text('保存结果待确认')
                    expect(title).to_have_value(lost_title)
                    expect(title).to_be_disabled()
                    assert len(committed) == 1
                    assert len(api('list', {'status': 'all'})['items']) == 2
                    panel.get_by_role('button', name='重试同一请求', exact=True).click()
                    expect(status).to_have_text('已保存')
                    assert len(api('list', {'status': 'all'})['items']) == 2
                    assert len(creates) == 3 and creates[1] == creates[2]
                    lost_id = committed[0]['id']

                    # A second real browser page advances the version. The first
                    # editor must keep its own input and require reconciliation.
                    second = context.new_page()
                    other = enter(second)
                    other.get_by_role('complementary', name='待办列表').locator('li').filter(has_text=lost_title).get_by_role('button', name=lost_title, exact=True).click()
                    other.get_by_role('textbox', name='待办说明', exact=True).fill('另一页面已保存的新版本')
                    other.get_by_role('button', name='保存待办', exact=True).click()
                    expect(other.get_by_role('status')).to_have_text('已保存')
                    local_draft = '第一页面的输入必须保留'
                    body.fill(local_draft)
                    panel.get_by_role('button', name='保存待办', exact=True).click()
                    expect(status).to_have_text('版本冲突')
                    expect(body).to_have_value(local_draft)
                    assert api('get', {'id': lost_id})['body'] == '另一页面已保存的新版本'
                    panel.get_by_role('button', name='查看最新待办', exact=True).click()
                    expect(panel.get_by_role('textbox', name='最新待办说明', exact=True)).to_have_value('另一页面已保存的新版本')
                    page.once('dialog', lambda dialog: dialog.accept())
                    panel.get_by_role('button', name='保留输入，按最新版本编辑', exact=True).click()
                    expect(body).to_have_value(local_draft)
                    assert api('get', {'id': lost_id})['body'] == '另一页面已保存的新版本'
                    panel.get_by_role('button', name='保存待办', exact=True).click()
                    expect(status).to_have_text('已保存')
                    assert api('get', {'id': lost_id})['body'] == local_draft
                    second.close()

                    # A service-level 503 can also follow a committed mutation.
                    # Keep the same request key when the user confirms a retry.
                    panel.get_by_role('button', name='新待办', exact=True).click()
                    title.fill('服务503结果未知只创建一次')
                    def committed_503(route):
                        response = route.fetch()
                        assert response.json()['ok']
                        route.fulfill(json={'ok': False, 'error': {'code': 'todos/503', 'message': '确认失败，结果可能已经提交', 'details': {}}})
                    page.route('**/api/corilo-todos/create', committed_503, times=1)
                    panel.get_by_role('button', name='创建待办', exact=True).click()
                    expect(status).to_have_text('保存结果待确认')
                    expect(title).to_be_disabled()
                    assert len(api('list', {'status': 'all'})['items']) == 3
                    panel.get_by_role('button', name='重试同一请求', exact=True).click()
                    expect(status).to_have_text('已保存')
                    assert len(api('list', {'status': 'all'})['items']) == 3
                    assert len(creates) == 5 and creates[3] == creates[4]
                    library.locator('li').filter(has_text=lost_title).get_by_role('button', name=lost_title, exact=True).click()
                    expect(body).to_have_value(local_draft)

                    # An older listing can still be in flight when a mutation
                    # commits. It must be followed by a fresh read automatically.
                    # Keep one interceptor installed while releasing a stale
                    # response: expiring a times=1 route can stall the immediate
                    # fresh fetch in Chromium during interception-pattern churn.
                    # Each arm still holds exactly one response from the real
                    # host; all following reads continue without interception.
                    pending_list_holds = []
                    intercepted_list_requests = []
                    def hold_next_list(route):
                        intercepted_list_requests.append(route.request.post_data_json)
                        if not pending_list_holds:
                            route.continue_()
                            return
                        held = pending_list_holds.pop(0)
                        held.append((route, route.fetch()))
                    page.route('**/api/corilo-todos/list', hold_next_list)

                    def hold_list():
                        held = []
                        pending_list_holds.append(held)
                        library.get_by_role('button', name='刷新待办', exact=True).click()
                        expect(filtering.get_by_role('button').first).to_be_disabled()
                        deadline = time.monotonic() + 5
                        while not held and time.monotonic() < deadline:
                            page.wait_for_timeout(25)
                        assert len(held) == 1
                        return held[0]

                    request_count = len(intercepted_list_requests)
                    old_route, old_response = hold_list()
                    panel.get_by_role('button', name='新待办', exact=True).click()
                    delayed_title = '旧列表响应期间新建仍然可见'
                    title.fill(delayed_title)
                    panel.get_by_role('button', name='创建待办', exact=True).click()
                    expect(status).to_have_text('已保存')
                    assert len(api('list', {'status': 'all'})['items']) == 4
                    old_route.fulfill(response=old_response)
                    delayed_item = library.locator('li').filter(has_text=delayed_title)
                    expect(delayed_item).to_have_count(1)
                    expect(filtering.get_by_role('button').first).to_be_enabled()
                    assert len(intercepted_list_requests) == request_count + 2
                    request_count = len(intercepted_list_requests)
                    old_route, old_response = hold_list()
                    panel.get_by_role('checkbox', name='完成待办', exact=True).click()
                    expect(panel.get_by_test_id('todo-record-state')).to_contain_text('已完成')
                    old_route.fulfill(response=old_response)
                    expect(delayed_item).to_have_count(0)
                    expect(filtering.get_by_role('button').first).to_be_enabled()
                    assert len(intercepted_list_requests) == request_count + 2
                    library.locator('li').filter(has_text=lost_title).get_by_role('button', name=lost_title, exact=True).click()
                    expect(body).to_have_value(local_draft)

                    # Export a portable versioned public format via the actual UI.
                    with page.expect_download() as download_event:
                        panel.get_by_role('button', name='导出待办 JSON', exact=True).click()
                    download = download_event.value
                    exported = json.loads(pathlib.Path(download.path()).read_text())
                    assert exported['format'] == 'corilo-todos-v1'
                    assert len(exported['items']) == 4
                    assert any(item['id'] == first['id'] and item['notePath'] == '读书/第二章.md' for item in exported['items'])

                    # Switching preserves a dirty editor as an explicit recovery
                    # draft. No save or model request occurs during navigation.
                    body.fill('未保存的短草稿')
                    panel.get_by_role('button', name='新待办', exact=True).click()
                    expect(body).to_have_value('')
                    expect(title).to_be_focused()
                    saved_drafts = panel.locator('.corilo-todos-drafts')
                    saved_drafts.locator('summary').first.click()
                    short_draft = saved_drafts.locator('li').filter(has_text='未保存的短草稿')
                    short_draft.get_by_role('button', name='恢复草稿', exact=True).click()
                    expect(body).to_have_value('未保存的短草稿')
                    assert api('get', {'id': lost_id})['body'] == local_draft
                    # A failed IndexedDB transaction blocks navigation and keeps
                    # the current editor; it must never claim the draft was kept.
                    page.evaluate("() => { window.originalDraftAdd=IDBObjectStore.prototype.add; IDBObjectStore.prototype.add=function(){throw Error('synthetic stash failure');}; }")
                    panel.get_by_role('button', name='新待办', exact=True).click()
                    expect(body).to_have_value('未保存的短草稿')
                    expect(panel.get_by_role('alert').last).to_be_visible()
                    page.evaluate('IDBObjectStore.prototype.add=window.originalDraftAdd; delete window.originalDraftAdd;')
                    page.once('dialog', lambda dialog: dialog.accept())
                    panel.get_by_role('button', name='放弃修改', exact=True).click()
                    expect(body).to_have_value(local_draft)

                    # A mobile touch context uses the same real server and records.
                    mobile = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
                    mobile.on('request', lambda req: external.append(req.url.split('?')[0]) if req.url.startswith('http') and not req.url.startswith(origin + '/') else None)
                    phone = mobile.new_page()
                    phone.on('pageerror', lambda error: errors.append(str(error)))
                    mobile_panel = enter(phone, first=True)
                    expect(mobile_panel.get_by_role('textbox', name='快速新增待办')).to_be_enabled()
                    assert mobile_panel.evaluate('(el) => el.scrollWidth <= el.clientWidth + 1')
                    mobile_title = mobile_panel.get_by_role('textbox', name='快速新增待办')
                    assert mobile_title.evaluate('(el) => parseFloat(getComputedStyle(el).fontSize)') >= 16
                    expect(mobile_panel.get_by_role('textbox', name='待办标题')).to_have_count(0)
                    assert 0 <= mobile_title.bounding_box()['y'] < 250
                    for control in mobile_panel.get_by_role('checkbox').all():
                        assert control.bounding_box()['height'] >= 44
                    artifact_dir = os.environ.get('CORILO_BROWSER_ARTIFACT_DIR')
                    if artifact_dir:
                        target = pathlib.Path(artifact_dir)
                        target.mkdir(parents=True, exist_ok=True)
                        phone.screenshot(path=str(target / 'todos-mobile-core.png'))
                    mobile_panel.get_by_role('complementary', name='待办列表').locator('li').filter(has_text=lost_title).get_by_role('button').tap()
                    expect(mobile_panel.get_by_role('complementary', name='待办列表')).not_to_be_visible()
                    expect(mobile_title).not_to_be_visible()
                    mobile_panel.get_by_role('textbox', name='待办说明').fill('手机尺寸编辑的中文说明')
                    save = mobile_panel.get_by_role('button', name='保存待办', exact=True)
                    save.scroll_into_view_if_needed()
                    assert save.bounding_box()['height'] >= 44
                    save.tap()
                    expect(mobile_panel.get_by_role('status')).to_have_text('已保存')
                    assert api('get', {'id': lost_id})['body'] == '手机尺寸编辑的中文说明'
                    artifact_dir = os.environ.get('CORILO_BROWSER_ARTIFACT_DIR')
                    if artifact_dir:
                        target = pathlib.Path(artifact_dir)
                        target.mkdir(parents=True, exist_ok=True)
                        phone.screenshot(path=str(target / 'todos-mobile.png'))
                    mobile_panel.get_by_role('button', name='返回列表', exact=True).tap()
                    expect(mobile_title).to_be_visible()
                    expect(mobile_panel.get_by_role('complementary', name='待办列表')).to_be_visible()
                    mobile.close()

                    # An old page must freeze after a store identity mismatch,
                    # keeping the editor content instead of writing a new store.
                    def changed_store(route):
                        route.fulfill(json={'ok': False, 'error': {'code': 'todos/library-changed', 'message': '待办资料库已切换', 'details': {}}})
                    page.route('**/api/corilo-todos/update', changed_store, times=1)
                    body.fill('库切换后不能提交的输入')
                    panel.get_by_role('button', name='保存待办', exact=True).click()
                    expect(panel.get_by_role('textbox', name='待办标题')).to_be_disabled()
                    expect(body).to_have_value('库切换后不能提交的输入')
                    assert api('get', {'id': lost_id})['body'] == '手机尺寸编辑的中文说明'
                    assert len(creates) == 6
                    assert (base / 'notes/读书/第二章.md').read_text() == note_text


                    # Core flow starts with one field, supports consecutive
                    # entry and performs completion directly in the list.
                    core_page = context.new_page()
                    core = enter(core_page)
                    quick = core.get_by_role('textbox', name='快速新增待办', exact=True)
                    core_list = core.get_by_role('complementary', name='待办列表')
                    expect(core.get_by_role('textbox', name='待办标题')).to_have_count(0)
                    core_titles = ['连续记录第一件事', '连续记录第二件事']
                    for index, text in enumerate(core_titles):
                        quick.fill(text)
                        if index == 1:
                            before_ime = len(creates)
                            quick.dispatch_event('compositionstart')
                            quick.press('Enter')
                            core_page.wait_for_timeout(100)
                            assert len(creates) == before_ime, 'IME confirmation must not create a todo'
                            expect(quick).to_have_value(text)
                            quick.dispatch_event('compositionend')
                            quick.press('Enter')
                        else:
                            core.get_by_role('button', name='添加', exact=True).click()
                        expect(quick).to_have_value('')
                        expect(quick).to_be_focused()
                        expect(core_list.get_by_role('button', name=text, exact=True)).to_have_count(1)
                    records = {item['title']: item for item in api('list', {'status': 'all'})['items']}
                    first_core = records[core_titles[0]]
                    second_core = records[core_titles[1]]
                    first_check = core_list.get_by_role('checkbox', name='完成：' + core_titles[0], exact=True)
                    first_check.click()
                    expect(first_check).to_have_count(0)
                    assert api('get', {'id': first_core['id']})['status'] == 'done'
                    core.get_by_role('button', name='撤销完成', exact=True).click()
                    expect(first_check).to_be_checked(checked=False)
                    assert api('get', {'id': first_core['id']})['status'] == 'open'
                    second_check = core_list.get_by_role('checkbox', name='完成：' + core_titles[1], exact=True)
                    second_check.click()
                    core_filter = core_list.get_by_role('group', name='待办状态筛选')
                    core_filter.get_by_role('button', name='已完成', exact=True).click()
                    expect(second_check).to_be_checked()
                    second_check.click()
                    expect(second_check).to_have_count(0)
                    assert api('get', {'id': second_core['id']})['status'] == 'open'
                    core_filter.get_by_role('button', name='未完成', exact=True).click()

                    # Completing an unrelated item never replaces editor input.
                    core_list.get_by_role('button', name=lost_title, exact=True).click()
                    core_body = core.get_by_role('textbox', name='待办说明', exact=True)
                    core_body.fill('正在编辑另一项，列表操作不能覆盖这段输入')
                    first_check.click()
                    expect(core_body).to_have_value('正在编辑另一项，列表操作不能覆盖这段输入')
                    core.get_by_role('button', name='撤销完成', exact=True).click()
                    expect(first_check).to_have_count(1)
                    current = api('get', {'id': first_core['id']})
                    api('update', {'requestId': str(uuid.uuid4()), 'id': current['id'], 'expected': current['version'], 'patch': {'body': '另一页面更新'}})
                    first_check.click()
                    expect(core.get_by_role('alert')).to_contain_text('这项待办已有更新')
                    assert api('get', {'id': current['id']})['status'] == 'open'
                    expect(first_check).not_to_be_checked()
                    expect(core_body).to_have_value('正在编辑另一项，列表操作不能覆盖这段输入')

                    # A list action can commit before its reply is lost. Retry
                    # remains available globally even after changing filters.
                    row_requests = []
                    core_page.on('request', lambda request: row_requests.append(request.post_data_json) if '/api/corilo-todos/update' in request.url else None)
                    def lose_row_reply(route):
                        assert route.fetch().json()['ok']
                        route.abort()
                    core_page.route('**/api/corilo-todos/update', lose_row_reply, times=1)
                    second_check.click()
                    expect(core.get_by_role('button', name='重试列表操作', exact=True)).to_be_visible()
                    committed_row = api('get', {'id': second_core['id']})
                    assert committed_row['status'] == 'done'
                    core_filter.get_by_role('button', name='已完成', exact=True).click()
                    core.get_by_role('button', name='重试列表操作', exact=True).click()
                    expect(core.get_by_role('button', name='重试列表操作', exact=True)).to_have_count(0)
                    assert api('get', {'id': second_core['id']})['version'] == committed_row['version']
                    assert len(row_requests) == 2 and row_requests[0] == row_requests[1]
                    expect(core_body).to_have_value('正在编辑另一项，列表操作不能覆盖这段输入')
                    # A detail navigation archive never owns quick capture.
                    # Adding the independent quick input, then restoring the
                    # old detail must not bring that already-added title back.
                    core_filter.get_by_role('button', name='未完成', exact=True).click()
                    quick.fill('导航时的独立快速输入')
                    core_list.get_by_role('button', name=core_titles[0], exact=True).click()
                    expect(quick).to_have_value('导航时的独立快速输入')
                    expect(core_body).to_have_value('另一页面更新')
                    core.get_by_role('button', name='添加', exact=True).click()
                    expect(quick).to_have_value('')
                    core_drafts = core.locator('.corilo-todos-drafts')
                    core_drafts.locator('summary').first.click()
                    navigation_draft = core_drafts.locator('li').filter(has_text='正在编辑另一项，列表操作不能覆盖这段输入')
                    expect(navigation_draft).not_to_contain_text('导航时的独立快速输入')
                    navigation_draft.get_by_role('button', name='恢复草稿', exact=True).click()
                    expect(core_body).to_have_value('正在编辑另一项，列表操作不能覆盖这段输入')
                    expect(quick).to_have_value('')
                    assert len([item for item in api('list', {'status': 'all'})['items'] if item['title'] == '导航时的独立快速输入']) == 1
                    core_page.close()

                    assert not errors, errors
                    assert not external, external
                    anonymous.dispose()
                    browser.close()
                host.terminate()
                assert host.wait(timeout=10) == 0
                print('Harness todos Chromium passed: personal todo lifecycle, notes plugin coexistence/association, JSON export, lost-reply/503 idempotency, delayed-list refresh, stale-version protection, authentication/origin/store identity, 390px layout, quick consecutive entry, direct completion/undo and unrelated-draft protection; zero model/external requests.')
            finally:
                if host.poll() is None:
                    host.terminate()
                    try:
                        host.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        host.kill()
                        host.wait()


if __name__ == '__main__':
    main()
