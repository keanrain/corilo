"""Pinned DSH Web teaching flow, real client/host/tools, local scripted mock model."""
import json, os, pathlib, re, shutil, socket, sqlite3, subprocess, tempfile, time
from playwright.sync_api import sync_playwright, expect
ROOT = pathlib.Path(__file__).resolve().parents[2]
DSH = os.environ.get('LEARN_ANYTHING_DSH') or str(ROOT.parents[1]/'plugins/notes/node_modules/@deepseek-ai/dsh/lib/bin.js')
assert pathlib.Path(DSH).is_file(), 'Set LEARN_ANYTHING_DSH to pinned DSH lib/bin.js'
assert json.loads((pathlib.Path(DSH).resolve().parents[1]/'package.json').read_text())['version'] == json.loads((ROOT/'package.json').read_text())['engines']['dsh']
question = '一台自动售货机已付固定月租。新增一批饮料收入 90 元，新增进货电费 60 元。只考虑本批净收益，是否追加？说明理由。'
config = {
 'plan':[{'name':'course_save','args':{'goal':'Native tutor flow','status':'planning','chapters':[{'title':'决策','kps':[{'id':'margin','title':'增量决策','kind':'knowledge'}]}]}}],
 'learn':[{'name':'kp_define_models','args':{'kpId':'margin','models':[{'id':'map','type':'associative','input':'新增收入与成本','output':'是否追加','reference':'新增收入大于新增成本时追加；固定沉没支出不计入。'}]}},{'name':'diagnosis_record','args':{'kpId':'margin','modelId':'map','findings':[{'type':'upper-layer-loss','evidence':'用户尚未归纳规则'}],'prescription':['用新增收益与新增成本的对比说明规则']}},{'name':'kp_set_phase','args':{'kpId':'margin','modelId':'map','phase':'build','reason':'诊断后继承规则'}},{'name':'kp_get','args':{'kpId':'margin'}}],
 'quiz':[{'name':'kp_set_phase','args':{'kpId':'margin','modelId':'map','phase':'verify','reason':'用户已直接归纳规则'}},{'name':'quiz_show','args':{'question':question,'ui':'root = Quiz("新增一批饮料", "scenario", [Scene('+json.dumps(question,ensure_ascii=False)+'), Reason("你的方案与理由")])'}}],
 'grade':[{'name':'verification_record','args':{'kpId':'margin','modelId':'map','question':question,'questionType':'scenario'}},{'name':'progress_get','args':{}}],
 'review':[{'name':'review_due','args':{}}],
}
questions=[question,'有人说：已付月租越高，就越应追加亏损的一批货。这个判据对吗？为什么？','换一种说法解释：为什么选择追加生产时，要比较因这一步而变化的收入与支出？']
config['questions']=questions
config['quiz0']=config.pop('quiz')
config['grade0']=config.pop('grade')
for index,kind in [(1,'discriminate-neg'),(2,'rephrase')]:
 ui=('root = Quiz("复诊 '+str(index)+'", "'+kind+'", ['+ ('Choice("这个判据对吗？", ["对", "不对"]), Reason("你的方案与理由")' if index==1 else 'Rewrite("你的方案与理由", "新增决策的判断依据")')+'])')
 config['quiz'+str(index)]=[{'name':'quiz_show','args':{'question':questions[index],'ui':ui}}]
 config['grade'+str(index)]=[{'name':'verification_record','args':{'kpId':'margin','modelId':'map','question':questions[index],'questionType':kind}},{'name':'progress_get','args':{}}]
