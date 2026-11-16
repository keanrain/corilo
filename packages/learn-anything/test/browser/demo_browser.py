"""Actual Chromium component tests with synthetic demos; no DSH/model integration claim."""
import os
import pathlib
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request
from playwright.sync_api import sync_playwright, expect

root = pathlib.Path(__file__).resolve().parents[2]
with socket.socket() as reserved:
    reserved.bind(('127.0.0.1', 0))
    port = reserved.getsockname()[1]
url = f'http://127.0.0.1:{port}/'
with tempfile.TemporaryFile(mode='w+') as log:
    process = subprocess.Popen(['node', 'test/browser/smoke.mjs'], cwd=root,
                               env=dict(os.environ, PORT=str(port)), stdout=log, stderr=log)
    try:
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if process.poll() is not None:
                log.seek(0)
                raise AssertionError('Fixture exited: ' + log.read())
            try:
                with urllib.request.urlopen(url, timeout=1): break
            except OSError: time.sleep(.1)
        else: raise AssertionError('Fixture did not start')
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, executable_path=shutil.which('chromium'))
            page = browser.new_page(viewport={'width': 390, 'height': 844})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(url + 'demo?model=thermostat')
            demo = page.locator('[data-demo="state-machine"]')
            expect(demo.locator('.la-demo-result')).to_have_text('关闭：不加热')
            slider = demo.get_by_role('slider', name='温度')
            slider.focus()
            page.keyboard.press('Home')
            page.keyboard.press('ArrowRight')
            expect(slider).to_have_value('1')
            demo.get_by_role('button', name='推进一步').click()
            expect(demo.locator('.la-demo-result')).to_have_text('开启：加热中')
            expect(demo.locator('[aria-current="step"] strong')).to_have_text('开启')
            page.get_by_role('button', name='只读：关').click()
            expect(slider).to_be_disabled()
            expect(demo.get_by_role('button', name='推进一步')).to_be_disabled()
            expect(demo.get_by_role('button', name='回到题目')).to_be_enabled()
            page.get_by_role('button', name='只读：开').click()
            demo.get_by_role('button', name='重新试一次').click()
            expect(slider).to_have_value('22')
            expect(demo.locator('.la-demo-result')).to_have_text('关闭：不加热')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.goto(url + 'demo?model=gate')
            demo = page.locator('[data-demo="state-machine"]')
            demo.get_by_role('checkbox', name='开关一').check()
            demo.get_by_role('button', name='推进一步').click()
            expect(demo.locator('.la-demo-result')).to_contain_text('没有满足的流转条件')
            demo.get_by_role('checkbox', name='开关二').check()
            demo.get_by_role('button', name='推进一步').click()
            expect(demo.locator('.la-demo-result')).to_have_text('导通：有信号')
            page.evaluate("document.documentElement.lang = 'en'")
            page.get_by_role('button', name='只读：关').click()
            expect(demo.get_by_role('button', name='Step forward')).to_be_disabled()
            expect(demo.locator('.la-demo-result')).to_have_text('导通：有信号')
            demo.get_by_role('button', name='Return to question').click()
            expect(page.locator('main > [role="status"]')).to_contain_text('已记录返回操作')
            assert errors == [], errors
            browser.close()
        print('PASS: Chromium generic demos, keyboard, boundaries, graph/output, reset, readonly, narrow layout, UI language, and return')
    finally:
        process.terminate()
        try: process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
