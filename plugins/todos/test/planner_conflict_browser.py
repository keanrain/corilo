"""Real DSH regression coverage for conflict recovery and delayed save refresh."""
import json, os, pathlib, re, shutil, subprocess, tempfile, time, uuid
from playwright.sync_api import sync_playwright, expect
from datetime import datetime
from zoneinfo import ZoneInfo

def more(form):
 # Folded "更多" fields: open the native disclosure before touching them.
 form.evaluate("f=>{const d=f.querySelector('details.planner-editor-more');if(d)d.open=true}")

def exact(at, zone):
 # Conflict previews show the wall-clock time in the record's zone plus its offset.
 z=datetime.fromisoformat(at.replace('Z','+00:00')).astimezone(ZoneInfo(zone));o=z.strftime('%z')
 return z.strftime('%Y-%m-%d %H:%M')+f' (UTC{o[:3]}:{o[3:]})'
ROOT=pathlib.Path(__file__).resolve().parents[1]

def api(page,method,args=None):
 return page.evaluate('''async ({method,args})=>{
 const request=async(m,a,id)=>(await(await fetch('api/corilo-todos/v2/'+m,{method:'POST',headers:{'content-type':'application/json',...(id?{'x-corilo-todos-id':id}:{})},body:JSON.stringify(a)})).json());
 const identity=await request('identity',{}); const result=await request(method,args||{},identity.value.id); if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;
 }''',{'method':method,'args':args or {}})

def assert_preview(preview, expected):
 for label, value in expected.items():
  term=preview.locator('dt').filter(has_text=re.compile('^'+re.escape(label)+'$'))
  expect(term.locator('..').locator('dd')).to_have_text(value)

def delayed_save_refresh(page, form, task_id, receipt=False):
 host_plugins=page.get_by_role('button',name=re.compile(r'^(Plugins|插件)$'),exact=True)
 todos=page.get_by_role('button',name='待办',exact=True)
 writes=[];held=[]
 def record(request):
  if request.url.endswith('/v2/tasks/update'):writes.append(request.post_data_json)
 page.on('request',record)
 page.route('**/api/corilo-todos/v2/tasks/list',lambda route:held.append(route),times=1)
 if receipt:
  def lose(route):
   route.fetch();route.abort()
  page.route('**/api/corilo-todos/v2/tasks/update',lose,times=1)
 first='receipt snapshot' if receipt else 'normal snapshot'
 second=first+' plus newer draft'
 more(form)
 form.get_by_label('说明',exact=True).fill(first)
 form.get_by_role('button',name='保存',exact=True).click()
 if receipt:
  form.get_by_role('button',name='核对操作',exact=True).click()
 expect(page.get_by_role('status')).to_contain_text('已保存')
 expect(form.get_by_role('button',name='保存中…',exact=True)).to_be_disabled()
 expect(form.get_by_role('button',name='关闭详情',exact=True)).to_be_disabled()
 for _ in range(100):
  if held:break
  page.wait_for_timeout(20)
 assert len(held)==1
 more(form)
 form.get_by_label('说明',exact=True).fill(second)
 host_plugins.click()
 expect(form).to_have_count(0)
 todos.click()
 more(form)
 expect(form.get_by_label('说明',exact=True)).to_have_value(second)
 expect(form.get_by_role('button',name='保存中…',exact=True)).to_be_disabled()
 # Enter uses requestSubmit, so it also exercises the synchronous hook guard.
 form.get_by_label('标题',exact=True).press('Enter')
 assert len(writes)==1
 assert api(page,'tasks/read',{'id':task_id})['body']==first
 held[0].continue_()
 expect(form.get_by_role('button',name='保存',exact=True)).to_be_enabled()
 more(form)
 expect(form.get_by_label('说明',exact=True)).to_have_value(second)
 form.get_by_role('button',name='保存',exact=True).click()
 expect(page.get_by_role('status')).to_contain_text('已保存')
 expect(form.get_by_role('button',name='保存',exact=True)).to_be_enabled()
 assert api(page,'tasks/read',{'id':task_id})['body']==second
 assert len(writes)==2
 assert writes[0]['requestId']!=writes[1]['requestId']
 page.remove_listener('request',record)

