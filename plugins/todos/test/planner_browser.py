"""Planner in real pinned Harness; synthetic data only."""
import json, os, pathlib, re, shutil, subprocess, tempfile, time, uuid
from playwright.sync_api import sync_playwright, expect

def more(form):
 # Folded "更多" fields: open the native disclosure before touching them.
 form.evaluate("f=>{const d=f.querySelector('details.planner-editor-more');if(d)d.open=true}")

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
     # The display zone applies at once: no confirmation gate before the list.
     expect(page.get_by_role('button',name='新建任务',exact=True)).to_be_enabled(timeout=20000)
     expect(page.get_by_role('button',name='确认时区',exact=True)).to_have_count(0)
     # Adding from Today keeps the task in Today (it used to fall into the inbox).
     page.get_by_role('button',name='今天',exact=True).click()
     page.get_by_role('button',name='添加任务',exact=True).click()
     quick=page.get_by_role('form',name='事项详情')
     expect(quick.get_by_label('计划日期',exact=True)).not_to_have_value('')
     quick.get_by_label('标题',exact=True).fill('今天快速添加')
     quick.get_by_role('button',name='保存',exact=True).click()
     expect(page.get_by_role('status')).to_contain_text('已保存')
     quick.get_by_role('button',name='关闭',exact=True).click()
     expect(page.get_by_role('button',name='今天快速添加',exact=True)).to_be_visible()
     # Today shows the day's events above its tasks.
     page.evaluate("""async (zone) => {
       const send=async(m,a,id)=>(await(await fetch('api/corilo-todos/v2/'+m,{method:'POST',headers:{'content-type':'application/json',...(id?{'x-corilo-todos-id':id}:{})},body:JSON.stringify(a)})).json()).value;
       const identity=await send('identity',{});
       const day=new Intl.DateTimeFormat('en-CA',{timeZone:zone}).format(new Date());
       await send('calendar/create',{requestId:crypto.randomUUID(),value:{title:'今天的全天日程',allDay:true,start:day,end:new Date(Date.parse(day)+864e5).toISOString().slice(0,10),timeZone:zone}},identity.id);
     }""", page.evaluate('Intl.DateTimeFormat().resolvedOptions().timeZone'))
     page.get_by_role('button',name='刷新',exact=True).click()
     agenda=page.get_by_role('region',name='今日日程')
     expect(agenda).to_contain_text('今天的全天日程')
     expect(agenda).to_contain_text('全天')
     # Sidebar lists: a named list is a place with a live count; Enter in the
     # inline field adds straight into it.
     page.evaluate("""async () => {
       const send=async(m,a,id)=>(await(await fetch('api/corilo-todos/v2/'+m,{method:'POST',headers:{'content-type':'application/json',...(id?{'x-corilo-todos-id':id}:{})},body:JSON.stringify(a)})).json()).value;
       const identity=await send('identity',{});
       await send('tasks/create',{requestId:crypto.randomUUID(),value:{title:'撑墙转体',body:'双手撑墙，掌心向外拿住弹力带',list:'康复'}},identity.id);
     }""")
     page.get_by_role('button',name='刷新',exact=True).click()
     side=page.get_by_role('complementary',name='任务视图')
     rehab=side.get_by_role('button',name='康复',exact=True)
     expect(rehab).to_contain_text('1')
     rehab.click()
     expect(rehab).to_have_attribute('aria-pressed','true')
     expect(page.get_by_role('heading',name='康复',exact=True)).to_be_visible()
     expect(page.get_by_text('双手撑墙，掌心向外拿住弹力带')).to_be_visible()
     quick=page.get_by_role('textbox',name='快速添加任务',exact=True)
     quick.fill('侧卧转体')
     quick.press('Enter')
     expect(page.get_by_role('button',name='侧卧转体',exact=True)).to_be_visible()
     expect(quick).to_have_value('')
     expect(rehab).to_contain_text('2')
     # The real write succeeds but its response is lost. Receipt acceptance
     # must clear its quick-add title so Enter cannot create a duplicate.
     def lose_quick_response(route):
      assert route.fetch().json()['ok']
      route.abort()
     page.route('**/api/corilo-todos/v2/tasks/create',lose_quick_response,times=1)
     received='已收回执的快速任务'
     quick.fill(received)
     quick.press('Enter')
     expect(quick).to_have_value(received)
     page.get_by_role('button',name='核对操作',exact=True).click()
     expect(quick).to_have_value('')
     expect(page.get_by_role('button',name=received,exact=True)).to_have_count(1)
     # Input entered before the response belongs to the next task.
     held=[]
     page.route('**/api/corilo-todos/v2/tasks/create',lambda route:held.append(route),times=1)
     quick.fill('先提交的快速任务')
     quick.press('Enter')
     expect(page.get_by_role('button',name='新建任务',exact=True)).to_be_disabled()
     quick.fill('下一项尚未保存')
     assert len(held)==1
     held[0].continue_()
     expect(page.get_by_role('button',name='先提交的快速任务',exact=True)).to_be_visible()
     expect(quick).to_have_value('下一项尚未保存')
     quick.press('Escape')
     side.get_by_role('button',name='今天',exact=True).click()
     # A reload must not bring the confirmation gate back.
     page.reload()
     page.get_by_role('button',name=re.compile(r'^(Continue|继续)$'),exact=True).or_(page.get_by_role('button',name=re.compile(r'^(Close|关闭)$'),exact=True)).first.wait_for()
     if page.get_by_role('button',name=re.compile(r'^(Continue|继续)$'),exact=True).is_visible():page.get_by_role('button',name=re.compile(r'^(Continue|继续)$'),exact=True).click()
     page.get_by_role('button',name=re.compile(r'^(Close|关闭)$'),exact=True).click()
     page.get_by_role('button',name='待办',exact=True).click()
     expect(page.get_by_role('button',name='今天快速添加',exact=True)).to_be_visible(timeout=20000)
     page.get_by_role('button',name='新建任务',exact=True).click()
     form=page.get_by_role('form',name='事项详情')
     form.get_by_label('标题',exact=True).fill('恢复的任务')
     more(form)
     form.get_by_label('说明',exact=True).fill('合成数据')
     form.get_by_label('计划日期',exact=True).fill('2026-11-15')
     more(form)
     form.get_by_label('优先级',exact=True).select_option('high')
     more(form)
     form.get_by_label('清单',exact=True).fill('工作')
     form.get_by_role('button',name='保存',exact=True).click()
     expect(page.get_by_role('status')).to_contain_text('已保存')
     page.on('dialog',lambda d:d.accept())
     form.get_by_role('button',name='关闭',exact=True).click()
     page.get_by_role('button',name='全部',exact=True).click()
     expect(page.get_by_role('button',name='恢复的任务',exact=True)).to_be_visible()
     page.get_by_role('button',name='恢复的任务',exact=True).click()
     # This task has a description, a list and high priority: the folded section opens by itself.
     expect(form.get_by_label('说明',exact=True)).to_be_visible()
     more(form)
     form.get_by_label('说明',exact=True).fill('丢响应后仍保留')
     # Commit the actual request, then lose only its response.
     def lose(route):
      route.fetch();route.abort()
     page.route('**/api/corilo-todos/v2/tasks/update',lose,times=1)
     form.get_by_role('button',name='保存',exact=True).click()
     form.get_by_role('button',name='核对操作',exact=True).click()
     expect(page.get_by_role('status')).to_contain_text('已保存')
     more(form)
     expect(form.get_by_label('说明',exact=True)).to_have_value('丢响应后仍保留')
     # A separate authenticated writer wins; local text must survive the conflict.
     more(form)
     form.get_by_label('说明',exact=True).fill('冲突时保留输入')
     page.evaluate("""async () => {
       const send = async (method,args,id) => (await (await fetch('api/corilo-todos/v2/'+method,{method:'POST',headers:{'content-type':'application/json',...(id?{'x-corilo-todos-id':id}:{})},body:JSON.stringify(args)})).json()).value;
       const identity=await send('identity',{});const list=await send('tasks/list',{view:'all',timeZone:'UTC'},identity.id);const task=list.items[0];
       await send('tasks/update',{requestId:crypto.randomUUID(),id:task.id,expected:task.version,patch:{body:'其他浏览器的修改'}},identity.id);
     }""")
     form.get_by_role('button',name='保存',exact=True).click()
     expect(page.get_by_role('status')).to_contain_text('版本冲突')
     more(form)
     expect(form.get_by_label('说明',exact=True)).to_have_value('冲突时保留输入')
     form.get_by_role('button',name='查看最新记录',exact=True).click()
     form.get_by_role('button',name='保留输入，按最新版本编辑',exact=True).click()
     form.get_by_role('button',name='保存',exact=True).click()
     expect(page.get_by_role('status')).to_contain_text('已保存')
     more(form)
     form.get_by_label('状态',exact=True).select_option('cancelled')
     form.get_by_role('button',name='保存',exact=True).click()
     expect(page.get_by_role('status')).to_contain_text('已保存')
     form.get_by_role('button',name='关闭',exact=True).click()
     page.get_by_role('button',name='已取消',exact=True).click()
     page.get_by_role('button',name='恢复的任务',exact=True).click()
     more(form)
     form.get_by_label('状态',exact=True).select_option('open')
     form.get_by_role('button',name='保存',exact=True).click()
     expect(page.get_by_role('status')).to_contain_text('已保存')
     form.get_by_role('button',name='关闭',exact=True).click()
     # Saved events are only visible in Today and Calendar, so the button is offered only there.
     expect(page.get_by_role('button',name='新建日程',exact=True)).to_have_count(0)
     side.get_by_role('button',name='今天',exact=True).click()
     page.get_by_role('button',name='新建日程',exact=True).click()
     # Folded fields start closed for a fresh event and the title stays reachable.
     expect(form.get_by_label('说明',exact=True)).to_be_hidden()
     form.get_by_label('标题',exact=True).fill('全天安排')
     form.get_by_role('button',name='保存',exact=True).click()
     expect(form.get_by_role('status')).to_contain_text('已保存')
     # A success notice fades on its own after a few seconds.
     expect(form.get_by_role('status')).to_have_text('',timeout=6000)
     form.get_by_role('button',name='关闭',exact=True).click()
     # All-day end is inclusive in the form; unchecking all-day keeps the chosen date.
     page.get_by_role('button',name='新建日程',exact=True).click()
     form.get_by_label('标题',exact=True).fill('全天往返')
     form.get_by_label('开始',exact=True).fill('2027-02-03')
     expect(form.get_by_label('结束',exact=True)).to_have_value('2027-02-03')
     form.get_by_label('结束',exact=True).fill('2027-02-02')
     expect(form.get_by_role('alert')).to_contain_text('结束日期不能早于开始日期')
     expect(form.get_by_role('button',name='保存',exact=True)).to_be_disabled()
     form.get_by_label('结束',exact=True).fill('2027-02-04')
     form.get_by_label('全天',exact=True).uncheck()
     expect(form.get_by_label('开始日期',exact=True)).to_have_value('2027-02-03')
     expect(form.get_by_label('开始时间',exact=True)).to_have_value('09:00')
     expect(form.get_by_label('结束时间',exact=True)).to_have_value('09:30')
     form.get_by_label('全天',exact=True).check()
     expect(form.get_by_label('开始',exact=True)).to_have_value('2027-02-03')
     expect(form.get_by_label('结束',exact=True)).to_have_value('2027-02-03')
     form.get_by_label('结束',exact=True).fill('2027-02-04')
     form.get_by_role('button',name='保存',exact=True).click()
     expect(form.get_by_role('status')).to_contain_text('已保存')
     saved_allday=page.evaluate("""async () => {
       const send=async(m,a,id)=>(await(await fetch('api/corilo-todos/v2/'+m,{method:'POST',headers:{'content-type':'application/json',...(id?{'x-corilo-todos-id':id}:{})},body:JSON.stringify(a)})).json()).value;
       const identity=await send('identity',{});
       const r=await send('calendar/range',{start:'2027-02-01T00:00:00Z',end:'2027-02-10T00:00:00Z',timeZone:'UTC'},identity.id);
       return r.items.find(e=>e.title==='全天往返');
     }""")
     assert saved_allday['start']=='2027-02-03' and saved_allday['end']=='2027-02-05', saved_allday
     form.get_by_role('button',name='关闭',exact=True).click()
     # Timed events and reminders use date + time controls in the record's zone.
     zone=page.evaluate('Intl.DateTimeFormat().resolvedOptions().timeZone')
     from datetime import datetime, timezone as tz
     from zoneinfo import ZoneInfo
     utc=lambda d,t:datetime.fromisoformat(f'{d}T{t}').replace(tzinfo=ZoneInfo(zone)).astimezone(tz.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
     page.get_by_role('button',name='新建日程',exact=True).first.click()
     form.get_by_label('标题',exact=True).fill('定时安排')
     form.get_by_label('全天',exact=True).uncheck()
     form.get_by_label('开始日期',exact=True).fill('2027-01-05')
     form.get_by_label('开始时间',exact=True).fill('09:00')
     expect(form.get_by_label('结束时间',exact=True)).to_have_value('09:30')
     form.get_by_role('button',name='开始前 1 小时',exact=True).click()
     expect(form.get_by_label('提醒时间',exact=True)).to_have_value('08:00')
     form.get_by_role('button',name='保存',exact=True).click()
     expect(page.get_by_role('status')).to_contain_text('已保存')
     form.get_by_role('button',name='关闭',exact=True).click()
     saved=page.evaluate("""async () => {
       const send=async(m,a,id)=>(await(await fetch('api/corilo-todos/v2/'+m,{method:'POST',headers:{'content-type':'application/json',...(id?{'x-corilo-todos-id':id}:{})},body:JSON.stringify(a)})).json()).value;
       const identity=await send('identity',{});
       const r=await send('calendar/range',{start:'2027-01-04T00:00:00Z',end:'2027-01-07T00:00:00Z',timeZone:'UTC'},identity.id);
       return r.items.find(e=>e.title==='定时安排');
     }""")
     assert saved['start']==utc('2027-01-05','09:00') and saved['end']==utc('2027-01-05','09:30') and saved['reminderAt']==utc('2027-01-05','08:00'), saved
     # A reminder time that has passed is flagged instead of silently ignored.
     page.get_by_role('button',name='全部',exact=True).click()
     page.get_by_role('button',name='今天快速添加',exact=True).click()
     form.get_by_label('提醒日期',exact=True).fill('2020-01-01')
     form.get_by_label('提醒时间',exact=True).fill('09:00')
     expect(form.get_by_text('这个时间已过，不会提醒')).to_be_visible()
     form.get_by_role('button',name='清除',exact=True).click()
     expect(form.get_by_text('这个时间已过，不会提醒')).to_have_count(0)
     page.on('dialog',lambda d:d.accept())
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
     more(form)
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
