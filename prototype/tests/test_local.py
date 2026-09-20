"""Actual temporary Markdown files and an actual loopback HTTP server.

These tests do not assert that browser, WebView, mobile or AI behavior passed.
"""
import json
import re
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from prototype.store import MAX_BYTES, Problem, Vault, digest
from prototype.server import make_server


def uid():
    return str(uuid.uuid4())


class VaultTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='xuye-store-test-')
        self.root = Path(self.tmp.name) / 'isolated'
        self.vault = Vault(self.root, initialize=True)

    def tearDown(self):
        self.vault.close()
        self.tmp.cleanup()

    def new(self, path='Notes/测试.md', text='原文', op=None):
        return self.vault.commit(operation_id=op or uid(), path=path, content=text, expected_sha256=None)

    def assert_problem(self, code, action):
        with self.assertRaises(Problem) as result:
            action()
        self.assertEqual(code, result.exception.code)

    def reopen(self):
        self.vault.close()
        self.vault = Vault(self.root)

    def test_capture_keeps_exact_input_and_does_not_create_task(self):
        text = '为什么暂时不用方案 A？\n明天再想一想。\n- [ ] 文档里的示例'
        receipt = self.vault.capture(uid(), text)
        self.assertEqual(text.encode(), (self.root / receipt['path']).read_bytes())
        self.assertNotIn('personalos-task:', self.vault.read(receipt['path'])['content'])
        self.assertEqual('off', receipt['sync'])

    def test_capture_retry_creates_only_one_markdown(self):
        op = uid()
        first = self.vault.capture(op, '原话')
        second = self.vault.capture(op, '原话')
        self.assertEqual(first, second)
        self.assertEqual(1, len(list(self.root.rglob('*.md'))))

    def test_different_content_cannot_reuse_operation_id(self):
        op = uid()
        self.vault.capture(op, 'A')
        self.assert_problem('IDEMPOTENCY_MISMATCH', lambda: self.vault.capture(op, 'B'))

    def test_existing_name_is_not_overwritten(self):
        self.new()
        self.assert_problem('VERSION_CONFLICT', lambda: self.new(text='覆盖'))
        self.assertEqual('原文', self.vault.read('Notes/测试.md')['content'])

    def test_save_with_expected_version_and_restart(self):
        first = self.new()
        updated = self.vault.commit(operation_id=uid(), path=first['path'], content='新版本\n正文', expected_sha256=first['sha256'])
        self.reopen()
        self.assertEqual('新版本\n正文', self.vault.read(first['path'])['content'])
        self.assertEqual(updated, self.vault.lookup(updated['operation_id']))

    def test_old_editor_does_not_overwrite_external_change(self):
        first = self.new()
        (self.root / first['path']).write_text('外部新版本', encoding='utf-8')
        self.assert_problem('VERSION_CONFLICT', lambda: self.vault.commit(operation_id=uid(), path=first['path'], content='旧编辑器内容', expected_sha256=first['sha256']))
        self.assertEqual('外部新版本', self.vault.read(first['path'])['content'])

    def test_bom_crlf_and_unknown_fields_are_preserved(self):
        text = '\ufeff---\r\ncustom: 保留  # 注释\r\n---\r\n# 标题\r\n\r\n🙂 café\r\n'
        result = self.new(text=text)
        self.assertEqual(text.encode(), (self.root / result['path']).read_bytes())
        self.reopen()
        self.assertEqual(text, self.vault.read(result['path'])['content'])

    def test_source_heading_does_not_rename_file(self):
        self.new('固定名.md', '# 不同标题\n内容')
        self.assertTrue((self.root / '固定名.md').exists())
        self.assertFalse((self.root / '不同标题.md').exists())

    def test_paths_cannot_escape_or_enter_private_state(self):
        for path in ['../outside.md', '/absolute.md', '.xuye-local/private.md', 'dir/../x.md', 'CON.md', 'a\\b.md', 'x.txt']:
            with self.subTest(path=path):
                self.assert_problem('INVALID_PATH', lambda: self.new(path))

    def test_case_only_duplicate_rejected(self):
        self.new('A.md')
        self.assert_problem('PATH_COLLISION', lambda: self.new('a.md'))

    def test_symlink_is_not_read_or_written(self):
        outside = Path(self.tmp.name) / 'outside.md'
        outside.write_text('外部', encoding='utf-8')
        (self.root / 'link.md').symlink_to(outside)
        self.assert_problem('UNSAFE_PATH', lambda: self.vault.read('link.md'))
        self.assertEqual('外部', outside.read_text())

    def test_nonempty_existing_vault_is_refused(self):
        other = Path(self.tmp.name) / 'personal'
        other.mkdir(); (other / 'private.md').write_text('not test data')
        self.assert_problem('NOT_ISOLATED', lambda: Vault(other, initialize=True))
        self.assertEqual(['private.md'], [p.name for p in other.iterdir()])

    def test_second_process_coordinator_is_refused(self):
        self.assert_problem('VAULT_IN_USE', lambda: Vault(self.root))

    def test_searches_filename_and_chinese_body_without_model(self):
        self.new('方案.md', '使用方案 B，内存占用需要验证')
        self.new('其他.md', '不同')
        self.assertEqual(1, len(self.vault.list_notes('内存')['notes']))
        self.assertEqual('方案.md', self.vault.list_notes('方案')['notes'][0]['path'])

    def test_unreadable_utf8_is_reported_not_deleted(self):
        (self.root / 'bad.md').write_bytes(b'\xff\xfe')
        result = self.vault.list_notes()
        self.assertEqual('INVALID_UTF8', result['unavailable'][0]['code'])
        self.assertEqual(b'\xff\xfe', (self.root / 'bad.md').read_bytes())

    def test_size_limit_is_not_truncation(self):
        self.assert_problem('FILE_TOO_LARGE', lambda: self.new(text='x' * (MAX_BYTES + 1)))
        self.assertFalse((self.root / 'Notes/测试.md').exists())

    def test_prepared_without_decision_is_not_success_and_can_retry(self):
        op = uid()
        def fail(stage):
            if stage == 'prepared': raise RuntimeError('simulated termination')
        self.vault.fault = fail
        with self.assertRaises(RuntimeError): self.new('a.md', 'A', op)
        self.reopen()
        self.assertEqual('aborted', self.vault.lookup(op)['state'])
        self.assertFalse((self.root / 'a.md').exists())
        self.new('a.md', 'A', op)
        self.assertEqual('A', (self.root / 'a.md').read_text())

    def test_durable_decision_recovers_before_file_write(self):
        op = uid()
        def fail(stage):
            if stage == 'applying': raise RuntimeError('simulated termination')
        self.vault.fault = fail
        with self.assertRaises(RuntimeError): self.new('a.md', 'A', op)
        self.reopen()
        self.assertEqual('committed', self.vault.lookup(op)['state'])
        self.assertEqual('A', (self.root / 'a.md').read_text())

    def test_recovery_after_file_write_does_not_duplicate_capture(self):
        op = uid()
        def fail(stage):
            if stage == 'written': raise RuntimeError('simulated termination')
        self.vault.fault = fail
        with self.assertRaises(RuntimeError): self.vault.capture(op, '恢复这句话')
        self.reopen()
        result = self.vault.capture(op, '恢复这句话')
        self.assertEqual('committed', result['state'])
        self.assertEqual(1, len(list(self.root.rglob('*.md'))))

    def test_lost_receipt_returns_same_committed_operation(self):
        op = uid()
        def fail(stage):
            if stage == 'committed': raise RuntimeError('lost response')
        self.vault.fault = fail
        with self.assertRaises(RuntimeError): self.new('a.md', 'A', op)
        self.reopen()
        result = self.new('a.md', 'A', op)
        self.assertEqual('saved', result['local'])

    def test_recovery_does_not_overwrite_unexpected_external_bytes(self):
        first = self.new('a.md', 'A')
        op = uid()
        def fail(stage):
            if stage == 'applying': raise RuntimeError('termination')
        self.vault.fault = fail
        with self.assertRaises(RuntimeError):
            self.vault.commit(operation_id=op,path='a.md',content='B',expected_sha256=first['sha256'])
        (self.root / 'a.md').write_text('External C')
        self.reopen()
        self.assertEqual('conflict', self.vault.lookup(op)['state'])
        self.assertEqual('External C', (self.root / 'a.md').read_text())
        self.assert_problem('RECOVERY_REQUIRED', lambda: self.vault.read('a.md'))
        self.new('unrelated.md', 'unrelated works')


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='xuye-http-test-')
        self.vault = Vault(Path(self.tmp.name)/'vault',initialize=True)
        self.server = make_server(self.vault,0)
        self.thread = threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.server.server_address[1]}'
        with urllib.request.urlopen(self.url) as response:
            self.html = response.read().decode()
        self.token = re.search(r'name="xuye-session" content="([^"]+)"', self.html).group(1)

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join()
        self.vault.close();self.tmp.cleanup()

    def request(self, path, body=None, headers=None, token=True):
        h = {'X-Xuye-Session': self.token} if token else {}
        if body is not None: h['Content-Type']='application/json'
        h.update(headers or {})
        req = urllib.request.Request(self.url+path, data=None if body is None else json.dumps(body).encode(), headers=h)
        try: response=urllib.request.urlopen(req,timeout=3)
        except urllib.error.HTTPError as error: response=error
        with response:
            raw=response.read()
            return response.status,raw,response.headers

    def test_serves_actual_ui_without_remote_runtime_resources(self):
        self.assertIn('chat-input',self.html)
        self.assertNotIn('https://',self.html)
        for path in ['/app.js','/app.css']:
            status,raw,headers=self.request(path,token=False)
            self.assertEqual(200,status)
            self.assertGreater(len(raw),1000)
            self.assertIn("connect-src 'self'",headers['Content-Security-Policy'])

    def test_http_capture_read_edit_and_file_bytes(self):
        op=uid();status,body,_=self.request('/api/captures',{'operation_id':op,'text':'HTTP 实际保存'})
        self.assertEqual(200,status)
        receipt=json.loads(body)
        path=receipt['path']
        from urllib.parse import quote
        status,raw,_=self.request('/api/note?path='+quote(path))
        note=json.loads(raw)
        self.assertEqual('HTTP 实际保存',note['content'])
        status,raw,_=self.request('/api/commit',{'operation_id':uid(),'path':path,'content':'HTTP 修改后','expected_sha256':note['sha256']})
        self.assertEqual(200,status)
        self.assertEqual('HTTP 修改后',(self.vault.root/path).read_text())

    def test_api_without_session_is_rejected(self):
        self.assertEqual(403,self.request('/api/notes',token=False)[0])

    def test_foreign_origin_cannot_write(self):
        status,_,_=self.request('/api/captures',{'operation_id':uid(),'text':'NO'},headers={'Origin':'https://attacker.invalid'})
        self.assertEqual(403,status)
        self.assertEqual([],self.vault.list_notes()['notes'])

    def test_dns_rebinding_host_is_rejected(self):
        self.assertEqual(403,self.request('/api/notes',headers={'Host':'attacker.invalid'})[0])

    def test_state_directory_not_served(self):
        self.assertEqual(404,self.request('/.xuye-local/operations.sqlite',token=False)[0])

    def test_expected_version_required(self):
        status,_,_=self.request('/api/commit',{'operation_id':uid(),'path':'a.md','content':'A'})
        self.assertEqual(400,status)
        self.assertFalse((self.vault.root/'a.md').exists())


if __name__=='__main__':
    unittest.main(verbosity=2)
