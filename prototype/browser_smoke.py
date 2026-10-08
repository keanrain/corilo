"""Optional real-browser smoke test. Never disables browser security controls.

Requires Playwright + its installed Chromium, or --executable to an existing one.
Uses an isolated temporary vault and records a blocked navigation as NOT PASSED.
"""
from __future__ import annotations
import argparse
import json
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path

from .server import make_server
from .store import Vault


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--executable')
    ap.add_argument('--output',type=Path,default=Path('.local/browser-result.json'))
    args=ap.parse_args()
    report={'executed_at_utc':datetime.now(timezone.utc).isoformat(),'status':'not_run','checks':[]}
    try:
        from playwright.sync_api import sync_playwright, expect
        with tempfile.TemporaryDirectory(prefix='xuye-browser-') as d:
            vault=Vault(Path(d)/'vault',initialize=True)
            server=make_server(vault,0)
            worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
            try:
                with sync_playwright() as p:
                    options={'headless':True}
                    if args.executable: options['executable_path']=args.executable
                    browser=p.chromium.launch(**options)
                    page=browser.new_page(viewport={'width':1280,'height':900})
                    page.goto(f'http://127.0.0.1:{server.server_address[1]}',wait_until='networkidle',timeout=10000)
                    page.locator('#chat-input').fill('原型浏览器测试：不是待办。')
                    page.locator('#send-chat').click()
                    expect(page.locator('#capture-status')).to_contain_text('原话已保存')
                    assert len(vault.list_notes()['notes'])==1
                    report['checks'].append('capture UI writes actual Markdown')
                    page.get_by_text('打开原文 ↗').click()
                    page.locator('#editor-textarea').fill('改过的本地原文')
                    page.locator('#save-note').click()
                    expect(page.locator('#save-status')).to_contain_text('本地已保存')
                    page.reload(wait_until='networkidle')
                    expect(page.locator('#editor-textarea')).to_have_value('改过的本地原文')
                    report['checks'].append('edit and reload UI read actual saved bytes')
                    report['status']='passed'
                    browser.close()
            finally:
                server.shutdown();server.server_close();worker.join();vault.close()
    except Exception as exc:
        report.update(status='blocked' if 'ERR_BLOCKED_BY_ADMINISTRATOR' in str(exc) else 'failed',error=str(exc))
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return 0 if report['status']=='passed' else 1


if __name__=='__main__':
    raise SystemExit(main())
