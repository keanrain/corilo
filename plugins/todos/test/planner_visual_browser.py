"""Planner appearance and reachable controls in real DSH; synthetic data only."""
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import uuid
from playwright.sync_api import sync_playwright, expect
from core_browser import wait_for
from i18n_browser import switch_language

def more(form):
 # Folded "更多" fields: open the native disclosure before touching them.
 form.evaluate("f=>{const d=f.querySelector('details.planner-editor-more');if(d)d.open=true}")


ROOT = pathlib.Path(__file__).resolve().parents[1]


def nav(panel, name):
    # Narrow layouts keep the views in a drawer behind the heading toggle.
    button = panel.get_by_role('button', name=name, exact=True)
    if panel.locator('.planner-drawer-toggle').is_visible():
        panel.locator('.planner-drawer-toggle').click()
    button.click()
    expect(panel.locator('.planner-sidebar.is-open')).to_have_count(0)


def side(panel, name):
    # Sidebar actions that keep the drawer open (refresh, export).
    button = panel.get_by_role('button', name=name, exact=True)
    opened = panel.locator('.planner-drawer-toggle').is_visible()
    if opened:
        panel.locator('.planner-drawer-toggle').click()
    button.click()
    if opened:
        box = panel.locator('.planner-scrim').bounding_box()
        panel.locator('.planner-scrim').click(position={'x': box['width'] - 8, 'y': box['height'] / 2})
        expect(panel.locator('.planner-sidebar.is-open')).to_have_count(0)


def exercise_interactions(page, panel, dialogs):
    nav(panel, '今天')
    title = '把方案发给同事'
    check = panel.get_by_role('checkbox', name='完成：' + title, exact=True)
    expect(check).to_be_enabled()
    writes = []
    page.on('request', lambda request: writes.append(request.post_data_json) if request.url.endswith('/v2/tasks/update') else None)
    check.evaluate('(el)=>{el.click();el.click();}')
    expect(panel.get_by_role('status')).to_contain_text('任务已完成')
    assert len(writes) == 1, 'Rapid completion must submit only once'
    expect(panel.get_by_role('button', name=title, exact=True)).to_have_count(0)
    def reopen():
        nav(panel, '已完成')
        panel.get_by_role('checkbox', name='恢复：' + title, exact=True).click()
        expect(panel.get_by_role('status')).to_contain_text('任务已恢复')
        nav(panel, '今天')
        expect(check).to_be_enabled()
    reopen()
    def lose(route):
        response = route.fetch()
        assert response.json()['ok']
        route.abort()
    page.route('**/api/corilo-todos/v2/tasks/update', lose, times=1)
    check.click()
    expect(panel.get_by_role('status')).to_contain_text('保存结果未知')
    expect(check).to_be_disabled()
    panel.get_by_role('button', name='核对操作', exact=True).click()
    expect(panel.get_by_role('status')).to_contain_text('任务已完成')
    expect(panel.get_by_role('alert')).to_have_count(0)
    reopen()
    def stale(route):
        args = route.request.post_data_json
        payload = {'requestId': str(uuid.uuid4()), 'id': args['id'], 'expected': args['expected'], 'patch': {'body': '另一浏览器的新内容'}}
        response = page.request.post(route.request.url, data=json.dumps(payload), headers={'content-type':'application/json', 'x-corilo-todos-id':route.request.headers['x-corilo-todos-id']})
        assert response.json()['ok']
        route.continue_()
    page.route('**/api/corilo-todos/v2/tasks/update', stale, times=1)
    check.click()
    expect(panel.get_by_role('status')).to_contain_text('任务已更新，请核对后重试')
    expect(check).to_be_enabled()
    expect(panel.get_by_role('button', name=title, exact=True)).to_contain_text('另一浏览器的新内容')
    panel.get_by_role('button', name=title, exact=True).click()
    form = panel.get_by_role('form', name='事项详情', exact=True)
    more(form)
    form.get_by_label('说明', exact=True).fill('必须保留的未保存草稿')
    before = len(dialogs)
    page.keyboard.press('Escape')
    assert len(dialogs) == before + 1
    more(form)
    expect(form.get_by_label('说明', exact=True)).to_have_value('必须保留的未保存草稿')
    form.get_by_role('button', name='保存', exact=True).click()
    expect(panel.get_by_role('status')).to_contain_text('已保存')
    # The write notice precedes refresh completion; closing waits for both.
    expect(form.get_by_role('button', name='保存', exact=True)).to_be_enabled()
    count = len(dialogs)
    page.keyboard.press('Escape')
    expect(form).to_have_count(0)
    assert len(dialogs) == count


