"""Real Harness user journeys: add, edit, switch, finish and return naturally."""
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import uuid

from playwright.sync_api import sync_playwright, expect
from browser import ROOT, wait_for


def main():
    with tempfile.TemporaryDirectory(prefix='corilo-todo-flow-') as temp:
        base = pathlib.Path(temp)
        patch = base / 'patch.json'
        patch.write_text(json.dumps([
            {'insert': [{'id': 'corilo-todos', 'name': str(ROOT / 'index.mjs'), 'config': {'root': str(base / 'todos')}}]},
            {'id': 'workspace-controller', 'config': {'documentsDirectory': str(base / 'documents')}}
        ]))
        with (base / 'host.log').open('w') as log:
            host = subprocess.Popen(['node', str(ROOT / 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--patch', str(patch), '--no-open', '--port', '0'], cwd=base, stdout=log, stderr=log,
                env=dict(os.environ, HOME=str(base / 'user-home'), DSH_HOME=str(base / 'harness'), DSH_AGENTS_HOME=str(base / 'agents')))
            try:
                def address():
                    assert host.poll() is None
                    match = re.search(r'dsh web: (http://127\.0\.0\.1:\d+/\?[^\s\x1b]+)', (base / 'host.log').read_text())
                    return match[1] if match else None
                url = wait_for(address)
                origin = url.split('/?')[0]
                with sync_playwright() as p:
                    browser = p.chromium.launch(headless=True, executable_path=shutil.which('chromium') or None)
                    context = browser.new_context(viewport={'width': 1400, 'height': 950})
                    errors, external, updates = [], [], []
                    context.on('request', lambda req: external.append(req.url.split('?')[0]) if req.url.startswith('http') and not req.url.startswith(origin + '/') else None)
                    context.on('request', lambda req: updates.append(req.post_data_json) if '/api/corilo-todos/update' in req.url else None)
                    page = context.new_page()
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    def enter(target, first=False):
                        target.goto(url if first else origin)
                        target.get_by_role('button', name='Continue', exact=True).or_(target.get_by_role('button', name='Close', exact=True)).first.wait_for()
                        if target.get_by_role('button', name='Continue', exact=True).is_visible():
                            target.get_by_role('button', name='Continue', exact=True).click()
                        target.get_by_role('button', name='Close', exact=True).click()
                        narrow = target.viewport_size['width'] <= 700
                        if narrow:
                            target.get_by_role('button', name='Open sidebar', exact=True).click()
                        target.get_by_role('button', name='待办', exact=True).click()
                        if narrow:
                            target.touchscreen.tap(target.viewport_size['width'] - 8, 220)
                        result = target.get_by_role('region', name='Corilo 待办')
                        expect(result.get_by_role('textbox', name='快速新增待办')).to_be_enabled()
                        return result
                    panel = enter(page, first=True)
                    quick = panel.get_by_role('textbox', name='快速新增待办', exact=True)
                    library = panel.get_by_role('complementary', name='待办列表')
                    for title in ['整理读书笔记', '准备周末出游']:
                        quick.fill(title)
                        quick.press('Enter')
                        expect(quick).to_have_value('')
                        expect(quick).to_be_focused()
                        expect(library.get_by_role('button', name=title, exact=True)).to_be_visible()
                    identity = context.request.post(origin + '/api/corilo-todos/identity', data={}).json()['value']['id']
                    def api(method, args):
                        result = context.request.post(origin + '/api/corilo-todos/' + method, headers={'x-corilo-todos-id': identity}, data=args).json()
                        assert result['ok'], result
                        return result['value']
                    entries = api('list', {'status': 'open'})['items']
                    first = next(item for item in entries if item['title'] == '整理读书笔记')
                    second = next(item for item in entries if item['title'] == '准备周末出游')
                    library.get_by_role('button', name=first['title'], exact=True).click()
                    title = panel.get_by_role('textbox', name='待办标题', exact=True)
                    body = panel.get_by_role('textbox', name='待办说明', exact=True)
                    expect(panel.get_by_role('button', name='保存待办', exact=True)).to_have_count(0)
                    body.fill('把这一周读过的书，留下三条想法。')
                    library.get_by_role('button', name=second['title'], exact=True).click()
                    expect(title).to_have_value(second['title'])
                    assert api('get', {'id': first['id']})['body'] == '把这一周读过的书，留下三条想法。'
                    expect(panel.locator('.corilo-todos-drafts')).to_have_count(0)
                    title.fill('准备周末出游清单')
                    library.get_by_role('checkbox', name='完成：整理读书笔记', exact=True).click()
                    expect(library.get_by_role('button', name=first['title'], exact=True)).to_have_count(0)
                    expect(title).to_have_value('准备周末出游清单')
                    assert api('get', {'id': second['id']})['title'] == '准备周末出游清单'
                    panel.get_by_role('button', name='撤销完成', exact=True).click()
                    expect(library.get_by_role('button', name=first['title'], exact=True)).to_be_visible()
                    count = len(updates)
                    body.dispatch_event('compositionstart')
                    body.fill('正在组字，返回不能提交半成品')
                    panel.get_by_role('button', name='返回列表', exact=True).click()
                    expect(body).to_be_visible()
                    assert len(updates) == count
                    body.dispatch_event('compositionend')
                    panel.get_by_role('button', name='返回列表', exact=True).click()
                    expect(panel.locator('.corilo-todos-editor')).to_have_count(0)
                    library.get_by_role('button', name='准备周末出游清单', exact=True).click()
                    expect(body).to_have_value('正在组字，返回不能提交半成品')

                    # Leaving for the host's other panel still saves through the
                    # bound store actions; return does not overwrite the edit.
                    body.fill('带相机、轻便外套和一本书。')
                    page.get_by_role('button', name='Plugins', exact=True).click()
                    wait_for(lambda: api('get', {'id': second['id']})['body'] == '带相机、轻便外套和一本书。')
                    page.get_by_role('button', name='待办', exact=True).click()
                    expect(body).to_have_value('带相机、轻便外套和一本书。')
                    expect(body).to_be_enabled()
                    expect(panel.get_by_role('button', name='保存待办', exact=True)).to_have_count(0)
                    artifacts = os.environ.get('CORILO_BROWSER_ARTIFACT_DIR')
                    if artifacts:
                        destination = pathlib.Path(artifacts)
                        destination.mkdir(parents=True, exist_ok=True)
                        page.screenshot(path=str(destination / 'todos-natural-desktop.png'), animations='disabled')

                    # Mobile uses a dedicated content view and a single close
                    # action. The edited body persists before the list returns.
                    phone = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
                    phone.on('request', lambda req: external.append(req.url.split('?')[0]) if req.url.startswith('http') and not req.url.startswith(origin + '/') else None)
                    mobile_page = phone.new_page()
                    mobile_page.on('pageerror', lambda error: errors.append(str(error)))
                    mobile = enter(mobile_page, first=True)
                    mobile_list = mobile.get_by_role('complementary', name='待办列表')
                    mobile_list.get_by_role('button', name='准备周末出游清单', exact=True).tap()
                    mobile_body = mobile.get_by_role('textbox', name='待办说明')
                    expect(mobile_list).not_to_be_visible()
                    expect(mobile.get_by_role('button', name='保存待办', exact=True)).to_have_count(0)
                    mobile_body.fill('手机上也能直接改，返回即保存。')
                    mobile.get_by_role('button', name='返回列表', exact=True).tap()
                    expect(mobile_list).to_be_visible()
                    assert api('get', {'id': second['id']})['body'] == '手机上也能直接改，返回即保存。'
                    if artifacts:
                        mobile_list.get_by_role('button', name='准备周末出游清单', exact=True).tap()
                        mobile_page.screenshot(path=str(destination / 'todos-natural-mobile.png'), animations='disabled')
                    phone.close()

                    # Unknown automatic result never navigates or changes UUID.
                    library.get_by_role('button', name='准备周末出游清单', exact=True).click()
                    expect(body).to_have_value('手机上也能直接改，返回即保存。')
                    expect(body).to_be_enabled()
                    body.fill('保存响应丢失，仍保留当前详情。')
                    def lose_reply(route):
                        assert route.fetch().json()['ok']
                        route.abort()
                    page.route('**/api/corilo-todos/update', lose_reply, times=1)
                    before = len(updates)
                    panel.get_by_role('button', name='返回列表', exact=True).click()
                    retry = panel.get_by_role('button', name='重试同一请求', exact=True)
                    expect(retry).to_be_visible()
                    expect(body).to_have_value('保存响应丢失，仍保留当前详情。')
                    page.wait_for_timeout(250)
                    assert len(updates) == before + 1
                    request = updates[-1]
                    retry.click()
                    expect(retry).to_have_count(0)
                    assert updates[-1] == request
                    panel.get_by_role('button', name='返回列表', exact=True).click()
                    expect(panel.locator('.corilo-todos-editor')).to_have_count(0)
                    library.get_by_role('button', name='准备周末出游清单', exact=True).click()
                    expect(body).to_have_value('保存响应丢失，仍保留当前详情。')
                    current = api('get', {'id': second['id']})
                    api('update', {'id': current['id'], 'expected': current['version'], 'requestId': str(uuid.uuid4()), 'patch': {'body': '另一台设备刚保存的说明'}})
                    body.fill('这段输入不能被切换操作覆盖')
                    library.get_by_role('button', name=first['title'], exact=True).click()
                    expect(panel.get_by_role('button', name='查看最新待办', exact=True)).to_be_visible()
                    expect(title).to_have_value('准备周末出游清单')
                    expect(body).to_have_value('这段输入不能被切换操作覆盖')
                    assert api('get', {'id': second['id']})['body'] == '另一台设备刚保存的说明'
                    panel.get_by_role('button', name='查看最新待办', exact=True).click()
                    expect(panel.get_by_role('textbox', name='最新待办说明')).to_have_value('另一台设备刚保存的说明')
                    page.once('dialog', lambda dialog: dialog.accept())
                    panel.get_by_role('button', name='保留输入，按最新版本编辑', exact=True).click()
                    expect(body).to_have_value('这段输入不能被切换操作覆盖')
                    before = len(updates)
                    panel.get_by_role('button', name='返回列表', exact=True).click()
                    expect(panel.locator('.corilo-todos-editor')).to_have_count(0)
                    assert len(updates) == before + 1
                    assert api('get', {'id': second['id']})['body'] == '这段输入不能被切换操作覆盖'

                    # Choosing the complete current record also resets the
                    # blocked flag; the next deliberate edit saves naturally.
                    library.get_by_role('button', name='准备周末出游清单', exact=True).click()
                    expect(body).to_have_value('这段输入不能被切换操作覆盖')
                    current = api('get', {'id': second['id']})
                    api('update', {'id': current['id'], 'expected': current['version'], 'requestId': str(uuid.uuid4()), 'patch': {'body': '确认采用的最新说明'}})
                    body.fill('将明确放弃的输入')
                    panel.get_by_role('button', name='返回列表', exact=True).click()
                    panel.get_by_role('button', name='查看最新待办', exact=True).click()
                    expect(panel.get_by_role('textbox', name='最新待办说明')).to_have_value('确认采用的最新说明')
                    page.once('dialog', lambda dialog: dialog.accept())
                    panel.get_by_role('button', name='采用最新待办', exact=True).click()
                    expect(body).to_have_value('确认采用的最新说明')
                    body.fill('采用最新后继续自然编辑')
                    before = len(updates)
                    panel.get_by_role('button', name='返回列表', exact=True).click()
                    expect(panel.locator('.corilo-todos-editor')).to_have_count(0)
                    assert len(updates) == before + 1
                    assert api('get', {'id': second['id']})['body'] == '采用最新后继续自然编辑'

                    # Workspace interactions are scoped to this plugin and must
                    # preserve the same save/UUID protections checked above.
                    assert library.get_by_role('textbox', name='快速新增待办').count() == 1
                    panel.focus()
                    panel.press('n')
                    expect(quick).to_be_focused()
                    long_title = '整理《如何阅读一本书》的阅读记录，把重要观点转成下周可以执行的三件小事'
                    quick.fill(long_title)
                    quick.press('Enter')
                    expect(quick).to_have_value('')
                    rows = library.locator('.corilo-todos-item-title')
                    expect(rows).to_have_count(3)
                    rows.first.focus()
                    rows.first.press('ArrowDown')
                    expect(rows.nth(1)).to_be_focused()
                    rows.nth(1).press('/')
                    search = library.get_by_role('textbox', name='搜索待办')
                    expect(search).to_be_focused()
                    search.fill('一本书')
                    search.press('Enter')
                    expect(rows).to_have_count(1)
                    panel.get_by_role('button', name='清除搜索').click()
                    expect(rows).to_have_count(3)
                    library.get_by_role('button', name=long_title, exact=True).click()
                    expect(title).to_have_value(long_title)
                    assert title.bounding_box()['height'] > 60, 'Long titles must wrap'
                    short_height = body.bounding_box()['height']
                    assert short_height < 140, short_height
                    title.press('Enter')
                    expect(body).to_be_focused()
                    detail = '\n'.join(f'第 {n} 条阅读想法' for n in range(8))
                    body.fill(detail)
                    wait_for(lambda: body.bounding_box()['height'] > short_height)
                    menu = panel.locator('details.corilo-todos-more')
                    old_y = library.bounding_box()['y']
                    menu.locator('summary').click()
                    expect(menu).to_have_attribute('open', '')
                    assert abs(library.bounding_box()['y'] - old_y) < 1, 'More actions must not shift the list'
                    menu.locator('summary').press('Escape')
                    expect(menu).not_to_have_attribute('open', '')
                    expect(body).to_be_visible()
                    body.press('Escape')
                    expect(body).to_have_count(0)
                    library.get_by_role('button', name=long_title, exact=True).click()
                    expect(body).to_have_value(detail)
                    shots = pathlib.Path('/workspace/work/todos-v30/screenshots')
                    shots.mkdir(parents=True, exist_ok=True)
                    panel.screenshot(path=str(shots / 'desktop-detail.png'))
                    panel.get_by_role('button', name='返回列表', exact=True).click()
                    tabs = panel.get_by_role('group', name='待办状态筛选')
                    tabs.get_by_role('button', name='已完成', exact=True).click()
                    quick.fill('从完成列表继续记录')
                    quick.press('Enter')
                    expect(tabs.get_by_role('button', name='未完成', exact=True)).to_have_attribute('aria-pressed', 'true')
                    expect(library.get_by_role('button', name='从完成列表继续记录', exact=True)).to_be_visible()
                    search.fill('没有匹配的关键词')
                    search.press('Enter')
                    expect(rows).to_have_count(0)
                    quick.fill('搜索后新建也能看见')
                    quick.press('Enter')
                    expect(search).to_have_value('')
                    expect(library.get_by_role('button', name='搜索后新建也能看见', exact=True)).to_be_visible()
                    panel.screenshot(path=str(shots / 'desktop-list.png'))
                    phone = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
                    phone.on('request', lambda req: external.append(req.url.split('?')[0]) if req.url.startswith('http') and not req.url.startswith(origin + '/') else None)
                    phone_page = phone.new_page()
                    phone_page.on('pageerror', lambda error: errors.append(str(error)))
                    mobile = enter(phone_page, first=True)
                    assert mobile.evaluate('(el) => el.scrollWidth <= el.clientWidth + 1')
                    mobile.screenshot(path=str(shots / 'mobile-list.png'))
                    mobile.get_by_role('button', name=long_title, exact=True).tap()
                    expect(mobile.get_by_role('complementary', name='待办列表')).not_to_be_visible()
                    expect(mobile.get_by_role('textbox', name='待办说明')).to_have_value(detail)
                    mobile.screenshot(path=str(shots / 'mobile-detail.png'))
                    mobile.get_by_role('button', name='返回列表', exact=True).tap()
                    phone_page.set_viewport_size({'width': 320, 'height': 640})
                    assert mobile.evaluate('(el) => el.scrollWidth <= el.clientWidth + 1')
                    phone.close()
                    assert not errors, errors
                    assert not external, external
                    browser.close()
                host.terminate()
                assert host.wait(timeout=10) == 0
                print('Harness todo natural-flow passed: quick entry, one-click save-and-switch/complete/close, host navigation save, phone detail return, isolated drafts and explicit same-UUID retry; zero model/external requests.')
            finally:
                if host.poll() is None:
                    host.kill(); host.wait()


if __name__ == '__main__':
    main()
