# Corilo 可里

帮助个人记忆、思考和安排事情的云端助手，强调简单使用与资料可带走。新方向为邀请制小范围使用：桌面、Android 和 iPhone 通过网页访问同一份云端知识库，目标是 Pi 在服务端隔离环境运行（当前云端 AI 禁用）；无需本地 Agent 或 APK。

**当前正在从本机版迁移，云端邀请、会话与独立文件服务已开始实现；内部持久任务基础已加入，真实身份服务联调、Agent 执行隔离、任务执行接入与部署尚未完成。** 本轮已更新 [v0.15 正式设计](docs/README.md)，云端开发入口和所需配置见 [云端文件服务](app/cloud/README.md)。下文明确区分云端入口和保留的本机模式；本机启动命令不能直接作为公网部署方案。

## 当前入口与能力

| 模式 | 入口 | 能力边界 |
|---|---|---|
| 云端文件开发版 | `npm run start:cloud`；[配置说明](app/cloud/README.md) | 邀请/会话、独立文件库、跨端刷新、原话保存与 ZIP；真实身份未联调，AI/同步禁用 |
| 保留的本机开发版 | `npm start` | Files.md、Pi 默认工具、本机 Git 与 GitHub 同步；不是当前云端交付路径 |

记忆、待办、日程、提醒、完整账号导出恢复及自托管均未交付。目标范围与待定事项见 [业务规格](docs/PRODUCT-SPEC.md)，实现与证据见 [技术设计第 11 节](docs/TECHNICAL_DESIGN.md#11-邀请与云端文件首条链路2026-10-21)。

## 保留的本机实现

`app/` 已接入固定版本的完整 Files.md Web 页面和 CodeMirror/HyperMD 编辑器、本机 Node 文件宿主、Pi 1.1.0 默认工具及本地 Git 历史。页面、Pi 和 Git 使用同一个磁盘知识库，浏览器临时存储与原 Files.md 远程同步入口已停用。

目前可用：真实文件编辑、文件树、原话保存、外部修改冲突提示及草稿另存、复用已有 Pi 配置、Agent 对话/停止、观察到的文件变更入口、最近本机会话恢复、GitHub 私有仓库绑定、Git 同步与冲突处理。对话流通过本机状态轮询增量显示。模型配置沿用 Pi 的 `auth.json`、`models.json` 和 `settings.json`。

**这是正式应用的首条开发链路，尚不是可分发安装包。** 桌面安装器与 Android APK 已暂停，不再列入当前待交付；完整会话切换和历史恢复界面尚未实现。Windows/macOS 启动代码尚未在目标系统验收。不要把当前阶段当作已经通过全部首期验收。

## 暂停的本地发行路线

桌面启动器和 `android/` 集成 APK 暂停开发，已有代码、来源与构建脚本保留。当前分支的 Android Actions 改为仅手动运行，不再为每次云端改动自动消耗构建资源；此修改不取消其他分支已提交或运行中的任务。

后续主路线为网页 + 云端文件服务 + 隔离 Pi worker，详见 [迁移顺序](docs/TECHNICAL_DESIGN.md#8-实施顺序)。下文 GitHub 同步也是旧本机功能，新版不要求绑定 GitHub。

## 本机模式开发启动

需要 Node.js >=22.19.0、Git；Pi 的默认 shell 工具需要 Bash（Windows 开发机需要 Git Bash）。首次安装依赖：

```bash
npm ci --ignore-scripts
npm start
```

启动时自动尝试打开 Chrome。当前开发入口仍依赖本机已安装的 Node/Git/Chrome（Linux 另需 util-linux 的 `flock`）；本地安装包路线已暂停。Linux 云环境或无 GUI 时使用：

```bash
npm start -- --no-open --vault .local/app-notes --config .local/app-config
```

终端会打印带**本机访问凭证**的启动链接，仅供本机使用，不要分享。服务只监听 `127.0.0.1`，随机端口，页面去除 URL 中凭证后保存在当前标签页的 sessionStorage。Ctrl+C 正常退出。

默认目录位于 Windows `%LOCALAPPDATA%/Corilo`、macOS `~/Library/Application Support/Corilo`、Linux `$XDG_DATA_HOME/corilo`（未设置时 `~/.local/share/corilo`）。`knowledge/` 存笔记，`config/sessions/` 保存由 Pi 管理的 Corilo 会话。模型认证和设置直接读取 Pi 标准目录，不在 Corilo 下复制一份。开发检查使用虚构资料。

直接复用 Pi 的配置：默认 `~/.pi/agent/`，遵循 Pi 原生的 `PI_CODING_AGENT_DIR` 环境变量。使用已有 Pi 的 `/login`、`/model` 等功能配置认证和默认模型，Corilo 读取相同的 `auth.json`、`models.json` 和 `settings.json`；也遵循 Pi 支持的提供商环境变量。Corilo 不提供另一个密钥表单，不保存或改写模型选择，不强制选 DeepSeek。已有会话的模型恢复遵循 Pi 默认规则。

更改 Pi 配置后重新启动当前 Corilo 宿主。此前开发版本的 `config/pi/` 不会自动迁移或覆盖标准 Pi 配置。未配置模型时仍能编辑和仅保存原话。在线模型会接收对话及工具读取的相关内容；Pi cwd 不是沙箱。

## 本机模式文件与恢复边界

编辑器保存会核对读取版本，冲突时保留草稿并提供另存入口。Agent 使用 Pi 默认文件工具，不附加逐文件审批或事务保存框架。本地 Git 在初始状态、编辑保存及 Agent 前后建立历史；尚无界面化历史恢复，可由开发者检查 Git 提交。

当前文件 HTTP 接口单次最多 16 MiB，拒绝隐藏路径和符号链接；这仅约束文件页面接口，不限制 Pi 默认 shell 的访问能力。跨平台文件名检查覆盖页面创建、重命名和同步树；远端符号链接、子模块、Windows 非法名称及大小写/Unicode 冲突会暂停同步。

一个知识库只允许一个宿主。正常退出清理 `.corilo-host.lock`；Linux 内核锁使用持久的 `.corilo-host.flock`，不要手动删除它。云端纯文件模式可回收已确认死亡进程的有效标记；本机 Pi、旧版或未知锁仍需确认旧进程及子进程停止后人工处理。本机安装器路线已暂停；此机制不等于 Agent 或 Git 写入中途的完整崩溃恢复。本机保存与 GitHub 上传分开显示；只有 push 成功才记录远端同步时间。

## GitHub 同步（仅保留的本机模式）

在页面右上角“GitHub 同步”填写已有私有仓库的 HTTPS 地址及分支。先通过本机 Git 凭据管理器登录 GitHub，并授予目标仓库读写权限；推荐限定仓库的 fine-grained PAT，通过凭据管理器保存，不填在 Corilo 页面或 remote URL 中。绑定会通过 GitHub API 核对仓库身份、私有属性及写入权限。本轮未使用真实 GitHub 知识库或凭据验证此连接。

首次同步可使用空远端。第二台设备先把同一仓库 `git clone` 到新目录，再用 `--vault` 打开该目录并绑定相同分支；图形化克隆/选库入口尚未提供。已有但没有共同历史的两份知识库不能直接绑定合并。

同步依次建立本地提交、拉取、隔离合并、应用、非强制推送。页面保持打开且处于前台时，空闲后尝试同步；正常重试间隔一分钟，回到前台可提前触发。Agent 执行、编辑和保存活动会延后自动同步；手动入口始终可用。当前同步期间编辑器暂时只读，失败后恢复编辑；长网络操作可能持续到超时，后续可缩短写入锁范围。关闭页面后不保证后台自动同步。

冲突在库外临时目录处理，可查看文本双方，选择本机、远端、两份或手工合并；二进制/大文件只提供版本选择。冲突出现后本机又有修改，旧选择会被拒绝，应点“立即同步”重新计算。重启会重算未完成冲突，不保留未提交的手工合并草稿。解绑只删除本机连接信息，保留本机文件和远端仓库。

连接信息和隔离合并目录在 `config/sync/<知识库路径摘要>/`，不进入知识库。Git 沿用已有凭据管理器，其安全性取决于本机 helper 配置；本版尚未打包平台凭据管理器。单个 Git 命令最长 60 秒；大附件/网络/权限错误保留本地提交并提示重试，尚未提供大附件的逐文件诊断和历史恢复 UI。

## 检查与历史证据

```bash
npm test
python3 -m pip install -r requirements-dev.txt
python3 -m playwright install chromium
python3 app/tests/browser_smoke.py
python3 app/tests/browser_review.py
python3 app/tests/browser_sync.py
```

2026-10-09 代码复核：10 项 Node 集成测试通过；真实 Chromium 检查覆盖完整编辑器、保存/重载、原话保存、外部文件刷新、冲突保留与草稿另存。额外的 4 组浏览器回归覆盖移动重名保护、分屏版本隔离、文件名按纯文本渲染、发送前保存最新草稿及防重复提交；前 3 组曾在修复前真实失败。浏览器脚本优先使用系统 `chromium`，否则使用 Playwright 安装的版本；Linux 缺少系统库时使用官方 `install --with-deps chromium`。

Pi 默认 read/edit/write 工具已实际操作文件；完整 Pi 推理循环通过本机脚本化模型响应完成读取、修改及会话恢复测试。该模型响应是**协议测试替身**，不证明真实 DeepSeek 效果。未进行真实模型调用、Windows/macOS 实机或 Android 验证。浏览器结果和截图位于忽略的 `.local/`。

接入同步后共 19 项 Node 测试通过。新增同步测试使用真实临时 bare Git 远端，覆盖双库合并、离线重试、文本/删除修改/二进制冲突、过期选择、非法名称、并发推送和解绑；浏览器同步检查走真实宿主与 Git，仅将仓库身份校验替换为临时路径校验。GitHub 身份校验用合成凭据和 API 响应测试，没有向真实 GitHub 知识库发请求。

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

Files.md Web 源码与许可在 [app/vendor/filesmd](app/vendor/filesmd)，固定提交及文件 SHA-256 见 [SOURCE.json](app/vendor/filesmd/SOURCE.json)。上游文件保持原样，由宿主修改返回的 HTML、生命周期回调和文件名渲染，并加载 Corilo 适配层；Go 服务、Telegram Bot、Worker 未引入。Pi 的安装版本固定在 package-lock.json。Termux 尚未引入应用代码，Android 分发已暂停；如恢复，仍需核对组合发行许可与相应源码交付。

代码仓库为 `keanrain/corilo`，知识库远端另行配置。只在开发分支提交推送，不自动合入 main、部署或修改仓库可见性。

## 知识库导出（本机与云端文件模式）

顶栏“导出知识库”保存当前草稿后下载普通 ZIP。`knowledge/` 包含已保存的可见笔记、原附件和空目录，保留路径与字节；`manifest.json` 提供版本、排除项与 SHA-256，`README.txt` 说明范围。解压即可使用，无需 Corilo。第一版最多 128 MiB / 10,000 项，Agent 或同步运行时需稍后重试，链接/特殊文件会被拒绝。

这是知识库内容导出，不含隐藏项、Git 历史、配置密钥、对话、任务或日程，不是完整账号备份。账号级导入恢复、自托管、记忆与提醒尚未实现。最新阶段详见正式设计。

云端文件服务新增 `npm run start:cloud`；这是独立入口，不改变原 `npm start` 的本机模式。真实数据库/浏览器检查通过，但身份服务使用测试替身，云端 AI 禁用。请先阅读云端 README 的前置配置、账号开通方式和未完成项。
