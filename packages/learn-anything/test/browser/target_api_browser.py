"""Actual pinned DSH Web authentication and notes API; synthetic sessions, no model calls."""
import json, os, pathlib, re, shutil, socket, subprocess, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[2]
candidates = [ROOT/'node_modules/@deepseek-ai/dsh/lib/bin.js', ROOT.parents[1]/'plugins/notes/node_modules/@deepseek-ai/dsh/lib/bin.js']
for cache in [pathlib.Path(os.environ.get('npm_config_cache', pathlib.Path.home()/'.npm'))]:
    candidates.extend(cache.glob('_npx/*/node_modules/@deepseek-ai/dsh/lib/bin.js'))
DSH = os.environ.get('LEARN_ANYTHING_DSH') or next((str(path) for path in candidates if path.is_file()), None)
assert DSH, 'Set LEARN_ANYTHING_DSH to the installed pinned DSH lib/bin.js'
pinned=json.loads((ROOT/'package.json').read_text())['engines']['dsh']
installed=json.loads((pathlib.Path(DSH).resolve().parents[1]/'package.json').read_text())['version']
assert installed==pinned, f'Expected pinned DSH {pinned}, got {installed}; set LEARN_ANYTHING_DSH'
with tempfile.TemporaryDirectory(prefix='tutor-native-api-') as temp:
    base = pathlib.Path(temp)
    kpdir = base / 'workspace' / '.learn' / 'kp'
    kpdir.mkdir(parents=True)
    kp = {'id':'demo','title':'Demo','kind':'knowledge','phase':'build','mastery':'none','models':[{'id':'map','type':'discriminative','concept':'A','phase':'build','mastery':'none','targetMap':{'statement':None,'examples':[]}}]}
    (kpdir/'demo.json').write_text(json.dumps(kp))
    course={'goal':'Demo goal','status':'planning','chapters':[{'id':'chapter-1','title':'Demo chapter','kpIds':['demo']}],'resources':[]}
    (kpdir.parent/'course.json').write_text(json.dumps(course))
    observer = base/'observer.mjs'
    observer.write_text("export const inject=['sessions']; export function apply(ctx){ for(const [id, agentPreset, origin] of [['tutor','learn-tutor'],['examiner','learn-examiner'],['child','learn-tutor','subagent']]) ctx.sessions.create(id,{meta:{cwd:" + json.dumps(str(base/'workspace')) + ",agentPreset,...(origin?{origin}:{})}}); }")
    patch = base/'patch.json'
    patch.write_text(json.dumps([{'insert':[{'id':'tutor-ui','name':str(ROOT/'src/host/ui.js')},{'id':'fixture','name':str(observer)}]}]))
    with (base/'host.log').open('w') as log:
        server = subprocess.Popen(['node',DSH,'web','--patch',str(patch),'--no-open','--port','0'],cwd=base,stdout=log,stderr=log,env=dict(os.environ,DSH_HOME=str(base/'harness'),DSH_AGENTS_HOME=str(base/'agents'),XDG_CONFIG_HOME=str(base/'config'),XDG_DATA_HOME=str(base/'data'),XDG_CACHE_HOME=str(base/'cache')))
        try:
            url = None
            for _ in range(400):
                found = re.search(r'dsh web: (http://127\.0\.0\.1:\d+/\?[^\s\x1b]+)',(base/'host.log').read_text())
                if found: url=found[1]; break
                assert server.poll() is None, (base/'host.log').read_text()
                time.sleep(.1)
            assert url, 'Native host did not become ready'
            origin=url.split('/?')[0]
            with sync_playwright() as p:
                browser=p.chromium.launch(headless=True,executable_path=shutil.which('chromium') or None)
                context=browser.new_context()
                endpoint=origin+'/api/learn-anything/target/'
                assert context.request.post(endpoint+'read',data={'sessionId':'tutor','kpId':'demo'}).status == 401
                page=context.new_page(); page.goto(url)
                page.wait_for_timeout(600)
                def api(action,args):
                    return context.request.post(endpoint+action,headers={'content-type':'application/json'},data=args)
                current=api('read',{'sessionId':'tutor','kpId':'demo'})
                assert current.status==200, (current.status,current.text())
                current=current.json()['value']
                args={'sessionId':'tutor','kpId':'demo','expected':current['revision'],'models':[{'id':'map','statement':'我的原话：满足 X 就是 Y。','annotation':'native API note','examples':[{'input':'X','output':'Y'}]}]}
                saved=api('save',args)
                assert saved.status==200, saved.text()
                assert json.loads((kpdir/'demo.json').read_text())['models'][0]['targetMap']['annotation']=='native API note'
                assert api('save',args).status==409
                assert api('read',{'sessionId':'examiner','kpId':'demo'}).status==403
                assert api('save',{**args,'sessionId':'child'}).status==403
                hostile=context.request.post(endpoint+'read',headers={'content-type':'application/json','origin':'https://example.invalid'},data={'sessionId':'tutor','kpId':'demo'})
                assert hostile.status==403, hostile.status
                outline=origin+'/api/learn-anything/outline/'
                def route(action, args):
                    return context.request.post(outline+action,headers={'content-type':'application/json'},data=args)
                current=route('read',{'sessionId':'tutor'}).json()['value']
                chapters=current['view']['chapters']
                chapters[0]['kps'][0]['title']='Edited through native API'
                locked=route('save',{'sessionId':'tutor','expected':current['revision'],'chapters':chapters,'status':'active'})
                assert locked.status==200, locked.text()
                assert json.loads((kpdir.parent/'course.json').read_text())['status']=='active'
                assert json.loads((kpdir/'demo.json').read_text())['title']=='Edited through native API'
                assert route('save',{'sessionId':'examiner'}).status==403
                browser.close()
            print('Pinned DSH Web API passed: unauthenticated 401, host-auth target read/save and outline lock disk persistence, stale409, examiner/child403, hostile Origin403; no model calls')
        finally:
            server.terminate()
            try: server.wait(timeout=10)
            except subprocess.TimeoutExpired: server.kill(); server.wait()
