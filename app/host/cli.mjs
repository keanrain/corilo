#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { startHost } from './server.mjs';
const { values } = parseArgs({ options: { vault: { type: 'string' }, config: { type: 'string' }, port: { type: 'string' }, 'no-open': { type: 'boolean' } } });
const dataRoot = process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'Corilo')
  : process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support/Corilo')
  : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'corilo');
try {
  const host = await startHost({ vault: path.resolve(values.vault || path.join(dataRoot, 'knowledge')),
    configDir: path.resolve(values.config || path.join(dataRoot, 'config')), port: Number(values.port || 0) });
  console.log('Corilo 本机宿主已启动。此链接包含本次启动的本机访问凭证，请勿分享：');
  console.log(host.url);
  if (!values['no-open']) {
    let command, args;
    if (process.platform === 'darwin') { command = '/usr/bin/open'; args = ['-a', 'Google Chrome', host.url]; }
    else if (process.platform === 'win32') { command = path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'); args = [host.url]; }
    else { command = 'google-chrome'; args = [host.url]; }
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => console.error('未能自动打开 Chrome，请将上方本机链接粘贴到 Chrome。'));
    child.unref();
  }
  let closing = false;
  const close = async () => { if (closing) return; closing = true; await host.close(); process.exit(0); };
  process.on('SIGINT', close); process.on('SIGTERM', close);
} catch (e) { console.error(`Corilo 启动失败：${e.message}`); process.exitCode = 1; }
