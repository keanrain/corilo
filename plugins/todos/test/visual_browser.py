"""Scoped Astryx token adaptation in the real published Harness.

Light/dark come from browser system preference and Harness native theme projection.
Chromium viewport/touch emulation is not physical-phone or WebKit evidence.
No Astryx React 19 components are loaded into the host's React 18 renderer.
"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile

from playwright.sync_api import sync_playwright, expect
from browser import ROOT, wait_for


def main():
    with tempfile.TemporaryDirectory(prefix='corilo-todos-visual-') as temp:
        base = pathlib.Path(temp)
        for name in ['user-home', 'harness', 'agents', 'documents']:
            (base / name).mkdir()
        patch = base / 'visual.patch.json'
        patch.write_text(json.dumps([
            {'insert': [
                {'id': 'corilo-todos', 'name': str(ROOT / 'index.mjs'), 'config': {'root': str(base / 'todos')}},
                {'id': 'corilo-notes', 'name': str(ROOT.parent / 'notes/index.mjs'), 'config': {'root': str(base / 'notes'), 'stateRoot': str(base / 'notes-state')}}
            ]},
            {'id': 'workspace-controller', 'config': {'documentsDirectory': str(base / 'documents')}}
        ]))
        log_path = base / 'host.log'
        with log_path.open('w') as log:
            host = subprocess.Popen(['node', str(ROOT / 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--patch', str(patch), '--no-open', '--port', '0'],
                cwd=base, stdout=log, stderr=log, env=dict(os.environ, HOME=str(base / 'user-home'), DSH_HOME=str(base / 'harness'), DSH_AGENTS_HOME=str(base / 'agents'), XDG_CONFIG_HOME=str(base / 'config')))
            try:
                def address():
                    assert host.poll() is None, 'Harness exited before visual readiness'
                    match = re.search(r'dsh web: (http://127\.0\.0\.1:\d+/\?[^\s\x1b]+)', log_path.read_text())
                    return match[1] if match else None
                url = wait_for(address)
                origin = url.split('/?')[0]
                with sync_playwright() as p:
                    browser = p.chromium.launch(headless=True, executable_path=shutil.which('chromium') or None)
                    errors, external = [], []
                    def open_context(scheme, width, height):
                        ctx = browser.new_context(viewport={'width': width, 'height': height}, has_touch=True, color_scheme=scheme)
                        pg = ctx.new_page()
                        pg.on('pageerror', lambda error: errors.append(str(error)))
                        ctx.on('request', lambda req: external.append(req.url.split('?')[0]) if req.url.startswith('http') and not req.url.startswith(origin + '/') else None)
                        pg.goto(url)
                        pg.get_by_role('button', name='Continue', exact=True).or_(pg.get_by_role('button', name='Close', exact=True)).first.wait_for()
                        if pg.get_by_role('button', name='Continue', exact=True).is_visible():
                            pg.get_by_role('button', name='Continue', exact=True).click()
                        pg.get_by_role('button', name='Close', exact=True).click()
                        if width <= 700:
                            pg.get_by_role('button', name='Open sidebar', exact=True).click()
                        pg.get_by_role('button', name='待办', exact=True).click(timeout=20000)
                        if width <= 700:
                            pg.touchscreen.tap(width - 8, 220)
                        region = pg.get_by_role('region', name='Corilo 待办')
                        expect(region).to_have_attribute('data-ui', 'astryx-neutral')
                        field = region.get_by_role('textbox', name='快速新增待办', exact=True)
                        expect(field).to_be_enabled()
                        region.get_by_role('group', name='待办状态筛选').get_by_role('button', name='全部', exact=True).click()
                        pg.wait_for_function("() => document.getAnimations().every(animation => animation.playState !== 'running')")
                        return ctx, pg, region, field
                    context, page, panel, quick = open_context('light', 1280, 900)
                    for title in ['准备阅读笔记', '整理本周的想法', '给植物浇水']:
                        quick.fill(title)
                        panel.get_by_role('button', name='添加', exact=True).click()
                        expect(quick).to_have_value('')
                    completed = panel.get_by_role('checkbox', name='完成：给植物浇水', exact=True)
                    completed.click()
                    expect(completed).to_have_attribute('aria-checked', 'true')
                    artifacts = os.environ.get('CORILO_BROWSER_ARTIFACT_DIR')
                    destination = pathlib.Path(artifacts) if artifacts else None
                    if destination:
                        destination.mkdir(parents=True, exist_ok=True)

                    contrast = []
                    for scheme in ['light', 'dark']:
                        for width, height, label in [(1280, 900, 'desktop'), (390, 844, 'mobile')]:
                            if scheme != 'light' or width != 1280:
                                context.close()
                                context, page, panel, quick = open_context(scheme, width, height)
                            expect(panel).to_have_css('color-scheme', scheme)
                            assert page.evaluate('document.documentElement.style.colorScheme') == scheme
                            page.evaluate("document.querySelector('.corilo-todos').scrollTop = 0")
                            assert panel.evaluate('(el) => el.scrollWidth <= el.clientWidth + 1')
                            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                            assert panel.locator('.corilo-todos-editor').count() == 0
                            box = quick.bounding_box()
                            assert box and 0 <= box['y'] < 250, 'Quick capture must stay on the first screen'
                            if width == 390:
                                assert quick.evaluate('(el) => parseFloat(getComputedStyle(el).fontSize)') >= 16
                            check = panel.get_by_role('checkbox').first
                            assert check.bounding_box()['height'] >= 44
                            checked = panel.get_by_role('checkbox', checked=True).first
                            unchecked = panel.get_by_role('checkbox', checked=False).first
                            expect(checked).to_be_visible()
                            expect(unchecked).to_be_visible()
                            checked.hover()
                            quick.focus()
                            expect(quick).to_be_focused()
                            page.wait_for_function("() => { const el=document.querySelector('.corilo-todos-quick input'); const r=el.getBoundingClientRect(); return document.elementFromPoint(r.x+5,r.y+r.height/2)===el && document.getAnimations().every(animation => animation.playState !== 'running'); }")
                            measure_colors = '''(el) => {
                                const styles = getComputedStyle(el);
                                const q = el.querySelector('[aria-label="快速新增待办"] input');
                                const check = el.querySelector('[role="checkbox"][aria-checked="true"]');
                                const unchecked = el.querySelector('[role="checkbox"][aria-checked="false"]');
                                const resolve = value => {
                                  const span = document.createElement('span'); span.style.color = value;
                                  el.append(span); const color = getComputedStyle(span).color; span.remove(); return color;
                                };
                                const ratio = (a, b) => {
                                  const lum = value => {
                                    const c = value.match(/[\\d.]+/g).slice(0, 3).map(v => Number(v) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
                                    return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
                                  };
                                  const [high, low] = [lum(a), lum(b)].sort((a, b) => b-a);
                                  return (high+.05)/(low+.05);
                                };
                                const surface = getComputedStyle(el).backgroundColor;
                                const secondary = resolve('var(--ax-color-text-secondary)');
                                const info = resolve('var(--ax-color-text-info)');
                                const state = {};
                                for (const name of ['success', 'error', 'warning']) state[name] = ratio(resolve('var(--ax-color-text-' + name + ')'), surface);
                                return { surface, secondary, focus: info, secondaryRatio: ratio(secondary,surface), focusRatio: ratio(info,surface),
                                  placeholderOpacity: getComputedStyle(q,'::placeholder').opacity,
                                  checkedBorderRatio: ratio(getComputedStyle(check,'::before').borderTopColor,surface),
                                  uncheckedBorderRatio: ratio(getComputedStyle(unchecked,'::before').borderTopColor,getComputedStyle(unchecked,'::before').backgroundColor),
                                  checkMarkRatio: ratio(getComputedStyle(check,'::after').color,getComputedStyle(check,'::before').backgroundColor), state,
                                  outline: getComputedStyle(q).outlineStyle };
                            }'''
                            colors = panel.evaluate(measure_colors)
                            assert colors['secondaryRatio'] >= 4.5, colors
                            assert colors['checkedBorderRatio'] >= 3, colors
                            assert colors['uncheckedBorderRatio'] >= 3, colors
                            assert colors['checkMarkRatio'] >= 4.5, colors
                            assert colors['focusRatio'] >= 3, colors
                            assert colors['placeholderOpacity'] == '1', colors
                            assert colors['outline'] != 'none', colors
                            assert all(value >= 4.5 for value in colors['state'].values()), colors
                            unchecked.hover()
                            page.wait_for_function("() => document.getAnimations().every(animation => animation.playState !== 'running')")
                            hover_colors = panel.evaluate(measure_colors)
                            assert hover_colors['uncheckedBorderRatio'] >= 3, hover_colors
                            assert hover_colors['checkMarkRatio'] >= 4.5, hover_colors
                            contrast.append({'scheme': scheme, 'viewport': label, **colors,
                                             'uncheckedHoverBorderRatio': hover_colors['uncheckedBorderRatio']})
                            if destination:
                                page.screenshot(path=str(destination / f'todos-astryx-{scheme}-{label}.png'), animations='disabled')

                    # Disable only the todos stylesheet and compare native
                    # chrome + the other plugin. A scoped adaptation must not
                    # change their computed typography, colors or controls.
                    context.close()
                    context, page, panel, quick = open_context('dark', 1280, 900)
                    page.get_by_role('button', name='笔记', exact=True).click()
                    expect(page.get_by_role('region', name='Corilo 笔记')).to_be_visible()
                    unchanged = page.evaluate('''() => {
                      const sheet = [...document.querySelectorAll('style')].find(el => el.textContent.includes('.corilo-todos-check::before'));
                      if (!sheet) throw Error('No todo adaptation stylesheet');
                      const capture = () => [document.body, document.querySelector('.corilo-notes'), document.querySelector('.corilo-notes button')].map(el => {
                        const s = getComputedStyle(el);
                        return [s.color,s.backgroundColor,s.fontFamily,s.fontSize,s.borderRadius,s.padding];
                      });
                      const before = capture(), scheme = document.documentElement.style.colorScheme;
                      sheet.sheet.disabled = true; const without = capture(); sheet.sheet.disabled = false;
                      return {same: JSON.stringify(before) === JSON.stringify(without), scheme, afterScheme: document.documentElement.style.colorScheme};
                    }''')
                    assert unchanged['same'] and unchanged['scheme'] == unchanged['afterScheme'], unchanged
                    assert not errors, errors
                    assert not external, external
                    if destination:
                        (destination / 'todos-astryx-contrast.json').write_text(json.dumps(contrast, indent=2))
                    context.close(); browser.close()
                host.terminate()
                assert host.wait(timeout=10) == 0
                print('Harness todos Astryx-token visual passed: desktop/390px light-dark, first-screen quick capture, focus and measured text/status/checkbox contrast, scoped native-host/notes styles, zero model/font/external requests. No Astryx React-component or physical-phone claim.')
            finally:
                if host.poll() is None:
                    host.kill(); host.wait()


if __name__ == '__main__':
    main()
