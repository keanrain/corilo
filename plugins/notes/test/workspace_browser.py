"""Actual published Harness + pinned Files.md; synthetic disk data, zero models."""
import os,json,pathlib,tempfile,subprocess,re,time,shutil,base64
from playwright.sync_api import sync_playwright,expect
ROOT=pathlib.Path(__file__).resolve().parents[1]
def run():
 with tempfile.TemporaryDirectory(prefix='corilo-workspace-browser-') as temp:
  base=pathlib.Path(temp);notes=base/'notes';notes.mkdir()
  (notes/'Cafe\u0301.md').write_text('保留原始文件名')
  (notes/'Hello.md').write_text('原始正文\n- [ ] 阅读')
  (notes/'Later.md').write_text('- [ ] 准备晚饭\n- [x] 买菜\n')
  overlay=base/'overlay.json';overlay.write_text(json.dumps([{'insert':[{'id':'corilo-notes','name':str(ROOT/'index.mjs'),'config':{'root':str(notes)}}]},{'id':'workspace-controller','config':{'documentsDirectory':str(base/'agent-workspace')}}]))
  with (base/'host.log').open('w') as log:
   host=subprocess.Popen(['node',str(ROOT/'node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',str(overlay),'--no-open','--port','0'],cwd=base,stdout=log,stderr=log,env=dict(os.environ,HOME=str(base/'home'),DSH_HOME=str(base/'harness'),DSH_AGENTS_HOME=str(base/'agents'),XDG_CONFIG_HOME=str(base/'config')))
   try:
    url=None
    for n in range(400):
     m=re.search(r'dsh web: (http://127\.0\.0\.1:\d+/\?[^\s\x1b]+)',(base/'host.log').read_text())
     if m:url=m[1];break
     assert host.poll() is None,'Harness startup failed'
     time.sleep(.1)
    assert url,'Harness readiness timed out'
    origin=url.split('/?')[0]
    with sync_playwright() as p:
     browser=p.chromium.launch(headless=True,executable_path=shutil.which('chromium') or None)
     context=browser.new_context(viewport={'width':1440,'height':1000});page=context.new_page();errors=[];external=[]
     page.on('pageerror',lambda e:errors.append(str(e)))
     context.on('request',lambda r:external.append(r.url.split('?')[0]) if r.url.startswith('http') and not r.url.startswith(origin+'/') else None)
     page.goto(url);page.get_by_role('button',name='Continue',exact=True).click();page.get_by_role('button',name='Close',exact=True).click();page.get_by_role('button',name='笔记',exact=True).click()
     iframe=page.locator('iframe[title="Corilo Files.md 工作区"]');expect(iframe).to_be_visible()
     frame=iframe.content_frame
     expect(frame.locator('#corilo-status')).to_have_text('已保存到主机',timeout=20000)
     actual=page.frames[-1]
     def wait(check,timeout=15):
      deadline=time.monotonic()+timeout
      while time.monotonic()<deadline:
       if check():return
       page.wait_for_timeout(50)
      raise AssertionError('Workspace evidence timed out')
     async_api={'content-type':'application/json'}
     identity=context.request.post(origin+'/api/corilo-notes/identity',headers=async_api,data={}).json()['value']
     assert identity['interface']=='filesmd'
     headers={'content-type':'application/json','x-corilo-workspace-id':identity['workspaceId']}
     def api(method,**args):
      result=context.request.post(origin+'/api/corilo-notes/workspace/fs',headers=headers,data={'method':method,**args}).json()
      assert result['ok'],result
      return result['value']
     assert context.request.get(origin+'/api/corilo-notes/workspace/index.html').status==200
     assert api('read',path='Hello.md')['etag']
     assert not context.request.post(origin+'/api/corilo-notes/workspace/fs',headers=async_api,data={'method':'list','path':''}).json()['ok']
     assert not context.request.post(origin+'/api/corilo-notes/workspace/fs',headers=headers,data={'method':'read','path':'../secret.md'}).json()['ok']
     # All native entry points remain present, with no second model settings UI.
     for selector in ['#new-file','#new-folder','#open-folder-btn','#random-file','#tree']:
      expect(frame.locator(selector)).to_be_visible()
     assert frame.locator('#corilo-input, #corilo-model, #corilo-send').count()==0
     page.once('dialog',lambda dialog:dialog.accept('原生目录'))
     frame.locator('#new-folder').click();wait(lambda:(notes/'原生目录').is_dir())
     # Real native new-file control and editing surface.
     frame.locator('#new-file').click()
     wait(lambda:actual.evaluate("()=>editor.path==='/New file.md'"))
     frame.locator('.CodeMirror').first.click();page.keyboard.press('Control+End');page.keyboard.insert_text('直接写作，保存为普通 Markdown')
     wait(lambda:(notes/'New file.md').read_text()=='直接写作，保存为普通 Markdown')
     # The filename is the editable first heading, with native rename semantics.
     actual.evaluate("()=>editor.replaceRange('# 新名字',{line:0,ch:0},{line:0,ch:editor.getLine(0).length})")
     wait(lambda:(notes/'新名字.md').exists() and not (notes/'New file.md').exists())
     assert (notes/'新名字.md').read_text()=='直接写作，保存为普通 Markdown'
     # Split-pane version ownership and unchanged underlying Markdown checklists.
     actual.evaluate("async()=>{await openFile('/Later.md',true,'editor2-textarea');}")
     expect(frame.locator('#editor2-container')).to_be_visible()
     frame.locator('#editor2-container .cm-formatting-task').first.click()
     wait(lambda:(notes/'Later.md').read_text().startswith('- [x] 准备晚饭'))
     # Native keyboard search is retained.
     frame.locator('body').press('Control+k')
     expect(frame.locator('#search')).to_be_visible()
     frame.locator('#search-input').fill('Hello')
     expect(frame.locator('#search-results')).to_contain_text('Hello')
     frame.locator('#search-input').press('Escape')
     # Native capture and journal paths execute without a model or Telegram.
     actual.evaluate('async()=>{await openChat();}')
     frame.locator('#chat-input').fill('保留原生收集流程');frame.locator('#send-chat').click()
     wait(lambda:(notes/'Chat.md').exists() and '保留原生收集流程' in (notes/'Chat.md').read_text())
     # A lost capture acknowledgement keeps the input and blocks duplicate sends.
     def lose_capture(route):
      args=route.request.post_data_json
      if args.get('method')=='write' and args.get('path')=='Chat.md':
       assert route.fetch().json()['ok'];route.abort();page.unroute('**/workspace/fs',lose_capture)
      else:route.continue_()
     page.route('**/workspace/fs',lose_capture)
     frame.locator('#chat-input').fill('收集响应丢失，只能记录一次');frame.locator('#send-chat').click()
     expect(frame.locator('#corilo-error')).to_contain_text('结果可能未知')
     assert (notes/'Chat.md').read_text().count('收集响应丢失，只能记录一次')==1
     frame.locator('#send-chat').click()
     assert (notes/'Chat.md').read_text().count('收集响应丢失，只能记录一次')==1
     frame.locator('#corilo-verify').click();expect(frame.locator('#chat-input')).to_have_value('')
     frame.locator('#chat-input').fill('今天的日记 jj');frame.locator('#send-chat').click()
     wait(lambda:any('今天的日记' in f.read_text() for f in (notes/'journal').glob('*.md')))
     # Read failures in native journal helpers must never overwrite existing text.
     journal=next((notes/'journal').glob('*.md'));before_journal=journal.read_text()
     def fail_journal_read(route):
      args=route.request.post_data_json
      if args.get('method')=='read' and 'journal/' in args.get('path',''):
       route.fulfill(json={'ok':False,'error':{'status':503,'message':'测试读取失败'}});page.unroute('**/workspace/fs',fail_journal_read)
      else:route.continue_()
     page.route('**/workspace/fs',fail_journal_read)
     frame.locator('#chat-input').fill('读失败也不能覆盖日记 jj');frame.locator('#send-chat').click()
     expect(frame.locator('#corilo-error')).to_contain_text('测试读取失败')
     assert journal.read_text()==before_journal
     expect(frame.locator('#chat-input')).to_have_value('读失败也不能覆盖日记 jj')
     frame.locator('#send-chat').click();wait(lambda:'读失败也不能覆盖日记' in journal.read_text())
     assert '今天的日记' in journal.read_text()
     # Media bytes are preserved by the same host adapter.
     api('create',path='media',kind='directory');created=api('create',path='media/small.png',kind='file')
     image=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')
     api('write',path='media/small.png',data=base64.b64encode(image).decode(),expected=created['version'])
     assert (notes/'media/small.png').read_bytes()==image
     # Existing decomposed Unicode filenames address the original Linux file.
     actual.evaluate('(filename)=>openFile(filename)','/Cafe\u0301.md')
     actual.evaluate("()=>editor.replaceRange('，继续编辑',{line:editor.lastLine(),ch:editor.getLine(editor.lastLine()).length})")
     wait(lambda:(notes/'Cafe\u0301.md').read_text()=='保留原始文件名，继续编辑')
     assert not (notes/'Café.md').exists()
     # Navigating to Harness Agent preserves the iframe and its editor session.
     actual.evaluate("async()=>{await coriloReload();await openFile('/Hello.md');}")
     actual.evaluate("()=>{window.frameProof='retained';}")
     frame.locator('#corilo-agent').click();expect(iframe).not_to_be_visible()
     page.get_by_role('button',name='笔记',exact=True).click();expect(iframe).to_be_visible()
     assert actual.evaluate('window.frameProof')=='retained'
     # Stale writes preserve both editor text and external disk content.
     actual.evaluate('()=>clearInterval(window.saver)')
     actual.evaluate("()=>editor.replaceRange('待核对输入',{line:editor.lastLine(),ch:0})")
     (notes/'Hello.md').write_text('外部新版本')
     actual.evaluate('async()=>{try{await syncCurrentFile()}catch(e){coriloError(e)}}')
     expect(frame.locator('#corilo-error')).to_contain_text('其他位置修改')
     assert (notes/'Hello.md').read_text()=='外部新版本'
     assert '待核对输入' in actual.evaluate('editor.getValue()')
     frame.locator('#corilo-verify').click();expect(frame.get_by_role('textbox',name='文件最新内容')).to_have_value('外部新版本')
     page.once('dialog',lambda dialog:dialog.accept());frame.locator('#corilo-adopt').click()
     wait(lambda:actual.evaluate('editor.isClean()'))
     # A dropped successful reply never becomes an automatic write retry.
     mutations=[]
     page.on('request',lambda r:mutations.append(r.post_data_json) if r.url.endswith('/workspace/fs') and r.post_data_json.get('method')=='write' else None)
     def lose_reply(route):
      if route.request.post_data_json.get('method')=='write':
       assert route.fetch().json()['ok'];route.abort();page.unroute('**/workspace/fs',lose_reply)
      else:route.continue_()
     page.route('**/workspace/fs',lose_reply)
     actual.evaluate("async()=>{editor.replaceRange('响应丢失',{line:editor.lastLine(),ch:0});try{await syncCurrentFile()}catch(e){coriloError(e)}}")
     expect(frame.locator('#corilo-error')).to_contain_text('结果可能未知')
     count=len(mutations);page.wait_for_timeout(1200);assert len(mutations)==count
     frame.locator('#corilo-verify').click();wait(lambda:actual.evaluate('editor.isClean()'))
     assert len(mutations)==count
     # A lost rename reply is resolved against the new file, without retrying.
     def lose_rename(route):
      if route.request.post_data_json.get('method')=='rename':
       assert route.fetch().json()['ok'];route.abort();page.unroute('**/workspace/fs',lose_rename)
      else:route.continue_()
     page.route('**/workspace/fs',lose_rename)
     actual.evaluate("async()=>{editor.replaceRange('# 已核对的新文件名',{line:0,ch:0},{line:0,ch:editor.getLine(0).length});try{await syncCurrentFile()}catch(e){coriloError(e)}}")
     expect(frame.locator('#corilo-error')).to_contain_text('结果可能未知')
     assert (notes/'已核对的新文件名.md').exists() and not (notes/'Hello.md').exists()
     frame.locator('#corilo-verify').click();wait(lambda:actual.evaluate("editor.path==='/已核对的新文件名.md'&&editor.isClean()"))
     # Saving a conflict copy uses the same authenticated workspace boundary.
     (notes/'已核对的新文件名.md').write_text('原件的外部更新')
     actual.evaluate("async()=>{editor.replaceRange('保留在副本',{line:editor.lastLine(),ch:0});try{await syncCurrentFile()}catch(e){coriloError(e)}}")
     frame.locator('#corilo-copy').click()
     wait(lambda:(notes/'未命名.md').exists() and actual.evaluate("editor.path==='/未命名.md'&&editor.isClean()"))
     assert '保留在副本' in (notes/'未命名.md').read_text()
     assert (notes/'已核对的新文件名.md').read_text()=='原件的外部更新'
     # External media remain textual; the integration never fetches them.
     actual.evaluate("(text)=>editor.replaceRange(text,{line:editor.lastLine(),ch:editor.getLine(editor.lastLine()).length})", "\n![远程图片](https://example.invalid/private.png)")
     actual.evaluate('async()=>{await syncCurrentFile()}')
     page.wait_for_timeout(250)
     shots=pathlib.Path(os.environ.get('CORILO_BROWSER_ARTIFACT_DIR',str(base/'shots')));shots.mkdir(parents=True,exist_ok=True)
     page.screenshot(path=str(shots/'workspace-desktop.png'))
     page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(250)
     frame.get_by_role('button',name='工作区文件',exact=True).click();expect(frame.locator('#sidebar')).to_be_visible()
     frame.locator('#close-sidebar').click();expect(frame.locator('#sidebar')).not_to_be_visible()
     assert actual.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1')
     page.screenshot(path=str(shots/'workspace-mobile.png'))
     assert not (notes/'archive/Log.txt').exists()
     assert errors==[],errors
     assert external==[],external
     browser.close()
    print('Files.md in real Harness passed: native menus/new/edit/rename/split/task Markdown/capture/journal/media, authenticated shared storage, retained Agent navigation, stale/unknown saves, desktop/mobile; no model or external services.')
   finally:host.terminate();host.wait(timeout=20)
if __name__=='__main__':run()