def main():
    artifacts = pathlib.Path(os.environ.get('CORILO_BROWSER_ARTIFACT_DIR', '/tmp/corilo-planner-visual'))
    artifacts.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='corilo-planner-visual-') as tmp:
        base = pathlib.Path(tmp)
        for folder in ['user-home', 'harness', 'agents', 'workspace']:
            (base / folder).mkdir()
        patch = base / 'patch.json'
        patch.write_text(json.dumps([
            {'insert': [{'id': 'corilo-todos', 'name': str(ROOT / 'index.mjs'), 'config': {'root': str(base / 'data'), 'planner': True}}]},
            {'id': 'workspace-controller', 'config': {'documentsDirectory': str(base / 'workspace')}}
        ]))
        log_path = base / 'host.log'
        with log_path.open('w') as log:
            host = subprocess.Popen(['node', str(ROOT / 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--patch', str(patch), '--no-open', '--port', '0'], cwd=base, stdout=log, stderr=log,
                                    env=dict(os.environ, HOME=str(base / 'user-home'), DSH_HOME=str(base / 'harness'), DSH_AGENTS_HOME=str(base / 'agents'), XDG_CONFIG_HOME=str(base / 'config')))
            try:
                def address():
                    assert host.poll() is None, 'DSH exited before readiness'
                    match = re.search(r'dsh web: (http://127\.0\.0\.1:\d+/\?[^\s\x1b]+)', log_path.read_text())
                    return match[1] if match else None
                url = wait_for(address)
                origin = url.split('/?')[0]
                with sync_playwright() as p:
                    browser = p.chromium.launch(headless=True, executable_path=shutil.which('chromium') or None)
                    errors, external = [], []
                    seeded = False
                    for scheme in ['light', 'dark']:
                        for width, height, layout in [(1400, 950, 'desktop'), (1024, 900, 'tablet'), (780, 900, 'compact'), (390, 844, 'mobile')]:
                            ctx = browser.new_context(locale='zh-CN', timezone_id='UTC', color_scheme=scheme, viewport={'width': width, 'height': height}, has_touch=width < 700)
                            page = ctx.new_page()
                            dialogs = []
                            page.on('dialog', lambda dialog: (dialogs.append(dialog.message), dialog.dismiss()))
                            page.on('pageerror', lambda error: errors.append(str(error)))
                            page.on('request', lambda req: external.append(req.url.split('?')[0]) if req.url.startswith('http') and not req.url.startswith(origin + '/') else None)
                            page.goto(url)
                            page.get_by_role('button', name=re.compile(r'^(Continue|继续)$'), exact=True).or_(page.get_by_role('button', name=re.compile(r'^(Close|关闭)$'), exact=True)).first.wait_for()
                            if page.get_by_role('button', name=re.compile(r'^(Continue|继续)$'), exact=True).is_visible():
                                page.get_by_role('button', name=re.compile(r'^(Continue|继续)$'), exact=True).click()
                            page.get_by_role('button', name=re.compile(r'^(Close|关闭)$'), exact=True).click()
                            if not page.get_by_role('button', name='待办', exact=True).is_visible():
                                page.get_by_role('button', name=re.compile(r'^(Open sidebar|打开侧边栏)$'), exact=True).click()
                            page.get_by_role('button', name='待办', exact=True).click()
                            if width < 700:
                                page.mouse.click(width - 5, height - 5)
                            panel = page.get_by_role('region', name='任务与日历', exact=True)
                            expect(panel).to_be_visible()
                            if not seeded:
                                page.evaluate('''async () => {
                                  const send=async(method,args={},id)=>(await(await fetch('api/corilo-todos/v2/'+method,{method:'POST',headers:{'content-type':'application/json',...(id?{'x-corilo-todos-id':id}:{})},body:JSON.stringify(args)})).json()).value;
                                  const identity=await send('identity');
                                  const day=new Date().toISOString().slice(0,10), tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10), yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
                                  for(const value of [
                                    {title:'准备阅读新的一章',body:'记下关键问题，留出 30 分钟集中阅读。',plannedDate:day,list:'个人',priority:'normal'},
                                    {title:'整理本周的设计想法',body:'把零散的想法整理成一份清晰的提纲。',plannedDate:day,list:'工作',priority:'high'},
                                    {title:'把方案发给同事',plannedDate:day,list:'工作',priority:'normal'},
                                    {title:'复盘上次讨论',due:{kind:'date',date:yesterday,timeZone:'UTC'},priority:'urgent',list:'工作'},
                                    {title:'周末去附近走走',plannedDate:tomorrow,list:'个人'},
                                    {title:'一个随手记下的想法'}
                                  ])await send('tasks/create',{requestId:crypto.randomUUID(),value},identity.id);
                                  await send('calendar/create',{requestId:crypto.randomUUID(),value:{title:'留一段时间阅读',body:'合成日程',allDay:true,start:day,end:tomorrow,timeZone:'UTC'}},identity.id);
                                }''')
                                seeded = True
                            side(panel, '刷新')
                            expect(panel.get_by_role('button', name='准备阅读新的一章', exact=True)).to_be_visible()
                            assert panel.evaluate('(el)=>el.scrollWidth<=el.clientWidth+1'), 'Planner overflows its host frame'
                            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), 'Document overflows horizontally'
                            for selector in ['.planner-task-open', '.planner-schedule-button']:
                                boxes = panel.locator(selector).evaluate_all('(els)=>els.map(el=>el.getBoundingClientRect().width)')
                                assert all(value >= 44 for value in boxes), (selector, boxes)
                            colors = panel.evaluate('''el => {
                              const resolve = value => { const s=document.createElement('span');s.style.color=value;el.append(s);const c=getComputedStyle(s).color;s.remove();return c; };
                              const lum = value => { const c=value.match(/[\\d.]+/g).slice(0,3).map(v=>Number(v)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722; };
                              const ratio=(a,b)=>{const [h,l]=[lum(a),lum(b)].sort((a,b)=>b-a);return(h+.05)/(l+.05);};
                              return {secondary:ratio(resolve('var(--planner-muted)'),resolve('var(--planner-surface)')),accent:ratio(resolve('var(--planner-accent)'),resolve('var(--planner-accent-bg)')),primary:ratio(resolve('var(--planner-button-text)'),resolve('var(--planner-button-bg)'))};
                            }''')
                            assert all(v >= 4.5 for v in colors.values()), colors
                            page.screenshot(path=str(artifacts / f'planner-{scheme}-{layout}-tasks.png'), animations='disabled')
                            search = panel.get_by_role('textbox', name='搜索', exact=True)
                            search.fill('完全不存在的合成关键词')
                            expect(panel.get_by_text('没有找到匹配的任务', exact=True)).to_be_visible()
                            search.fill('')
                            expect(panel.get_by_role('button', name='准备阅读新的一章', exact=True)).to_be_visible()
                            search.focus()
                            page.keyboard.press('Tab')
                            page.keyboard.press('Enter')
                            expect(panel.get_by_role('textbox', name='清单', exact=True)).to_be_visible()
                            panel.get_by_role('textbox', name='清单', exact=True).fill('个人')
                            expect(panel.get_by_role('button', name='整理本周的设计想法', exact=True)).to_have_count(0)
                            panel.get_by_role('button', name='清空筛选', exact=True).first.click()
                            panel.locator('.planner-filter-options summary').click()
                            summary = panel.locator('.planner-filter-options summary')
                            summary.click()
                            panel.get_by_role('textbox', name='清单', exact=True).focus()
                            page.keyboard.press('Escape')
                            assert not panel.locator('.planner-filter-options').evaluate('(el)=>el.open')
                            summary.click()
                            panel.get_by_role('heading', name='今天', exact=True).click()
                            assert not panel.locator('.planner-filter-options').evaluate('(el)=>el.open')
                            panel.get_by_role('button', name='准备阅读新的一章', exact=True).click()
                            form = panel.get_by_role('form', name='事项详情', exact=True)
                            expect(form.get_by_label('标题', exact=True)).to_be_focused()
                            frame = panel.bounding_box()
                            box = form.bounding_box()
                            assert box['width'] <= frame['width'] + 1 and box['x'] >= frame['x'] - 1, (frame, box)
                            form.get_by_role('button', name='保存', exact=True).scroll_into_view_if_needed()
                            box = form.get_by_role('button', name='保存', exact=True).bounding_box()
                            assert box and 0 <= box['y'] < height - 20, 'Save action is unreachable'
                            page.screenshot(path=str(artifacts / f'planner-{scheme}-{layout}-details.png'), animations='disabled')
                            count = len(dialogs)
                            if form.evaluate('(el)=>getComputedStyle(el).position') == 'fixed':
                                form.get_by_role('button', name='关闭', exact=True).focus()
                                page.keyboard.press('Tab')
                                expect(form.get_by_role('button', name='关闭详情', exact=True)).to_be_focused()
                                page.keyboard.press('Shift+Tab')
                                expect(form.get_by_role('button', name='关闭', exact=True)).to_be_focused()
                            form.get_by_role('button', name='关闭详情', exact=True).click()
                            expect(form).to_have_count(0)
                            assert len(dialogs) == count, 'Clean details should close without confirmation'
                            nav(panel, '日历')
                            expect(panel.locator('.fc')).to_be_visible()
                            expect(panel.get_by_role('button', name='准备阅读新的一章 · 安排', exact=True)).to_be_visible()
                            assert panel.evaluate('(el)=>el.scrollWidth<=el.clientWidth+1'), 'Calendar overflows'
                            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                            page.screenshot(path=str(artifacts / f'planner-{scheme}-{layout}-calendar.png'), animations='disabled')
                            nav(panel, '提醒')
                            expect(panel.get_by_role('heading', name='还没有提醒', exact=True)).to_be_visible()
                            expect(panel.get_by_role('button', name='允许网页通知', exact=True)).to_be_visible()
                            if scheme == 'dark' and width < 700:
                                exercise_interactions(page, panel, dialogs)
                                page.get_by_role('button', name='打开侧边栏', exact=True).click()
                                switch_language(page, '中文', 'English')
                                page.mouse.click(width - 5, height - 5)
                                panel = page.get_by_role('region', name='Tasks and calendar', exact=True)
                                panel.get_by_role('button', name='New task', exact=True).click()
                                form = panel.get_by_role('form', name='Item details', exact=True)
                                long_title = 'Review the interface details and preserve context across every screen'
                                form.get_by_label('Title', exact=True).fill(long_title)
                                more(form)
                                form.get_by_label('Description', exact=True).fill('AnUnbrokenDescription' * 60)
                                form.get_by_label('List', exact=True).fill('projects-' + 'x' * 91)
                                form.get_by_label('Title', exact=True).press('Enter')
                                expect(panel.get_by_role('status')).to_contain_text('Saved')
                                expect(form.get_by_role('button', name='Save', exact=True)).to_be_enabled()
                                page.keyboard.press('Escape')
                                expect(form).to_have_count(0)
                                nav(panel, 'All')
                                expect(panel.get_by_role('button', name=long_title, exact=True)).to_be_visible()
                                assert panel.evaluate('(el)=>el.scrollWidth<=el.clientWidth+1')
                                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                                page.screenshot(path=str(artifacts / 'planner-dark-mobile-english-long-text.png'), animations='disabled')
                            ctx.close()
                    assert not errors, errors
                    assert not external, external
                    browser.close()
                    print('PASS: real DSH planner light/dark at desktop/tablet/390px, readable contrast, keyboard filters, no horizontal overflow, reachable focused editor, calendar, rapid completion/restore, lost replies, stale versions, and dirty-draft close protection; no model/external requests. Chromium emulation only.')
            finally:
                host.terminate()
                try:
                    host.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    host.kill(); host.wait()


if __name__ == '__main__':
    main()
