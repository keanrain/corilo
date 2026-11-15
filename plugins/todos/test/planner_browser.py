"""Planner in real pinned Harness; synthetic data only."""
import json, os, pathlib, re, shutil, subprocess, tempfile, time, uuid
from playwright.sync_api import sync_playwright, expect
ROOT=pathlib.Path(__file__).resolve().parents[1]
def main():
 with tempfile.TemporaryDirectory(prefix='corilo-planner-browser-') as tmp:
  base=pathlib.Path(tmp)
  patch=base/'patch.json'
  patch.write_text(json.dumps([{'insert':[{'id':'corilo-todos','name':str(ROOT/'index.mjs'),'config':{'root':str(base/'data'),'planner':True}}]},{'id':'workspace-controller','config':{'documentsDirectory':str(base/'workspace')}}]))
  with (base/'host.log').open('w') as log:
   env=dict(os.environ,DSH_HOME=str(base/'harness'),DSH_AGENTS_HOME=str(base/'agents'),XDG_CONFIG_HOME=str(base/'config'))
   host=subprocess.Popen(['node',str(ROOT/'node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',str(patch),'--no-open','--port','0'],cwd=base,env=env,stdout=log,stderr=log)
   try:
    url=None
    for _ in range(600):
     assert host.poll() is None, (base/'host.log').read_text()[-3000:]
     m=re.search(r'dsh web: (http://127\.0\.0\.1:\d+/\?[^\s\x1b]+)',(base/'host.log').read_text())
     if m: url=m[1];break
     time.sleep(.1)
    assert url,'No Harness address'
    with sync_playwright() as p:
     browser=p.chromium.launch(headless=True,executable_path=shutil.which('chromium'))
     context=browser.new_context(locale='zh-CN', viewport={'width':1400,'height':950})
     page=context.new_page();errors=[];page.on('pageerror',lambda e:(errors.append(str(e)),print('PAGE ERROR',str(e),flush=True)))
     page.goto(url)
     first=page.get_by_role('button',name=re.compile(r'^(Continue|继续)$'),exact=True).or_(page.get_by_role('button',name=re.compile(r'^(Close|关闭)$'),exact=True)).first;first.wait_for()
     if page.get_by_role('button',name=re.compile(r'^(Continue|继续)$'),exact=True).is_visible():page.get_by_role('button',name=re.compile(r'^(Continue|继续)$'),exact=True).click()
     page.get_by_role('button',name=re.compile(r'^(Close|关闭)$'),exact=True).click()
     page.get_by_role('button',name='待办',exact=True).click()
     page.get_by_role('button',name='确认时区',exact=True).click(timeout=20000)
     page.get_by_role('button',name='新建任务',exact=True).click()
     form=page.get_by_role('form',name='事项详情')
     form.get_by_label('标题',exact=True).fill('恢复的任务')
     form.get_by_label('说明',exact=True).fill('合成数据')
     form.get_by_label('计划日期',exact=True).fill('2026-11-15')
     form.get_by_label('优先级',exact=True).select_option('high')
     form.get_by_label('清单',exact=True).fill('工作')
     form.get_by_role('button',name='保存',exact=True).click()
     expect(page.get_by_role('status')).to_contain_text('已保存')
     page.on('dialog',lambda d:d.accept())
     form.get_by_role('button',name='关闭',exact=True).click()
     page.get_by_role('button',name='全部',exact=True).click()
     expect(page.get_by_role('button',name='恢复的任务',exact=True)).to_be_visible()
     page.get_by_role('button',name='恢复的任务',exact=True).click()
     form.get_by_label('说明',exact=True).fill('丢响应后仍保留')
     # Commit the actual request, then lose only its response.
     def lose(route):
      route.fetch();route.abort()
     page.route('**/api/corilo-todos/v2/tasks/update',lose,times=1)
     form.get_by_role('button',name='保存',exact=True).click()
     form.get_by_role('button',name='核对操作',exact=True).click()
     expect(page.get_by_role('status')).to_contain_text('已保存')
     expect(form.get_by_label('说明',exact=True)).to_have_value('丢响应后仍保留')
     # A separate authenticated writer wins; local text must survive the conflict.
     form.get_by_label('说明',exact=True).fill('冲突时保留输入')
     page.evaluate("""async () => {
       const send = async (method,args,id) => (await (await fetch('api/corilo-todos/v2/'+method,{method:'POST',headers:{'content-type':'application/json',...(id?{'x-corilo-todos-id':id}:{})},body:JSON.stringify(args)})).json()).value;
       const identity=await send('identity',{});const list=await send('tasks/list',{view:'all',timeZone:'UTC'},identity.id);const task=list.items[0];
       await send('tasks/update',{requestId:crypto.randomUUID(),id:task.id,expected:task.version,patch:{body:'其他浏览器的修改'}},identity.id);
     }""")
     form.get_by_role('button',name='保存',exact=True).click()
     expect(page.get_by_role('status')).to_contain_text('版本冲突')
     expect(form.get_by_label('说明',exact=True)).to_have_value('冲突时保留输入')
     form.get_by_role('button',name='查看最新记录',exact=True).click()
     form.get_by_role('button',name='保留输入，按最新版本编辑',exact=True).click()
     form.get_by_role('button',name='保存',exact=True).click()
     expect(page.get_by_role('status')).to_contain_text('已保存')
     form.get_by_label('状态',exact=True).select_option('cancelled')
     form.get_by_role('button',name='保存',exact=True).click()
     expect(page.get_by_role('status')).to_contain_text('已保存')
     form.get_by_role('button',name='关闭',exact=True).click()
     page.get_by_role('button',name='已取消',exact=True).click()
     page.get_by_role('button',name='恢复的任务',exact=True).click()
     form.get_by_label('状态',exact=True).select_option('open')
     form.get_by_role('button',name='保存',exact=True).click()
     expect(page.get_by_role('status')).to_contain_text('已保存')
     form.get_by_role('button',name='关闭',exact=True).click()
     page.get_by_role('button',name='新建日程',exact=True).click()
     form.get_by_label('标题',exact=True).fill('全天安排')
     form.get_by_role('button',name='保存',exact=True).click()
     expect(page.get_by_role('status')).to_contain_text('已保存')
     form.get_by_role('button',name='关闭',exact=True).click()
     page.get_by_role('button',name='日历',exact=True).click()
     expect(page.locator('.fc')).to_be_visible()
     for name in ['周','日','日程','月']:
      page.locator('.fc').get_by_role('button',name=name,exact=True).click()
     # The calendar must allow arranging a task beyond its first 100 rows.
     page.evaluate("""async () => {
       const send=async(method,args,id)=>(await(await fetch('api/corilo-todos/v2/'+method,{method:'POST',headers:{'content-type':'application/json',...(id?{'x-corilo-todos-id':id}:{})},body:JSON.stringify(args)})).json()).value;
       const identity=await send('identity',{});
       for(let i=0;i<105;i++)await send('tasks/create',{requestId:crypto.randomUUID(),value:{title:'分页合成 '+i}},identity.id);
     }""")
     page.get_by_role('button',name='刷新',exact=True).click()
     sidebar=page.get_by_label('可安排任务',exact=True)
     sidebar.get_by_role('button',name='加载更多可安排任务',exact=True).wait_for()
     expect(sidebar.get_by_role('button',name='恢复的任务 · 安排',exact=True)).to_have_count(0)
     sidebar.get_by_role('button',name='加载更多可安排任务',exact=True).click()
     sidebar.get_by_role('button',name='恢复的任务 · 安排',exact=True).click()
     expect(form.get_by_label('标题',exact=True)).to_have_value('恢复的任务')
     expect(form.get_by_label('关联任务',exact=True)).not_to_have_value('')
     form.get_by_role('button',name='关闭',exact=True).click()
     page.set_viewport_size({'width':390,'height':844})
     page.get_by_role('button',name='新建任务',exact=True).click()
     expect(form.get_by_role('button',name='保存',exact=True)).to_be_visible()
     assert page.locator('.planner-editor').evaluate('(e)=>e.getBoundingClientRect().width')<=390
     page.screenshot(path='/tmp/corilo-planner-mobile.png')
     assert not errors,errors
     browser.close()
     print('PASS: real Harness planner task save/cancel/restore, lost response reconciliation, all-day event, calendar views, beyond-100 task scheduling, 390px editor')
   finally:
    host.terminate()
    try:host.wait(timeout=15)
    except subprocess.TimeoutExpired:host.kill();host.wait()
if __name__=='__main__':main()
