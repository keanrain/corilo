# Corilo 可里技术设计

v0.12 · 2026-10-09。当前文档定义目标实现，现有 Python 原型继续独立可运行。

## 1. 总体架构

```mermaid
flowchart TD
    A[桌面 Chrome / Android WebView] --> B[本机 Node 宿主]
    B --> C[Pi coding agent 默认 SDK]
    C --> D[DeepSeek 在线 API]
    C --> E[本地 Markdown Git 工作树]
    B --> E
    B --> F[本机 Git 同步任务]
    F --> G[GitHub 私有知识库仓库]
    H[桌面启动器 / Android Service] --> B
```

Files.md 提供完整 Web 页面和 Markdown 编辑器，替换原服务器与文件连接适配层，移除 Bot、Worker 和原同步调用。不要把现有 textarea 原型当作完成上游复用。保留上游许可和可追踪补丁，避免先重写编辑器。

Node 宿主提供本地文件 API、Pi 会话事件桥接和 Git 调度；桌面和 Android 共用核心逻辑。首期不引入云端业务服务器、Supabase、同步数据库或专有文件协议。

## 2. 模块与边界

| 模块 | 责任 |
|---|---|
| Web UI | Files.md 复用、对话显示、编辑反馈和同步详情 |
| 本机宿主 | 文件页面适配、运行生命周期、会话事件流、loopback 安全 |
| Pi | 默认 read/bash/edit/write 工具、provider/model 配置、会话和推理循环 |
| Git 任务 | 批次提交、fetch/merge/push、冲突保留和状态反馈 |
| 平台启动层 | 安装运行组件、启动/关闭进程、凭据存储、应用升级 |

Pi 采用 coding-agent SDK，具体接口按固定版本文档实现；不另造 Agent runtime。若使用 Pi RPC，stdin/stdout JSONL 仍需宿主转为浏览器事件，不能把 RPC 当作 HTTP 服务。前端只接本机宿主，不持有模型或 Git 凭据。

文件页面使用普通文件读写接口；Agent 直接使用默认工具。可以协调编辑与同步时机，但不把 Pi 的每次写入改造成自定义审批/事务。默认 cwd 指向知识库，仅是工作目录，不是沙箱。对工具中断后的部分修改照实展示。

## 3. 数据布局与运行

知识库目录包含 Markdown、附件和 `.git`。应用配置目录另存 Pi 配置/会话、凭据引用、运行日志及可重建缓存。Git 提交前只处理知识库内容，不将应用目录置于其内部。模型配置遵循 Pi 原生格式，首启引导 DeepSeek，不创建新的模型注册表。

每个知识库仅一个本机宿主。启动器复用已运行实例，动态选择可用 loopback 端口并打开 Chrome。会话凭证限制在本机交接，校验 Host/Origin 和请求会话；不在日志或同步内容记录密钥。WebSocket/流式接口同样校验。原始异常保留在本地诊断，界面显示可操作摘要。

## 4. 桌面集成

Windows 11 x64 与 macOS 14+ Apple Silicon 优先，Chrome 为首期浏览器。需要安装 Corilo 启动器，但日常只操作网页。纯远程网页无法直接提供默认 Pi 所需 Node、shell 和 Git，因此本机组件随应用管理。

打包 Node、Git 以及 Pi 默认 shell 工具需要的 shell；Windows 需要兼容 Bash 的运行环境，不能假定 cmd 等价。macOS 也不以用户手动安装 Homebrew 作为使用前提。安装包分别锁定工具版本和校验值，发布前处理签名、macOS 公证及第三方声明。当前未选择和交付正式安装包，不把 Electron/Tauri 写成已经确定的依赖。

## 5. Android 集成

目标 Android 15/16/17、ARM64。APK 内置 WebView、管理 Node 的 Service 和 Termux 衍生运行环境，不依赖另一个 Termux APK。首次启动解压校验后的运行组件，初始化成功后启动宿主并打开页面。中途失败可重新初始化运行组件，不能删除知识库。

Termux 上游通过 bootstrap ZIP、JNI 和安装器恢复文件、权限及符号链接，随后执行原生程序。Node 和 Git 可使用 Termux 构建体系；但官方二进制绑定 `/data/data/com.termux/files/usr`。Corilo 独立包名意味着需要重建 bootstrap、Node、Git 及依赖，不能只改 APK 名称或复制官方包。更新也必须来自 Corilo 对应 prefix 的构建产物。

包中需有 Node、Git、Bash、证书；使用 Pi 的可选搜索工具时一并提供 ripgrep/fd，不能在 Android 下载普通 Linux 二进制。剪贴板优先使用 WebView/Android 接口，不要求额外 Termux:API 安装。

本次调查的 Termux app 使用 compileSdk 36、targetSdk 28。这不是 Corilo 对现代 Android 的兼容结论。计划使用 Android 17 对应 SDK 工具链；最终 targetSdk 必须在解决可执行文件限制、后台服务和上游构建适配后确定，不能通过简单提高数字宣称完成。首期个人侧载，暂不承诺 Play 上架。