def check_preview_order(page, form, task_id, external, preview, latest):
 held=[]
 def hold_response(route):
  held.append((route,route.fetch()))
 page.route('**/api/corilo-todos/v2/tasks/read',hold_response,times=1)
 latest.click()
 for _ in range(100):
  if held:break
  page.wait_for_timeout(20)
 assert len(held)==1 and held[0][1].json()['value']['version']==external['version']
 api(page,'tasks/update',{'requestId':str(uuid.uuid4()),'id':task_id,'expected':external['version'],'patch':{'due':{'kind':'instant','at':'2027-03-05T15:00:00Z','timeZone':'America/New_York'}}})
 latest.click()
 assert_preview(preview,{'截止类型':'精确时间','截止':exact('2027-03-05T15:00:00Z','America/New_York'),'截止时区':'America/New_York'})
 with page.expect_response(lambda res:res.url.endswith('/v2/tasks/read')):
  held[0][0].fulfill(response=held[0][1])
 # Wait for rendering after the older response has arrived.
 page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
 assert_preview(preview,{'截止类型':'精确时间','截止':exact('2027-03-05T15:00:00Z','America/New_York'),'截止时区':'America/New_York'})
 # If the old response was adopted, the actual following save is rejected.
 form.get_by_role('button',name='保留输入，按最新版本编辑',exact=True).click()
 form.get_by_role('button',name='保存',exact=True).click()
 expect(form.get_by_role('status')).to_have_text('已保存')

