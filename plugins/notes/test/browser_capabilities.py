"""Browser-only runtime check on a real non-secure origin, with no network I/O."""
import pathlib
import shutil
import subprocess
import tempfile
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]


def main():
    with tempfile.TemporaryDirectory(prefix='corilo-browser-capability-') as temp:
        bundle = pathlib.Path(temp) / 'draft-runtime.js'
        subprocess.run(['node', '--input-type=module', '-e', '''
          import {createRequire} from 'node:module';
          const {build}=createRequire(process.argv[1]+'/package.json')('esbuild');
          await build({absWorkingDir:process.argv[1],entryPoints:['client/drafts.mjs'],outfile:process.argv[2],bundle:true,format:'iife',globalName:'DraftRuntime',platform:'browser'});
        ''', str(ROOT), str(bundle)], check=True)
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, executable_path=shutil.which('chromium') or None)
            page = browser.new_page()
            # Fulfill an offline page locally. Chromium still applies its real
            # insecure-origin API restrictions; this is not a deployment test.
            page.route('http://corilo-capability.invalid/', lambda route: route.fulfill(status=200, content_type='text/html', body='<html><body>Capability check</body></html>'))
            page.goto('http://corilo-capability.invalid/')
            page.add_script_tag(content=bundle.read_text())
            result = page.evaluate('''() => {
              const handle=DraftRuntime.createDraftRecovery(async()=>({id:'capability-fixture'}));
              handle.dispose();
              return {secure:isSecureContext,uuid:typeof crypto.randomUUID,random:typeof crypto.getRandomValues,constructed:true};
            }''')
            assert result == {'secure': False, 'uuid': 'undefined', 'random': 'function', 'constructed': True}, result
            browser.close()
        print('Chromium insecure-origin draft runtime passed without crypto.randomUUID; no network requests.')


if __name__ == '__main__':
    main()
