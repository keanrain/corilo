"""Chromium against shipped cards with simulated host locale/transport.
Starts and cleans an isolated fixture server, or uses TUTOR_BROWSER_URL.
No model calls or real user data; this is not full DSH Web end-to-end coverage.
"""
import os
import pathlib
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request
from contextlib import contextmanager
from playwright.sync_api import sync_playwright, expect


@contextmanager
def fixture_url():
    if os.environ.get('TUTOR_BROWSER_URL'):
        yield os.environ['TUTOR_BROWSER_URL']
        return
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
                    raise AssertionError('Fixture server exited: ' + log.read())
                try:
                    with urllib.request.urlopen(url, timeout=1):
                        break
                except OSError:
                    time.sleep(.1)
            else:
                log.seek(0)
                raise AssertionError('Fixture server timed out: ' + log.read())
            yield url
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


with fixture_url() as url, sync_playwright() as p:
    options = {'headless': True}
    if shutil.which('chromium'): options['executable_path'] = shutil.which('chromium')
    browser = p.chromium.launch(**options)
    page = browser.new_page(viewport={'width': 1280, 'height': 950})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url)
    quiz = page.locator('.la-quiz')
    expect(quiz.get_by_role('button', name='提交作答', exact=True)).to_be_visible()
    title = quiz.locator('h3').inner_text()
    quiz.locator('textarea').fill('中文答案保持原样')
    quiz.locator('.la-pick, .la-option').first.click()
    quiz.get_by_role('button', name='稳', exact=True).click()
    page.evaluate("setTutorUiLanguage('en')")
    expect(quiz.get_by_role('button', name='Submit answer', exact=True)).to_be_enabled()
    expect(quiz.locator('textarea')).to_have_value('中文答案保持原样')
    expect(quiz.locator('h3')).to_have_text(title)
    expect(quiz.get_by_role('button', name='Confident', exact=True)).to_have_attribute('aria-pressed', 'true')
    quiz.get_by_role('button', name='Submit answer', exact=True).click()
    expect(quiz.locator('.la-done')).to_have_text('Answer submitted')
    messages = page.get_by_label('已发送消息').text_content()
    assert '【作答】' in messages and '中文答案保持原样' in messages
    assert 'Submit answer' not in messages
    page.get_by_role('button', name='翻面闪卡', exact=True).click()
    card = page.locator('.la-flash')
    card.get_by_role('button', name='I can recall it independently', exact=True).click()
    card.get_by_role('button', name='Reveal answer', exact=True).click()
    answer = card.locator('.la-flash-answer p').inner_text()
    page.evaluate("setTutorUiLanguage('zh')")
    expect(card.get_by_role('button', name='记住了', exact=True)).to_be_visible()
    expect(card.locator('.la-flash-answer p')).to_have_text(answer)
    page.get_by_role('button', name='模拟下次发送失败', exact=True).click()
    card.get_by_role('button', name='记住了', exact=True).click()
    expect(card.locator('.la-flash-status')).to_have_text('尚未确认发送，可以重试')
    page.evaluate("setTutorUiLanguage('en')")
    expect(card.locator('.la-flash-status')).to_have_text('Sending is not confirmed. You can retry.')
    card.get_by_role('button', name='Retry: Remembered', exact=True).click()
    messages = page.get_by_label('已发送消息').text_content()
    assert '【闪卡自评】' in messages and '核对后：记住了' in messages
    page.get_by_role('button', name='最小改动', exact=True).click()
    play = page.locator('[data-play="minimal-change"]')
    expect(play.get_by_label('Change preview', exact=True)).to_be_visible()
    play.locator('.la-play-cond').first.click()
    expect(play.locator('.la-play-cond-flag')).to_have_text('Change this')
    expect(play.locator('.la-play-cond-new')).to_have_text('→ Not filled in')
    page.evaluate("setTutorUiLanguage('zh')")
    expect(play.get_by_label('修改预览', exact=True)).to_be_visible()
    expect(play.locator('.la-play-cond-flag')).to_have_text('改这条')
    assert not errors, errors
    browser.close()
    print('Tutor zh/en cards passed: live switches, draft/reveal preservation, failed-send retry, unchanged Chinese protocols; no page errors.')
