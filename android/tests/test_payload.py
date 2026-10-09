"""Packaging rejection tests; fixtures are not functioning Android binaries."""
import hashlib
import importlib.util
import pathlib
import tempfile
import unittest
import zipfile

SCRIPT=pathlib.Path(__file__).resolve().parents[1]/'scripts/prepare-payload.py'
spec=importlib.util.spec_from_file_location('payload',SCRIPT); payload=importlib.util.module_from_spec(spec);spec.loader.exec_module(payload)

class PayloadTests(unittest.TestCase):
    def test_wrong_checksum_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            file=pathlib.Path(temp)/'runtime.zip';file.write_bytes(b'not a runtime')
            with self.assertRaisesRegex(ValueError,'SHA-256'):payload.validate_bootstrap(file,'0'*64)
    def test_stock_prefix_is_rejected_before_packaging(self):
        with tempfile.TemporaryDirectory() as temp:
            file=pathlib.Path(temp)/'runtime.zip'
            with zipfile.ZipFile(file,'w') as archive:archive.writestr('bin/bash',b'\x7fELF/data/data/com.termux/files/usr')
            with self.assertRaisesRegex(ValueError,'Stock Termux'):payload.validate_bootstrap(file,payload.sha256(file))
    def test_archive_path_traversal_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            file=pathlib.Path(temp)/'runtime.zip'
            with zipfile.ZipFile(file,'w') as archive:archive.writestr('../knowledge/note.md','no overwrite')
            with self.assertRaisesRegex(ValueError,'Unsafe'):payload.validate_bootstrap(file,payload.sha256(file))
    def test_app_links_and_files_survive_packaging(self):
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp);stage=root/'app';stage.mkdir();(stage/'file').write_text('note')
            (stage/'link').symlink_to('file');output=root/'app.zip';payload.make_application_zip(stage,output)
            with zipfile.ZipFile(output) as archive:
                self.assertEqual(archive.read('file'),b'note');self.assertEqual(archive.read('SYMLINKS.txt'),'file←link'.encode())
            (stage/'escape').symlink_to(root/'outside')
            with self.assertRaisesRegex(ValueError,'escapes'):payload.make_application_zip(stage,output)
if __name__=='__main__':unittest.main()
