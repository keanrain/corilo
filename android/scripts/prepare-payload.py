#!/usr/bin/env python3
"""Prepare actual runtime/application assets; rejects stock com.termux binaries."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import struct
import subprocess
import tempfile
import zipfile

ROOT=Path(__file__).resolve().parents[2]
SOURCE=json.loads((ROOT/'android/runtime-source.json').read_text())
PREFIX=SOURCE['prefix']

def sha256(file):
    with open(file,'rb') as stream: return hashlib.file_digest(stream,'sha256').hexdigest()

def validate_bootstrap(file, expected):
    if sha256(file)!=expected: raise ValueError('Bootstrap SHA-256 mismatch')
    with zipfile.ZipFile(file) as archive:
        names=set()
        for entry in archive.infolist():
            name=entry.filename; parts=PurePosixPath(name).parts
            if name.startswith('/') or '..' in parts or '\\' in name or name in names: raise ValueError('Unsafe/duplicate runtime path: '+name)
            names.add(name)
            if (entry.external_attr>>16)&0o170000==0o120000: raise ValueError('Use SYMLINKS.txt for runtime links')
            if entry.is_dir(): continue
            # Inspect ELF and scripts, not docs that may describe upstream paths.
            if entry.file_size>256*1024*1024: raise ValueError('Unexpectedly large runtime entry')
            data=archive.read(entry)
            if data.startswith(b'\x7fELF') and b'/data/data/com.termux/' in data: raise ValueError('Stock Termux ELF cannot run under Corilo: '+name)
        for name in ['bin/node','bin/git','bin/bash']:
            data=archive.read(name)
            if data[:4]!=b'\x7fELF' or struct.unpack_from('<H',data,18)[0]!=183: raise ValueError('Not an Android ARM64 executable: '+name)
        if PREFIX.encode() not in archive.read('bin/bash'): raise ValueError('Bash was not built for the Corilo prefix')
        for name in ['bin/rg','bin/fd','etc/tls/cert.pem']:
            if name not in names: raise ValueError('Missing required runtime file: '+name)
        for line in archive.read('SYMLINKS.txt').decode().splitlines():
            target,link=line.split('←')
            if target.startswith('/') and not target.startswith(PREFIX+'/'): raise ValueError('Runtime link outside Corilo prefix')
            if '..' in PurePosixPath(link).parts or link.startswith('/'): raise ValueError('Unsafe runtime link')

def make_application_zip(directory, output):
    links=[]
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        for file in sorted(directory.rglob('*')):
            name=file.relative_to(directory).as_posix()
            if file.is_symlink():
                if not file.resolve().is_relative_to(directory.resolve()): raise ValueError('App link escapes payload')
                links.append(os.readlink(file)+'←'+name)
            elif file.is_file(): archive.write(file,name)
        if links: archive.writestr('SYMLINKS.txt','\n'.join(links))

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--bootstrap',type=Path,required=True);parser.add_argument('--sha256',required=True)
    args=parser.parse_args();validate_bootstrap(args.bootstrap,args.sha256)
    assets=ROOT/'android/app/src/main/assets';assets.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='corilo-android-payload-') as temp:
        stage=Path(temp)/'application';stage.mkdir()
        for name in ['package.json','package-lock.json']:shutil.copy2(ROOT/name,stage/name)
        for name in ['host','web','vendor']:shutil.copytree(ROOT/'app'/name,stage/'app'/name)
        subprocess.run(['npm','ci','--os=android','--cpu=arm64','--ignore-scripts','--omit=dev','--no-audit','--no-fund','--cache',str(ROOT/'.local/android-npm-cache')],cwd=stage,check=True)
        # Keep all dependency licenses and package metadata; do not prune native packages blindly.
        make_application_zip(stage,Path(temp)/'app.zip')
        shutil.copy2(args.bootstrap,assets/'runtime.zip')
        shutil.copy2(Path(temp)/'app.zip',assets/'app.zip')
    manifest={**SOURCE,'runtime':{'sha256':sha256(assets/'runtime.zip')},'app':{'sha256':sha256(assets/'app.zip')}}
    (assets/'payload.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('Verified Corilo Android runtime and app assets prepared')
if __name__=='__main__':main()
