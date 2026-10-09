import path from 'node:path';
import * as fs from 'node:fs/promises';
import { createAgentSession, SessionManager, DefaultResourceLoader, ModelRuntime, SettingsManager, getAgentDir } from '@earendil-works/pi-coding-agent';
import { fault } from './vault.mjs';
const instructions = `你是 Corilo 可里的个人知识库助手。当前工作目录就是用户的 Markdown 知识库。
使用默认工具阅读和操作真实文件，按用户意图自行选择目录与处理步骤；普通讨论不自动写笔记。
保持原有内容和结构，明确请求直接执行，仅在关键歧义时询问。准确报告已完成和未完成的操作。
不要修改 .git、不要执行 Git 提交/同步/切换分支，历史由宿主管理。不要启动脱离当前执行的后台进程。
新文件使用跨 Windows/macOS/Android 可用的名称。cwd 不是沙箱。`;
export class PiAgent {
  constructor(vault, configDir, piAgentDir = getAgentDir()) { this.vault = vault; this.configDir = configDir; this.piAgentDir = piAgentDir; this.session = null; this.activity = ''; this.liveText = ''; }
  async init() {
    await fs.mkdir(this.configDir, { recursive: true, mode: 0o700 });
    this.runtime = await ModelRuntime.create({ authPath: path.join(this.piAgentDir, 'auth.json'), modelsPath: path.join(this.piAgentDir, 'models.json') });
    const settings = SettingsManager.create(this.vault.root, this.piAgentDir);
    const loader = new DefaultResourceLoader({ cwd: this.vault.root, agentDir: this.piAgentDir, settingsManager: settings,
      appendSystemPromptOverride: base => [...base, instructions] });
    await loader.reload();
    const sessionDir = path.join(this.configDir, 'sessions');
    const { session } = await createAgentSession({ settingsManager: settings, cwd: this.vault.root, agentDir: this.piAgentDir,
      modelRuntime: this.runtime, resourceLoader: loader,
      sessionManager: SessionManager.continueRecent(this.vault.root, sessionDir) });
    this.session = session;
    session.subscribe(event => {
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') this.liveText += event.assistantMessageEvent.delta;
      if (event.type === 'message_end') this.liveText = '';
      if (event.type === 'tool_execution_start') this.activity = `正在执行 ${event.toolName}`;
      if (event.type === 'agent_settled') this.activity = '';
    });
  }
  async ensureReady() {
    const model = this.session.model;
    if (!model) throw fault(400, '请先使用 Pi 配置模型，再重新启动 Corilo');
    if (!await this.runtime.checkAuth(model.provider)) throw fault(400, 'Pi 当前模型尚未配置认证；请使用 Pi 配置后重启，笔记仍可离线使用');
  }
  async prompt(text) {
    await this.ensureReady();
    await this.session.prompt(text);
    const last = this.session.state.messages.at(-1);
    if (last?.role === 'assistant' && last.stopReason === 'error') throw new Error(last.errorMessage || '模型请求失败');
  }
  async stop() { await this.session.abort(); }
  messages() {
    return this.session.state.messages.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({
      role: m.role, text: typeof m.content === 'string' ? m.content : (m.content ?? []).filter(c => c.type === 'text').map(c => c.text).join(''),
      error: m.role === 'assistant' ? m.errorMessage : undefined,
    }));
  }
  async close() { if (this.session) { await this.session.abort(); this.session.dispose(); } }
}
