#!/usr/bin/env python3
"""Legacy bootstrap for keanrain/xuye; not a Corilo rebranding command.

Create the original private repository and push the prepared main branch.

Remote writes happen only when the user runs this script with a locally
 authenticated GitHub CLI. --check is fully local; --resume is explicit.
No token is printed or written to the project. No force-push or deletion.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
OWNER, NAME = 'keanrain', 'xuye'
TARGET = f'{OWNER}/{NAME}'
REMOTE = f'https://github.com/{TARGET}.git'
ENV = dict(os.environ, GH_HOST='github.com', GH_PAGER='cat', GIT_TERMINAL_PROMPT='0')


def command(args: list[str], *, capture: bool = True) -> str:
    result = subprocess.run(args, cwd=ROOT, env=ENV, text=True,
                            stdout=subprocess.PIPE if capture else None,
                            stderr=subprocess.PIPE if capture else None, check=False)
    if result.returncode:
        detail = (result.stderr or result.stdout or '').strip()
        raise RuntimeError(f"Command failed: {' '.join(args)}\n{detail}")
    return (result.stdout or '').strip()


def git(*args: str, capture: bool = True) -> str:
    return command(['git', *args], capture=capture)


def authenticated_git(*args: str, capture: bool = True) -> str:
    # Temporary per-command helper only; do not change global Git settings.
    return git('-c', 'credential.helper=', '-c',
               'credential.helper=!gh auth git-credential', *args, capture=capture)


def local_preflight() -> str:
    if not shutil.which('git'):
        raise RuntimeError('Git is required.')
    if not (ROOT / '.git').is_dir():
        raise RuntimeError('The prepared .git directory is missing. Extract the complete package into a new directory.')
    if Path(git('rev-parse', '--show-toplevel')).resolve() != ROOT:
        raise RuntimeError('This is not the expected repository root.')
    if git('branch', '--show-current') != 'main':
        raise RuntimeError('Expected main; refusing to publish a different branch.')
    if git('status', '--porcelain', '--untracked-files=normal'):
        raise RuntimeError('Working tree has changes or untracked files. Review and commit them explicitly before publishing.')
    remotes = git('remote').splitlines()
    if any(r != 'origin' for r in remotes):
        raise RuntimeError('Unexpected remotes exist. Inspect them before publishing.')
    if 'origin' in remotes:
        if git('remote', 'get-url', '--all', 'origin') != REMOTE:
            raise RuntimeError('origin is not the expected HTTPS destination; refusing to change it.')
        if git('remote', 'get-url', '--push', '--all', 'origin') != REMOTE:
            raise RuntimeError('origin has a different push destination.')
    return git('rev-parse', 'HEAD')


def verify_remote() -> dict:
    info = json.loads(command(['gh', 'api', '--hostname', 'github.com', f'repos/{TARGET}']))
    if info.get('full_name', '').casefold() != TARGET.casefold() or info.get('private') is not True:
        raise RuntimeError('Remote identity or private visibility does not match; nothing will be pushed.')
    if info.get('owner', {}).get('login', '').casefold() != OWNER.casefold():
        raise RuntimeError('Remote owner does not match.')
    return info


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true', help='Local inspection only; no GitHub calls.')
    mode.add_argument('--resume', action='store_true', help='Use a previously created, empty or identical private repository.')
    args = parser.parse_args()
    try:
        head = local_preflight()
        if args.check:
            print(json.dumps({'local_commit': head, 'target': TARGET, 'visibility': 'private',
                              'local_check': 'passed', 'network_calls': 0,
                              'remote_creation': 'not_attempted'}, ensure_ascii=False, indent=2))
            return 0
        if not shutil.which('gh'):
            raise RuntimeError('GitHub CLI (gh) is required. On macOS with Homebrew: brew install gh')
        status = subprocess.run(['gh', 'auth', 'status', '--hostname', 'github.com'],
                                cwd=ROOT, env=ENV, capture_output=True, text=True)
        if status.returncode:
            print('Complete GitHub CLI browser authentication locally. Do not paste a token into ChatGPT.')
            command(['gh', 'auth', 'login', '--hostname', 'github.com',
                     '--git-protocol', 'https', '--web'], capture=False)
        login = command(['gh', 'api', '--hostname', 'github.com', 'user', '--jq', '.login'])
        if login.casefold() != OWNER.casefold():
            raise RuntimeError(f'Authenticated as {login}, expected {OWNER}. Switch the active GitHub CLI account and retry.')

        if not args.resume:
            if git('remote'):
                raise RuntimeError('origin already exists. Inspect it, then use --resume explicitly.')
            print(f'Creating PRIVATE repository {TARGET}; preparing to push main at {head}.', flush=True)
            command(['gh', 'repo', 'create', TARGET, '--private', '--disable-wiki',
                     '--description', 'Corilo 可里 — 本地优先的个人知识与行动助手'], capture=False)

        info = verify_remote()
        if not git('remote'):
            git('remote', 'add', 'origin', REMOTE)
        refs = authenticated_git('ls-remote', 'origin').splitlines()
        for line in refs:
            sha, ref = line.split('\t', 1)
            if sha != head or ref not in {'HEAD', 'refs/heads/main'}:
                raise RuntimeError('Remote already contains different history or refs. Refusing to merge, overwrite, or force-push.')

        authenticated_git('push', '--set-upstream', 'origin', 'main', capture=False)
        remote_main = authenticated_git('ls-remote', '--heads', 'origin', 'main')
        if remote_main != f'{head}\trefs/heads/main':
            raise RuntimeError('Push result could not be verified. Inspect the remote before retrying.')
        info = verify_remote()
        print(json.dumps({'repository': info['html_url'], 'private': info['private'],
                          'branch': 'main', 'verified_commit': head,
                          'status': 'created_or_resumed_and_pushed'}, ensure_ascii=False, indent=2))
        return 0
    except (RuntimeError, OSError, ValueError) as error:
        print(f'\nStopped: {error}', file=sys.stderr)
        print('No force-push, deletion, or public deployment was requested. If creation succeeded before failure, inspect the private repository and use --resume explicitly.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
