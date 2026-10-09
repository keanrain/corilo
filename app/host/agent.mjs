import path from 'node:path';
import * as fs from 'node:fs/promises';
import { createAgentSession, SessionManager, DefaultResourceLoader, ModelRuntime, SettingsManager } from '@earendil-works/pi-coding-agent';
import { fault } from './vault.mjs';
const instructions = `你是 Corilo 可里的个人知识库助手。当前工作目录就是用户的 Markdown 知识库。
使用默认工具阅读和操作真实文件，按用户意图自行选择目录与处理步骤；普通讨论不自动写笔记。
保持原有内容和结构，明确请求直接执行，仅在关键歧义时询问。准确报告已完成和未完成的操作。
不要修改 .git、不要执行 Git 提交/同步/切换分支，历史由宿主管理。不要启动脱离当前执行的后台进程。
新文件使用跨 Windows/macOS/Android 可用的名称。cwd 不是沙箱。`;
export class PiAgent {
  constructor(vault, configDir) { this.vault = vault; this.configDir = configDir; this.session = null; this.activity = ''; this.liveText = ''; }
  async init() {
    await fs.mkdir(this.configDir, { recursive: true, mode: 0o700 });
    this.runtime = await ModelRuntime.create({ authPath: path.join(this.configDir, 'auth.json'), modelsPath: path.join(this.configDir, 'models.json') });
    const loader = new DefaultResourceLoader({ cwd: this.vault.root, agentDir: this.configDir,
      appendSystemPromptOverride: base => [...base, instructions] });
    await loader.reload();
    const sessionDir = path.join(this.configDir, 'sessions');
    const settings = SettingsManager.create(this.vault.root, this.configDir);
    const initialModel = settings.getDefaultProvider() ? undefined : this.runtime.getModels('deepseek')[0];
    const { session } = await createAgentSession({ model: initialModel, settingsManager: settings, cwd: this.vault.root, agentDir: this.configDir,
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
  async configure(key) {
    await this.runtime.login('deepseek', 'api_key', { prompt: async () => key, notify: () => {} });
    const model = this.runtime.getModel('deepseek', 'deepseek-chat') ?? this.runtime.getModels('deepseek')[0];
    if (!model) throw fault(400, 'Pi 当前目录中没有 DeepSeek 模型，请检查 Pi 配置');
    await this.session.setModel(model, { persist: true });
  }
  async ensureReady() {
    const model = this.session.model;
    if (!model) throw fault(400, '请先配置 DeepSeek，或在 Pi 配置目录中选择模型');
    if (!await this.runtime.checkAuth(model.provider)) throw fault(400, '请先配置模型 API Key；笔记仍可离线使用');
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
