"""Planner appearance and reachable controls in real DSH; synthetic data only."""
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
from playwright.sync_api import sync_playwright, expect
from core_browser import wait_for

ROOT = pathlib.Path(__file__).resolve().parents[1]


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
                        for width, height, layout in [(1400, 950, 'desktop'), (390, 844, 'mobile')]:
                            ctx = browser.new_context(locale='zh-CN', timezone_id='UTC', color_scheme=scheme, viewport={'width': width, 'height': height}, has_touch=width < 700)
                            page = ctx.new_page()
                            page.on('pageerror', lambda error: errors.append(str(error)))
                            page.on('request', lambda req: external.append(req.url.split('?')[0]) if req.url.startswith('http') and not req.url.startswith(origin + '/') else None)
                            page.goto(url)
                            page.get_by_role('button', name=re.compile(r'^(Continue|继续)$'), exact=True).or_(page.get_by_role('button', name=re.compile(r'^(Close|关闭)$'), exact=True)).first.wait_for()
                            if page.get_by_role('button', name=re.compile(r'^(Continue|继续)$'), exact=True).is_visible():
                                page.get_by_role('button', name=re.compile(r'^(Continue|继续)$'), exact=True).click()
                            page.get_by_role('button', name=re.compile(r'^(Close|关闭)$'), exact=True).click()
                            if width < 700:
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
                            panel.get_by_role('button', name='确认时区', exact=True).click()
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
                            panel.get_by_role('button', name='准备阅读新的一章', exact=True).click()
                            form = panel.get_by_role('form', name='事项详情', exact=True)
                            expect(form.get_by_label('标题', exact=True)).to_be_focused()
                            assert form.bounding_box()['width'] <= width
                            form.get_by_role('button', name='保存', exact=True).scroll_into_view_if_needed()
                            box = form.get_by_role('button', name='保存', exact=True).bounding_box()
                            assert box and 0 <= box['y'] < height - 20, 'Save action is unreachable'
                            page.screenshot(path=str(artifacts / f'planner-{scheme}-{layout}-details.png'), animations='disabled')
                            page.once('dialog', lambda dialog: dialog.accept())
                            form.get_by_role('button', name='关闭详情', exact=True).click()
                            panel.get_by_role('button', name='日历', exact=True).click()
                            expect(panel.locator('.fc')).to_be_visible()
                            expect(panel.get_by_role('button', name='准备阅读新的一章 · 安排', exact=True)).to_be_visible()
                            assert panel.evaluate('(el)=>el.scrollWidth<=el.clientWidth+1'), 'Calendar overflows'
                            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                            page.screenshot(path=str(artifacts / f'planner-{scheme}-{layout}-calendar.png'), animations='disabled')
                            panel.get_by_role('button', name='提醒', exact=True).click()
                            expect(panel.get_by_role('heading', name='还没有提醒', exact=True)).to_be_visible()
                            expect(panel.get_by_role('button', name='允许网页通知', exact=True)).to_be_visible()
                            ctx.close()
                    assert not errors, errors
                    assert not external, external
                    browser.close()
                    print('PASS: real DSH planner light/dark at desktop/390px, readable contrast, keyboard filters, no horizontal overflow, reachable focused editor, and calendar; no model/external requests. Chromium emulation only.')
            finally:
                host.terminate()
                try:
                    host.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    host.kill(); host.wait()


if __name__ == '__main__':
    main()
