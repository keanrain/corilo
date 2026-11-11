import json, os, pathlib, re, shutil, subprocess, tempfile, time
from playwright.sync_api import sync_playwright, expect
ROOT=pathlib.Path(__file__).resolve().parents[1]
def wait(check, timeout=15):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        value=check()
        if value:return value
        active_page=globals().get('page')
        if active_page:active_page.wait_for_timeout(50)
        else:time.sleep(.05)
    raise AssertionError('condition timeout')
def value(body):return body.evaluate('(el)=>el.cmTile.root.view.state.doc.toString()')
with tempfile.TemporaryDirectory(prefix='corilo-review-') as temp:
    base=pathlib.Path(temp); notes=base/'notes';notes.mkdir()
    (base/'history').mkdir(); (base/'history/keep').write_bytes(b'legacy data unchanged')
    (notes/'same.md').write_text('target same text')
    (notes/'unrelated.md').write_text('其他笔记')
    config=base/'overlay.json'
    config.write_text(json.dumps([{'insert':[
        {'id':'corilo-notes','name':str(ROOT/'index.mjs'),'config':{'root':str(notes),'stateRoot':str(base/'history')}},
    ]},{'id':'workspace-controller','config':{'documentsDirectory':str(base/'workspace')}}]))
    logfile=base/'host.log'
    with logfile.open('w') as log:
        host=subprocess.Popen(['node',str(ROOT/'node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',str(config),'--no-open','--port','0'],cwd=base,stdout=log,stderr=log,env=dict(os.environ,HOME=str(base/'home'),DSH_HOME=str(base/'runtime'),DSH_AGENTS_HOME=str(base/'agents'),XDG_CONFIG_HOME=str(base/'config')))
        try:
            def address():
                assert host.poll() is None
                match=re.search(r'dsh web: (http://127\.0\.0\.1:\d+/\?[^\s\x1b]+)',logfile.read_text())
                return match[1] if match else None
            url=wait(address)
            with sync_playwright() as p:
                browser=p.chromium.launch(headless=True,executable_path=shutil.which('chromium') or None)
                context=browser.new_context(viewport={'width':1400,'height':1000})
                context.add_init_script("window.notesDbOpens=0;const original=indexedDB.open.bind(indexedDB);indexedDB.open=(name,...args)=>{if(String(name).startsWith('corilo-notes')){window.notesDbOpens++;throw Error('No notes IndexedDB expected');}return original(name,...args);};")
                page=context.new_page()
                external=[];context.on('request',lambda r:external.append(r.url.split('?')[0]) if r.url.startswith('http') and not r.url.startswith(url.split('/?')[0]+'/') else None)
                errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(url)
                page.get_by_role('button',name='Continue',exact=True).click()
                page.get_by_role('button',name='Close',exact=True).click()
                page.get_by_role('button',name='笔记',exact=True).click()
                panel=page.get_by_role('region',name='Corilo 笔记')
                body=panel.get_by_role('textbox',name='笔记正文',exact=True)
                expect(body).to_be_editable()
                origin=url.split('/?')[0]
                for method in ['history','readRevision','restore','trash','listTrash','restoreTrash']:
                    response=context.request.post(origin+'/api/corilo-notes/'+method,data={})
                    assert response.status in [404,405], (method,response.status)
                assert panel.locator('.corilo-notes-drafts, .corilo-notes-recovery, details.corilo-notes-more').count()==0
                assert panel.get_by_role('checkbox',name='自动保存').count()==0
                body.fill('target same text')
                wait(lambda:(notes/'未命名.md').exists() and (notes/'未命名.md').read_text()=='target same text')
                body.press('Control+z');wait(lambda:(notes/'未命名.md').read_text()=='')
                body.press('Control+Shift+Z');wait(lambda:(notes/'未命名.md').read_text()=='target same text')
                panel.get_by_role('button',name='same.md',exact=True).click()
                expect(panel.get_by_role('textbox',name='笔记标题')).to_have_value('same')
                search=panel.get_by_role('textbox',name='搜索笔记')
                search.fill('target');search.press('Enter')
                expect(panel.get_by_role('button',name='same.md',exact=True)).to_be_visible()
                expect(panel.get_by_role('button',name='unrelated.md',exact=True)).to_have_count(0)
                # Typing another query without submitting must not change the
                # active search when saving refreshes the library.
                search.fill('尚未提交的搜索词')
                body.fill('target 保存后仍匹配')
                wait(lambda:(notes/'same.md').read_text()=='target 保存后仍匹配')
                expect(panel.get_by_role('button',name='same.md',exact=True)).to_be_visible()
                expect(panel.get_by_text('“target”的文件名和正文结果',exact=True)).to_be_visible()
                expect(panel.get_by_role('button',name='unrelated.md',exact=True)).to_have_count(0)
                expect(search).to_have_value('尚未提交的搜索词')
                body.press('Control+z');wait(lambda:(notes/'same.md').read_text()=='target same text')
                expect(panel.get_by_text('“target”的文件名和正文结果',exact=True)).to_be_visible()
                panel.get_by_role('button',name='刷新列表',exact=True).click()
                expect(search).to_have_value('')
                expect(panel.get_by_role('button',name='unrelated.md',exact=True)).to_be_visible()
                body.press('Control+z')
                assert value(body)=='target same text' and (notes/'same.md').read_text()=='target same text'
                body.fill('after edit');wait(lambda:(notes/'same.md').read_text()=='after edit')
                panel.get_by_role('button',name='same.md',exact=True).click()
                expect(panel.get_by_role('status')).to_have_text('已保存')
                body.press('Control+z');wait(lambda:(notes/'same.md').read_text()=='target same text')
                body.press('Control+Shift+Z');wait(lambda:(notes/'same.md').read_text()=='after edit')
                panel.get_by_role('textbox',name='笔记标题').click()
                name=panel.get_by_role('textbox',name='新笔记名称');name.fill('renamed');name.press('Enter')
                expect(panel.get_by_role('textbox',name='笔记标题')).to_have_value('renamed')
                expect(body).to_be_editable();body.press('Control+z')
                wait(lambda:(notes/'renamed.md').read_text()=='target same text')
                held=[]
                def hold(route):
                    response=route.fetch();assert response.json()['ok'];held.append((route,response))
                page.route('**/api/corilo-notes/save',hold,times=1)
                body.fill('提交 A')
                wait(lambda:(page.wait_for_timeout(20),bool(held))[1])
                body.fill('提交 A 后继续输入 B');held[0][0].fulfill(response=held[0][1])
                wait(lambda:(notes/'renamed.md').read_text()=='提交 A 后继续输入 B')
                body.dispatch_event('compositionstart');body.fill('中文组字')
                page.wait_for_timeout(1250);assert (notes/'renamed.md').read_text()=='提交 A 后继续输入 B'
                body.dispatch_event('compositionend');wait(lambda:(notes/'renamed.md').read_text()=='中文组字')
                def lost(route):
                    assert route.fetch().json()['ok'];route.abort()
                page.route('**/api/corilo-notes/save',lost,times=1)
                body.fill('未知结果')
                expect(panel.get_by_role('status')).to_have_text('保存失败',timeout=10000)
                assert value(body)=='未知结果'
                page.wait_for_timeout(1250)
                assert page.evaluate("()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;}")
                panel.get_by_role('button',name='查看最新内容').click()
                panel.get_by_role('button',name='采用文件内容').click()
                expect(panel.get_by_role('status')).to_have_text('已保存')
                (notes/'renamed.md').write_text('外部更新')
                body.fill('不能覆盖外部文件')
                expect(panel.get_by_role('status')).to_have_text('版本冲突',timeout=10000)
                panel.get_by_role('button',name='新笔记').click()
                assert value(body)=='不能覆盖外部文件'
                panel.get_by_role('button',name='保存副本').click()
                expect(panel.get_by_role('status')).to_have_text('已保存',timeout=10000)
                assert (notes/'renamed.md').read_text()=='外部更新'
                assert (notes/'未命名 2.md').read_text()=='不能覆盖外部文件'
                body.fill('离开面板也自动保存')
                page.get_by_role('button',name='Plugins',exact=True).click()
                wait(lambda:(notes/'未命名 2.md').read_text()=='离开面板也自动保存')
                page.get_by_role('button',name='笔记',exact=True).click()
                assert value(body)=='离开面板也自动保存'
                sample='# 核心笔记\n\n只管写下想法，文件自动保存。\n\n- 新建\n- 查找\n- 编辑\n\n保留 **重要内容**，使用 `Markdown`。'
                body.fill(sample)
                expect(panel.get_by_role('status')).to_have_text('已保存',timeout=10000)
                shots=pathlib.Path(os.environ.get('CORILO_BROWSER_ARTIFACT_DIR',str(base/'screenshots')))
                shots.mkdir(parents=True,exist_ok=True)
                panel.screenshot(path=str(shots/'desktop.png'))
                panel.get_by_role('button',name='实时预览').click()
                expect(panel.get_by_role('region',name='Markdown 实时预览')).to_contain_text('核心笔记')
                assert panel.locator('.corilo-notes-preview img, .corilo-notes-preview script').count()==0
                attack='<img src="https://untrusted.invalid/a" onerror="window.notesAttack=1"><script>window.notesAttack=1</script>\n[unsafe](javascript:alert(1)) ![remote](https://untrusted.invalid/b)'
                body.fill(attack);wait(lambda:value(body)==attack)
                preview=panel.get_by_role('region',name='Markdown 实时预览')
                expect(preview).to_contain_text('unsafe')
                assert preview.locator('img, script, iframe, a[href^="javascript:"]').count()==0
                assert page.evaluate('window.notesAttack') is None
                body.fill(sample);wait(lambda:value(body)==sample)
                expect(panel.get_by_role('status')).to_have_text('已保存',timeout=10000)
                panel.get_by_role('button',name='编辑',exact=True).click()
                phone_context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
                phone_context.on('request',lambda r:external.append(r.url.split('?')[0]) if r.url.startswith('http') and not r.url.startswith(url.split('/?')[0]+'/') else None)
                phone=phone_context.new_page();phone.on('pageerror',lambda e:errors.append(str(e)))
                phone.goto(url)
                phone.get_by_role('button',name='Continue',exact=True).or_(phone.get_by_role('button',name='Close',exact=True)).first.wait_for()
                if phone.get_by_role('button',name='Continue',exact=True).is_visible():phone.get_by_role('button',name='Continue',exact=True).click()
                phone.get_by_role('button',name='Close',exact=True).click()
                phone.get_by_role('button',name='Open sidebar',exact=True).tap();phone.get_by_role('button',name='笔记',exact=True).tap();phone.touchscreen.tap(382,220)
                mobile=phone.get_by_role('region',name='Corilo 笔记')
                mobile.get_by_role('button',name='查找笔记').tap();mobile.get_by_role('button',name='未命名 2.md',exact=True).tap()
                mobile_body=mobile.get_by_role('textbox',name='笔记正文')
                wait(lambda:value(mobile_body)==sample)
                assert mobile.evaluate('(el)=>el.scrollWidth<=el.clientWidth+1')
                mobile.screenshot(path=str(shots/'mobile.png'));phone_context.close()
                assert page.evaluate('window.notesDbOpens')==0
                assert [x.name for x in (base/'history').iterdir()]==['keep']
                assert (base/'history/keep').read_bytes()==b'legacy data unchanged'
                assert errors==[],errors
                assert external==[],external
                print('Core notes Harness passed: no recovery UI/IndexedDB/history writes; autosave, document undo isolation, rename undo, in-flight input, IME, unknown read verification, conflict copy, offscreen save, desktop/mobile; legacy state unchanged; zero external/model requests.')
                browser.close()
        finally:
            host.terminate();host.wait(timeout=20)
