"""Actual subprocess exits and a restarted CLI HTTP host, using test data only."""
import json
import re
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
import uuid
from pathlib import Path

from prototype.store import Vault

ROOT = Path(__file__).resolve().parents[2]


class ProcessTests(unittest.TestCase):
    def test_actual_process_exit_recovers_durable_decision(self):
        for stage in ('applying', 'written', 'committed'):
            with self.subTest(stage=stage), tempfile.TemporaryDirectory(prefix='xuye-process-') as d:
                op = str(uuid.uuid4())
                code = '''import os,sys
from pathlib import Path
from prototype.store import Vault
v=Vault(Path(sys.argv[1]),initialize=True,fault=lambda stage: os._exit(77) if stage==sys.argv[2] else None)
v.capture(sys.argv[3],"子进程结束后仍然保留的原话")
'''
                child = subprocess.run([sys.executable, '-c', code, str(Path(d)/'vault'), stage, op], cwd=ROOT, timeout=10)
                self.assertEqual(77, child.returncode)
                vault = Vault(Path(d)/'vault')
                try:
                    result=vault.lookup(op)
                    self.assertEqual('committed', result['state'])
                    self.assertEqual('子进程结束后仍然保留的原话',vault.read(result['path'])['content'])
                    self.assertEqual(1,len(vault.list_notes()['notes']))
                finally:
                    vault.close()

    def test_cli_server_restarts_and_reads_existing_markdown(self):
        with tempfile.TemporaryDirectory(prefix='xuye-cli-') as d:
            root=Path(d)/'vault'
            def start():
                process=subprocess.Popen([sys.executable,'-u','scripts/run_local.py','--vault',str(root),'--init','--port','0'],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
                first=process.stdout.readline()
                match=re.search(r'http://127\.0\.0\.1:\d+',first)
                if not match:
                    process.kill(); self.fail(first+process.stderr.read())
                url=match.group(0)
                with urllib.request.urlopen(url,timeout=3) as r: html=r.read().decode()
                token=re.search(r'name="xuye-session" content="([^"]+)"',html).group(1)
                return process,url,token
            process,url,token=start()
            try:
                op=str(uuid.uuid4());body=json.dumps({'operation_id':op,'text':'CLI 重开测试'}).encode()
                request=urllib.request.Request(url+'/api/captures',data=body,headers={'Content-Type':'application/json','X-Xuye-Session':token})
                with urllib.request.urlopen(request,timeout=3) as r: receipt=json.load(r)
            finally:
                process.kill();process.wait(timeout=3)
                process.stdout.close();process.stderr.close()
            process,url,token=start()
            try:
                request=urllib.request.Request(url+'/api/notes',headers={'X-Xuye-Session':token})
                with urllib.request.urlopen(request,timeout=3) as r: result=json.load(r)
                self.assertEqual('CLI 重开测试',result['notes'][0]['excerpt'])
                self.assertEqual(receipt['path'],result['notes'][0]['path'])
            finally:
                process.terminate();process.wait(timeout=3)
                process.stdout.close();process.stderr.close()


if __name__=='__main__':
    unittest.main(verbosity=2)
