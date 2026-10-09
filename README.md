# Corilo 可里

本地 Markdown 知识库与 Agent 助手。目标为 Windows/macOS Chrome＋自动启动器、Android 集成 APK，使用 Pi 默认能力、在线模型和 GitHub 私有仓库同步。

## 当前正式应用代码

`app/` 已接入固定版本的完整 Files.md Web 页面和 CodeMirror/HyperMD 编辑器、本机 Node 文件宿主、Pi 1.1.0 默认工具及本地 Git 历史。页面、Pi 和 Git 使用同一个磁盘知识库，浏览器临时存储与原 Files.md 远程同步入口已停用。

目前可用：真实文件编辑、文件树、原话保存、外部修改冲突提示及草稿另存、复用已有 Pi 配置、Agent 对话/停止、观察到的文件变更入口、最近本机会话恢复。对话流通过本机状态轮询增量显示。模型配置沿用 Pi 的 `auth.json`、`models.json` 和 `settings.json`。

**这是正式应用的首条开发链路，尚不是可分发安装包。** GitHub 远程同步、独立桌面启动器安装包、Android APK、完整会话切换和历史恢复界面仍待实现。Windows/macOS 启动代码尚未在目标系统验收。不要把当前阶段当作已经通过全部首期验收。

## 开发启动

需要 Node.js >=22.19.0、Git；Pi 的默认 shell 工具需要 Bash（Windows 开发机需要 Git Bash）。首次安装依赖：

```bash
npm ci --ignore-scripts
npm start
```

启动时自动尝试打开 Chrome。当前开发入口仍依赖本机已安装的 Node/Git/Chrome；后续安装包会管理运行组件。Linux 云环境或无 GUI 时使用：

```bash
npm start -- --no-open --vault .local/app-notes --config .local/app-config
```

终端会打印带**本机访问凭证**的启动链接，仅供本机使用，不要分享。服务只监听 `127.0.0.1`，随机端口，页面去除 URL 中凭证后保存在当前标签页的 sessionStorage。Ctrl+C 正常退出。

默认目录位于 Windows `%LOCALAPPDATA%/Corilo`、macOS `~/Library/Application Support/Corilo`、Linux `$XDG_DATA_HOME/corilo`（未设置时 `~/.local/share/corilo`）。`knowledge/` 存笔记，`config/sessions/` 保存由 Pi 管理的 Corilo 会话。模型认证和设置直接读取 Pi 标准目录，不在 Corilo 下复制一份。开发检查使用虚构资料。

直接复用 Pi 的配置：默认 `~/.pi/agent/`，遵循 Pi 原生的 `PI_CODING_AGENT_DIR` 环境变量。使用已有 Pi 的 `/login`、`/model` 等功能配置认证和默认模型，Corilo 读取相同的 `auth.json`、`models.json` 和 `settings.json`；也遵循 Pi 支持的提供商环境变量。Corilo 不提供另一个密钥表单，不保存或改写模型选择，不强制选 DeepSeek。已有会话的模型恢复遵循 Pi 默认规则。

更改 Pi 配置后重新启动当前 Corilo 宿主。此前开发版本的 `config/pi/` 不会自动迁移或覆盖标准 Pi 配置。未配置模型时仍能编辑和仅保存原话。在线模型会接收对话及工具读取的相关内容；Pi cwd 不是沙箱。

## 文件与恢复边界

编辑器保存会核对读取版本，冲突时保留草稿并提供另存入口。Agent 使用 Pi 默认文件工具，不附加逐文件审批或事务保存框架。本地 Git 在初始状态、编辑保存及 Agent 前后建立历史；尚无界面化历史恢复，可由开发者检查 Git 提交。

当前文件 HTTP 接口单次最多 16 MiB，拒绝隐藏路径和符号链接；这仅约束文件页面接口，不限制 Pi 默认 shell 的访问能力。跨平台文件名检查目前覆盖页面创建及重命名；完整远端同步检查待接入。

一个知识库只允许一个宿主。正常退出会清理 `.corilo-host.lock`；强制终止后，需确认旧进程已经停止再移除该锁。安装器自动恢复、重复启动复用、系统签名及升级仍待实现。GitHub 状态明确显示“待接入”，本机提交不冒充远端备份。

## 验证

```bash
npm test
python3 -m pip install -r requirements-dev.txt
python3 -m playwright install chromium
python3 app/tests/browser_smoke.py
python3 app/tests/browser_review.py
```

2026-10-09 代码复核：10 项 Node 集成测试通过；真实 Chromium 检查覆盖完整编辑器、保存/重载、原话保存、外部文件刷新、冲突保留与草稿另存。额外的 4 组浏览器回归覆盖移动重名保护、分屏版本隔离、文件名按纯文本渲染、发送前保存最新草稿及防重复提交；前 3 组曾在修复前真实失败。浏览器脚本优先使用系统 `chromium`，否则使用 Playwright 安装的版本；Linux 缺少系统库时使用官方 `install --with-deps chromium`。

Pi 默认 read/edit/write 工具已实际操作文件；完整 Pi 推理循环通过本机脚本化模型响应完成读取、修改及会话恢复测试。该模型响应是**协议测试替身**，不证明真实 DeepSeek 效果。未进行真实模型调用、Windows/macOS 实机或 Android 验证。浏览器结果和截图位于忽略的 `.local/`。

[应用 CI](.github/workflows/app.yml) 配置了 Node 测试和 Chromium 检查；已配置不等于远端运行通过。

## 历史原型

`prototype/` 是保留的 Python 单文件存储原型，不作为正式应用继续扩展：

```bash
python3 scripts/run_local.py --init
python3 -m unittest discover -s prototype/tests -v
```

原型默认库 `.local/xuye-prototype/`、`.personalos` 等兼容标识保持不变。旧测试和 `p0/` 证据仅代表其各自阶段，不作为当前应用验收。

## 设计与来源

[设计索引](docs/README.md) · [产品](docs/PRODUCT.md) · [业务规格](docs/PRODUCT-SPEC.md) · [技术](docs/TECHNICAL_DESIGN.md) · [交互](docs/DESIGN.md)

Files.md Web 源码与许可在 [app/vendor/filesmd](app/vendor/filesmd)，固定提交及文件 SHA-256 见 [SOURCE.json](app/vendor/filesmd/SOURCE.json)。上游文件保持原样，由宿主修改返回的 HTML、生命周期回调和文件名渲染，并加载 Corilo 适配层；Go 服务、Telegram Bot、Worker 未引入。Pi 的安装版本固定在 package-lock.json。Termux 尚未引入应用代码，组合发行许可与相应源码交付随 Android 工程落实。

代码仓库为 `keanrain/corilo`，知识库远端另行配置。只在开发分支提交推送，不自动合入 main、部署或修改仓库可见性。