Google 官方仓库在 2026-10-09 列出 `platforms;android-37.0` revision 2、channel-0，API-level 为 37.0。该事实证明 SDK 包可获取，不证明 Termux 派生 APK 在 Android 17 上可执行。必须真实完成自定义 prefix 构建与 Android 15/16/17 启动测试。

Android 私有目录作为真实 POSIX 工作树，SAF 用于导入/导出。系统可杀死后台进程；必要时按要求使用前台服务，但不保证永不停止。下次进入恢复宿主并标记未完成会话，不自动重放工具调用。

## 6. Git 同步实现

本机保存后批次提交。编辑器有未保存内容或 Agent 正在运行时不应用远端变更；Agent 完成或停止后提交已经发生的修改。同步调度每库串行，使用标准 Git，禁用 force-push。

顺序为检查状态、提交本地、fetch、合并、更新本机、push。远端在 push 前又发生变化时重新 fetch/合并，有限重试后保留待同步状态。不得将认证失败、读取失败或缺失扫描结果解释为用户删除。

先在隔离的 Git 合并目录或索引中完成合并。存在冲突则保持活动工作树干净可读，将双方版本提供给 UI；活动库发生新修改时重新计算合并，不能覆盖新内容。合并应用阶段与本机文件写入互斥。崩溃后以 Git 状态和实际文件重新检查，不能只相信内存“成功”。实现优先标准 Git 恢复路径，不再设计完整文件事务引擎。

文本、删除/修改、重命名和附件冲突都需测试。冲突处理生成普通提交。历史恢复复制旧版为新修改，不 reset 已同步历史。GitHub 凭据由本机安全存储提供，通过受控凭据接口交给 Git，不写进 remote URL 或命令日志。

## 7. 上游版本与已知证据

调查基线见 [upstream-baseline.json](upstream-baseline.json)。这份清单不意味着依赖已集成，正式引入后还需应用 lockfile 和平台构建校验。

| 项目 | 调查基线 |
|---|---|
| Files.md | `9e948ba6071e320c41c866f92817cf96f9bb7ba6`，MIT |
| Pi | `@earendil-works/pi-coding-agent@1.1.0`，Node >=22.19.0，MIT |
| Termux app | `8629e632fcb95da272221be327db653fb24befe9`，GPLv3-only |
| Termux packages | `9f94db4fcd0a9029079b27ffd253e5d80c4caaa8`；调查时 Node LTS recipe 24.18.0、Git 2.56.0 |

2026-10-08：Linux Node 24.19.0 上 Pi 默认工具 read/write/edit/bash 完成真实文件与 Git 调用，未调用模型。Android ARM64 npm 依赖解析和二进制载荷检查完成；没有运行 Android 设备测试。Termux bootstrap 已做下载与校验调查，但没有重建 Corilo prefix。证据摘录见 [本机检查记录](evidence/pi-host-smoke.json)。

分发 Termux 衍生 APK 须满足 GPLv3 相应义务，保留许可并提供相应源代码；不能因 Files.md 和 Pi 是 MIT 就把整个 APK 宣称为纯 MIT。正式分发前决定组合发行许可并纳入安装包。使用自己的发布签名，不复用上游测试签名。

## 8. 实施顺序与完成条件

| 阶段 | 直接交付正式应用的一部分 | 完成条件 |
|---|---|---|
| A 桌面纵向链路 | 引入完整 Files.md，Node 宿主、Pi/DeepSeek、启动器 | 点击启动、真实文件问答/修改、停止/失败回执；Windows/macOS 检查 |
| B GitHub 同步 | 设置、凭据、安全批次同步与冲突 UI | 两设备正常同步、离线重试、冲突保留、恢复旧版本 |
| C Android 包装 | 可与 A 并行准备自定义 prefix 工具链；集成同一宿主和页面 | APK 冷启动、默认 Pi 工具、Git、升级恢复；15/16/17 真机矩阵 |
| D 个人可用发行 | 安装包、诊断、许可与升级 | C01–C18 按平台记录结果，未通过项明确列出 |

不再制作新的替代 demo。Android 运行组件重建是实际产品工程任务，应尽早开始，避免桌面完成后才发现集成阻塞。当前云环境的 Linux 检查不替代 Windows、macOS 或 Android 验收。真实模型检查需要安全配置 DeepSeek 凭据，不在文档写入秘密。

## 9. 来源

- [Files.md 固定源码](https://github.com/zakirullin/files.md/tree/9e948ba6071e320c41c866f92817cf96f9bb7ba6)
- [Pi 固定源码](https://github.com/earendil-works/pi/tree/ce950d78f424dcaf9f5d6a03ce80ab141130eb1d)
- [Termux app 固定源码](https://github.com/termux/termux-app/tree/8629e632fcb95da272221be327db653fb24befe9)
- [Termux packages 固定源码](https://github.com/termux/termux-packages/tree/9f94db4fcd0a9029079b27ffd253e5d80c4caaa8)
- [Google SDK 仓库元数据](https://dl.google.com/android/repository/repository2-3.xml)

旧设计、P0 历史和原型当时的完整说明通过 [设计索引](README.md) 中的历史提交访问；不再作为当前业务要求。