def main():
 with tempfile.TemporaryDirectory(prefix='corilo-planner-conflict-') as tmp:
  base=pathlib.Path(tmp)
  patch=base/'patch.json'
  patch.write_text(json.dumps([{'insert':[{'id':'corilo-todos','name':str(ROOT/'index.mjs'),'config':{'root':str(base/'data'),'planner':True}}]},{'id':'workspace-controller','config':{'documentsDirectory':str(base/'workspace')}}]))
  with (base/'host.log').open('w') as log:
   host=subprocess.Popen(['node',str(ROOT/'node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',str(patch),'--no-open','--port','0'],cwd=base,stdout=log,stderr=log,env=dict(os.environ,HOME=str(base/'user-home'),DSH_HOME=str(base/'harness'),DSH_AGENTS_HOME=str(base/'agents'),XDG_CONFIG_HOME=str(base/'config')))
   try:
    url=None
    for _ in range(600):
     assert host.poll() is None,'Host startup failed'
     match=re.search(r'dsh web: (http://127\.0\.0\.1:\d+/\?[^\s\x1b]+)',(base/'host.log').read_text())
     if match:url=match[1];break
     time.sleep(.1)
    assert url
    with sync_playwright() as p:
     browser=p.chromium.launch(headless=True,executable_path=shutil.which('chromium'))
     context=browser.new_context(locale='zh-CN',timezone_id='UTC',viewport={'width':1400,'height':950})
     page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
     page.goto(url)
     page.get_by_role('button',name=re.compile(r'^(Continue|继续)$'),exact=True).or_(page.get_by_role('button',name=re.compile(r'^(Close|关闭)$'),exact=True)).first.wait_for()
     if page.get_by_role('button',name=re.compile(r'^(Continue|继续)$'),exact=True).is_visible():page.get_by_role('button',name=re.compile(r'^(Continue|继续)$'),exact=True).click()
     page.get_by_role('button',name=re.compile(r'^(Close|关闭)$'),exact=True).click()
     page.get_by_role('button',name='待办',exact=True).click()
     expect(page.get_by_role('button',name='新建任务',exact=True)).to_be_enabled(timeout=20000)
     task=api(page,'tasks/create',{'requestId':str(uuid.uuid4()),'value':{'title':'Review synthetic task','body':'original body','plannedDate':'2026-12-01','reminderAt':'2026-12-01T09:00:00Z'}})
     page.get_by_role('button',name='全部',exact=True).click()
     page.get_by_role('button',name='Review synthetic task',exact=True).click()
     form=page.get_by_role('form',name='事项详情',exact=True)
     more(form)
     form.get_by_label('说明',exact=True).fill('local draft')
     external=api(page,'tasks/update',{'requestId':str(uuid.uuid4()),'id':task['id'],'expected':task['version'],'patch':{'title':'Remote task title','body':'Remote task body','status':'done','plannedDate':'2027-03-04','list':'Remote list','priority':'urgent','due':{'kind':'date','date':'2027-03-05','timeZone':'Asia/Tokyo'},'reminderAt':'2027-03-04T10:00:00Z'}})
     form.get_by_role('button',name='保存',exact=True).click()
     expect(page.get_by_role('status')).to_contain_text('版本冲突')
     latest=form.get_by_role('button',name='查看最新记录',exact=True)
     expect(latest).to_be_visible()
     more(form)
     form.get_by_label('说明',exact=True).fill('edited after conflict')
     expect(latest).to_be_visible()
     form.get_by_role('button',name='保存',exact=True).click()
     expect(page.get_by_role('status')).to_contain_text('版本冲突')
     latest.click()
     preview=form.locator('section').filter(has=page.get_by_role('heading',name='服务器最新内容',exact=True))
     expect(preview).to_be_visible()
     assert_preview(preview,{'标题':'Remote task title','说明':'Remote task body','状态':'完成','计划日期':'2027-03-04','清单':'Remote list','优先级':'紧急','截止类型':'日期','截止':'2027-03-05','截止时区':'Asia/Tokyo','提醒':exact('2027-03-04T10:00:00Z','UTC')})
     more(form)
     expect(form.get_by_label('说明',exact=True)).to_have_value('edited after conflict')
     assert form.get_by_label('计划日期',exact=True).input_value()=='2026-12-01'
     check_preview_order(page,form,task['id'],external,preview,latest)
     persisted=api(page,'tasks/read',{'id':task['id']})
     assert persisted['plannedDate']=='2026-12-01' and persisted['reminderAt']=='2026-12-01T09:00:00Z'
     form.get_by_role('button',name='关闭详情',exact=True).click()
     page.get_by_role('button',name='Review synthetic task',exact=True).click()
     # Cleared server fields must be visible, and adoption must reset conflict state.
     more(form)
     form.get_by_label('说明',exact=True).fill('Draft before cleared fields')
     api(page,'tasks/update',{'requestId':str(uuid.uuid4()),'id':task['id'],'expected':persisted['version'],'patch':{'body':'Server cleared optional fields','plannedDate':None,'list':'','due':None,'reminderAt':None}})
     form.get_by_role('button',name='保存',exact=True).click()
     expect(page.get_by_role('status')).to_contain_text('版本冲突')
     latest.click()
     assert_preview(preview,{'计划日期':'未设置','清单':'未设置','截止类型':'无截止','截止':'未设置','截止时区':'未设置','提醒':'未设置'})
     form.get_by_role('button',name='采用服务器内容',exact=True).click()
     expect(latest).to_have_count(0)
     expect(preview).to_have_count(0)
     expect(form.get_by_role('alert')).to_have_count(0)
     more(form)
     expect(form.get_by_label('说明',exact=True)).to_have_value('Server cleared optional fields')
     expect(form.get_by_label('计划日期',exact=True)).to_have_value('')
     expect(form.get_by_label('提醒日期',exact=True)).to_have_value('')
     expect(form.get_by_label('提醒时间',exact=True)).to_have_value('')
     delayed_save_refresh(page,form,task['id'])
     delayed_save_refresh(page,form,task['id'],receipt=True)
     form.get_by_role('button',name='关闭详情',exact=True).click()
     # The event preview must cover both timed and all-day representations.
     day=page.evaluate('new Date().toISOString().slice(0,10)')
     completed=api(page,'tasks/create',{'requestId':str(uuid.uuid4()),'value':{'title':'Completed task outside the calendar list','status':'done'}})
     event=api(page,'calendar/create',{'requestId':str(uuid.uuid4()),'value':{'title':'Conflict event','allDay':False,'start':day+'T09:00:00Z','end':day+'T10:00:00Z','timeZone':'UTC','taskId':task['id']}})
     page.get_by_role('button',name='日历',exact=True).click()
     page.locator('.fc-event').filter(has_text='Conflict event').first.click()
     more(form)
     form.get_by_label('说明',exact=True).fill('Local event draft')
     remote=api(page,'calendar/update',{'requestId':str(uuid.uuid4()),'id':event['id'],'expected':event['version'],'patch':{'title':'Remote event','body':'Remote event body','status':'cancelled','start':day+'T11:00:00Z','end':day+'T12:00:00Z','timeZone':'Asia/Tokyo','location':'Room 2','taskId':completed['id'],'reminderAt':day+'T10:30:00Z'}})
     form.get_by_role('button',name='保存',exact=True).click()
     expect(page.get_by_role('status')).to_contain_text('版本冲突')
     more(form)
     form.get_by_label('地点',exact=True).fill('Local room')
     expect(latest).to_be_visible()
     latest.click()
     assert_preview(preview,{'标题':'Remote event','说明':'Remote event body','状态':'取消','全天':'否','开始':exact(day+'T11:00:00Z','Asia/Tokyo'),'结束':exact(day+'T12:00:00Z','Asia/Tokyo'),'日程原时区':'Asia/Tokyo','地点':'Room 2','关联任务':completed['title'],'提醒':exact(day+'T10:30:00Z','UTC')})
     form.get_by_role('button',name='采用服务器内容',exact=True).click()
     more(form)
     linked=form.get_by_label('关联任务',exact=True)
     expect(linked).to_have_value(completed['id'])
     expect(linked.locator('option:checked')).to_have_text(completed['title'])
     more(form)
     form.get_by_label('说明',exact=True).fill('Edit while preserving the completed task link')
     form.get_by_role('button',name='保存',exact=True).click()
     expect(form.get_by_role('status')).to_have_text('已保存')
     remote=api(page,'calendar/read',{'id':event['id']})
     assert remote['taskId']==completed['id']
     end=page.evaluate("day=>{const date=new Date(day);date.setUTCDate(date.getUTCDate()+1);return date.toISOString().slice(0,10)}",day)
     api(page,'calendar/update',{'requestId':str(uuid.uuid4()),'id':event['id'],'expected':remote['version'],'patch':{'allDay':True,'start':day,'end':end,'location':'','taskId':None,'reminderAt':None}})
     more(form)
     form.get_by_label('说明',exact=True).fill('Edit before the second conflict')
     form.get_by_role('button',name='保存',exact=True).click()
     expect(form.get_by_role('status')).to_contain_text('版本冲突')
     latest.click()
     assert_preview(preview,{'全天':'是','开始':day,'结束':day,'地点':'未设置','关联任务':'独立事件','提醒':'未设置'})
     form.get_by_role('button',name='采用服务器内容',exact=True).click()
     expect(form.get_by_label('全天',exact=True)).to_be_checked()
     expect(form.get_by_label('开始',exact=True)).to_have_value(day)
     more(form)
     expect(form.get_by_label('关联任务',exact=True)).to_have_value('')
     expect(latest).to_have_count(0)
     assert not errors,errors
     browser.close()
     print('PASS: task/event conflicts, out-of-order previews, off-list linked tasks, and delayed save/receipt refresh across host panels',flush=True)
   finally:
    host.terminate()
    try:host.wait(timeout=15)
    except subprocess.TimeoutExpired:host.kill();host.wait()

if __name__=='__main__':main()