with tempfile.TemporaryDirectory(prefix='tutor-full-web-') as temp:
 base=pathlib.Path(temp); workspace=base/'workspace'; workspace.mkdir()
 database=workspace/'.learn/learner.sqlite'
 def read_document(key):
  connection=sqlite3.connect(database.as_uri()+'?mode=ro',uri=True)
  try:
   row=connection.execute('SELECT payload FROM documents WHERE key=?',(key,)).fetchone()
   return json.loads(row[0]) if row else None
  finally: connection.close()
 def read_verifications():
  connection=sqlite3.connect(database.as_uri()+'?mode=ro',uri=True)
  try: return [json.loads(row[0]) for row in connection.execute('SELECT payload FROM verifications ORDER BY seq')]
  finally: connection.close()
 def move_review_time(reviews):
  # Simulate time only in this disposable fixture, through the actual store API.
  script='import * as store from '+json.dumps((ROOT/'src/host/store.js').as_uri())+'; import {readFileSync} from "node:fs"; const cwd=process.argv[1]; await store.withWorkspaceWrite(cwd,()=>store.writeJson(store.paths(cwd).reviews,JSON.parse(readFileSync(0,"utf8"))));'
  result=subprocess.run(['node','--input-type=module','-e',script,str(workspace)],input=json.dumps(reviews),text=True,capture_output=True)
  assert result.returncode==0,result.stderr

 env=dict(os.environ,DSH_HOME=str(base/'harness'),DSH_AGENTS_HOME=str(base/'agents'),XDG_CONFIG_HOME=str(base/'config'),XDG_DATA_HOME=str(base/'data'),XDG_CACHE_HOME=str(base/'cache'),DSH_PERMISSION_MODE='danger-full-access')
 def cli(args):
  result=subprocess.run(['node',DSH,*args],cwd=base,env=env,capture_output=True,text=True,timeout=120)
  assert result.returncode==0, result.stdout+result.stderr
 cli(['--profile','flow','--from-default-profile','web','--dump-config'])
 cli(['plugin','--profile','flow','add',str(ROOT)])
 with socket.socket() as free: free.bind(('127.0.0.1',0)); model_port=free.getsockname()[1]
 (base/'model.json').write_text(json.dumps(config,ensure_ascii=False))
 env.update(DEEPSEEK_API_KEY='sk-synthetic-test',DEEPSEEK_BASE_URL=f'http://127.0.0.1:{model_port}',FLOW_CONFIG=str(base/'model.json'),FLOW_REQUESTS=str(base/'requests.jsonl'),FLOW_MODEL_PORT=str(model_port))
 observer=base/'observer.mjs'
 observer.write_text('''export const inject=['agents','agentPresets','agentDefaultModel']; export function apply(ctx){ (async()=>{ await ctx.get('loader')?.await(); const presets=ctx.get('agentPresets'); const sel=ctx.get('agentDefaultModel').currentSelection(); const {agent}=await ctx.agents.create({sessionId:'tutor-flow',meta:{cwd:process.cwd(),agentPreset:'learn-tutor'},agentOptions:sel,setup:async(a)=>{await presets.mount(a,'learn-tutor')}}); await agent.whenIdle(); agent.followup({role:'user',content:[{type:'text',text:'FLOW_PLAN'}],source:{kind:'user'}}); await agent.whenIdle(); })().catch(console.error); }''')
 patch=base/'patch.json'; patch.write_text(json.dumps([{'insert':[{'id':'flow-observer','name':str(observer)}]}]))
 with (base/'host.log').open('w') as host_log, (base/'model.log').open('w') as model_log:
  mock=subprocess.Popen(['node',str(ROOT/'test/browser/tutor-flow-model.mjs')],env=env,cwd=workspace,stdout=model_log,stderr=model_log)
  server=None
  try:
   for _ in range(100):
    if 'ready' in (base/'model.log').read_text(): break
    time.sleep(.05)
   server=subprocess.Popen(['node',DSH,'--profile','flow','--patch',str(patch),'--no-open','--port','0'],cwd=workspace,env=env,stdout=host_log,stderr=host_log)
   url=None
   for _ in range(500):
    found=re.search(r'dsh web: (http://127\.0\.0\.1:\d+/\?[^\s\x1b]+)',(base/'host.log').read_text())
    if found and database.exists(): url=found[1]; break
    assert server.poll() is None, (base/'host.log').read_text()
    time.sleep(.1)
   assert url, (base/'host.log').read_text()
   with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=shutil.which('chromium') or None)
    page=browser.new_page(viewport={'width':1440,'height':1100}); errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(url); page.wait_for_timeout(1500)
    if page.get_by_role('button',name='Continue',exact=True).count(): page.get_by_role('button',name='Continue',exact=True).click()
    page.get_by_text('Ungrouped',exact=True).click()
    page.get_by_text('Native tutor flow',exact=True).first.click(); page.wait_for_timeout(1500)
    page.get_by_role('button',name='Edit route',exact=True).click()
    with page.expect_response(lambda r:'/api/learn-anything/outline/save' in r.url) as locked:
     page.get_by_role('button',name='Confirm and lock',exact=True).click()
    assert locked.value.status==200, locked.value.text()
    expect(page.get_by_role('button',name='Edit route',exact=True)).to_have_count(0)
    assert read_document('course')['status']=='active'
    def send(text):
     editor=page.locator('[contenteditable=true]').first
     editor.fill(text); editor.press('Enter')
    send('FLOW_LEARN：请教我这个知识点，我还没有归纳规则。')
    expect(page.get_by_role('button',name='Edit my understanding',exact=True)).to_be_visible(timeout=30000)
    page.get_by_role('button',name='Edit my understanding',exact=True).click()
    page.get_by_label('Your explanation',exact=True).fill('我的规则：新增收入大于新增成本就追加，已经付掉的固定费用不参与比较。')
    page.get_by_label('Personal notes',exact=True).fill('通过真实 DSH 页面编辑的笔记')
    with page.expect_response(lambda r:'/api/learn-anything/target/save' in r.url) as saved:
     page.get_by_role('button',name='Save notes',exact=True).click()
    assert saved.value.status==200, saved.value.text()
    expect(page.get_by_role('button',name='Save notes',exact=True)).to_have_count(0)
    kp=read_document('kp/margin')
    assert kp['models'][0]['targetMap']['annotation']=='通过真实 DSH 页面编辑的笔记'
    assert not read_verifications()
    assert not (workspace/'.learn/course.json').exists(), 'new workspaces must not write legacy mirrors'
    for index in range(3):
     send('FLOW_QUIZ_'+str(index)+'：请用一个新情境验证。')
     quiz=page.locator('.la-quiz').last
     expect(quiz.get_by_role('heading',name='新增一批饮料' if index==0 else '复诊 '+str(index),exact=True)).to_be_visible(timeout=30000)
     if index==1: quiz.locator('.la-option').filter(has_text='不对').click()
     quiz.get_by_label('你的方案与理由',exact=True).fill('新增收入大于新增成本，应追加；固定支出不随本次决策变化。')
     quiz.get_by_role('button',name='Confident',exact=True).click()
     quiz.get_by_role('button',name='Submit answer',exact=True).click()
     expect(page.get_by_text('grade'+str(index)+' 完成。',exact=False)).to_be_visible(timeout=30000)
     records=read_verifications()
     assert len(records)==index+1, records
     assert records[-1]['evidence']['sessionId']=='tutor-flow'
     assert records[-1]['evidence']['examinerDigest']
     assert records[-1]['verdict']=='correct' and records[-1]['novel']
    for name in ['course.json','reviews.json','reminder.json','verifications.jsonl','diagnoses.jsonl']:
     assert not (workspace/'.learn'/name).exists(), 'SQLite must remain the sole learner authority'
    assert not (workspace/'.learn/kp').exists(), 'knowledge points belong in SQLite'
    reviews=read_document('reviews')
    assert 'margin/map' in reviews['cards']
    assert read_document('kp/margin')['models'][0]['mastery']=='proficient'
    # Advance only the disposable fixture's due time; production schedules are untouched.
    reviews['cards']['margin/map']['card']['due']='2000-01-01T00:00:00.000Z'
    move_review_time(reviews)
    send('FLOW_REVIEW：现在有哪些到期复习？')
    expect(page.get_by_text('到期复习 1 项：',exact=False)).to_be_visible(timeout=30000)
    requests=[json.loads(line) for line in (base/'requests.jsonl').read_text().splitlines()]
    failures=[block for request in requests for message in request['messages'] for block in (message['content'] if isinstance(message['content'],list) else []) if block.get('type')=='tool_result' and block.get('is_error')]
    assert not failures, failures
    assert sum('这是宿主发起的正式判题' in json.dumps(request['messages'],ensure_ascii=False) for request in requests)==3
    assert not errors, errors
    print('Pinned DSH Web tutoring flow passed: real outline lock, model/diagnosis tools, inline target save, 3 browser answers with independent mock-examiner evidence, SQLite evidence/mastery/FSRS scheduling and due review; synthetic local model, no live-model quality claim')
    browser.close()
  except Exception:
   if 'page' in locals() and not page.is_closed(): print('BROWSER BODY',page.locator('body').inner_text())
   print('HOST LOG', (base/'host.log').read_text()); print('MODEL LOG',(base/'model.log').read_text()); raise
  finally:
   for process in [server,mock]:
    if process:
     process.terminate()
     try: process.wait(timeout=10)
     except subprocess.TimeoutExpired: process.kill(); process.wait()
