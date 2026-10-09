# Corilo 可里

**接住想法，接着往前。**

> 2026-09-24 名称确认：英文 **Corilo**，中文 **可里**。原名为「续页 · Xuye」，更早代号为 PersonalOS。本次同步品牌和本地导出目录，不改变业务范围或已有数据格式。

本地优先的个人 Markdown 知识库与 Agent 助手。正式方案为 Files.md 页面＋Pi 默认能力＋DeepSeek＋GitHub 私有仓库同步。Windows/macOS 使用启动器自动打开 Chrome，Android 使用集成 APK；详见 [当前设计](docs/README.md)。

## 现在可以启动的内容

2026-09-20 增加了独立的本地开发原型：随手保存原话、新建 Markdown、打开并修改、标题与正文关键词查找、重开读取已保存文件。输入不会自动生成任务；没有调用模型或同步服务。

这次不再只是函数补丁，但**仍不是完整可里应用**。`prototype/` 是 Python 标准库的临时本机宿主和普通 HTML/CSS/JS 入口，不是 Tauri 容器；编辑区暂用原生 textarea，尚未集成 Files.md 的完整页面、CodeMirror/HyperMD、Agent 或 GitHub 同步。Today 和通知不在首期范围。没有把这个替代入口冒充原定的上游复用已经完成。

## 启动（不需要 npm、Go、模型密钥或同步账号）

需要 Python 3.10+。在仓库根目录执行：

```bash
python3 scripts/run_local.py --init
```

在浏览器打开终端打印的本机地址，默认是 `http://127.0.0.1:8765`。只监听本机，不提供公网部署入口。

默认测试库仍位于仓库下 `.local/xuye-prototype/`，已加入 Git 忽略。此路径及 `.xuye-local/`、库识别标记和会话键是保留的兼容标识，品牌改名不会自动搬迁已有测试数据。只用虚构测试资料。`--init` 拒绝接管非空的未标记目录；没有读取或迁移你现有的知识库。

试用流程：保存一句原话 → 点击“打开原文” → 修改并点“保存修改” → 关闭服务后重新启动 → 内容仍从 Markdown 读取。笔记修改需要显式保存，Ctrl/Cmd+S 也可保存。原话存入 `收集/<操作UUID>.md`，不是浏览器内存或数据库里的隐藏正文。

Ctrl+C 停止。再次启动使用相同命令即可，已有测试文件不会被清空。端口占用时可指定 `--port 8766`；更换端口会改变浏览器草稿缓存的站点范围，但已保存 Markdown 不受影响。

## 数据保护范围

同一文件的保存经过版本 hash 核对、暂存写入和替换；操作日志用于恢复“已经写入但还没收到回执”的情况。新建不覆盖同名文件；读取失败不是删除。恢复遇到未知外部字节时保留文件并阻止继续覆盖。

这是**单文件原型**，不是多文件事务或完整同步引擎。一个库限制一个宿主进程；不支持其他编辑器/同步器同时写入。混合或特殊换行文件在界面暂为只读。不支持正式任务语义、文件删除/移动、完整导出或生产数据迁移；不要用本原型管理真实资料。

## 实际验证

```bash
python3 -m unittest discover -s prototype/tests -v
```

2026-10-08 开发基础检查在 Linux 中完成 30 项测试，包括真实临时文件、真实 loopback HTTP、实际子进程退出和 CLI 重启恢复。Python 编译和 JavaScript 语法检查通过。

历史交付中的浏览器导航曾被管理员策略拒绝，证据仍保留在 [verification.json](prototype/verification.json) 和 [原始日志](prototype/verification.log)。2026-10-08 云环境已通过 Chromium 的输入、编辑和重载检查，并修复冒烟脚本的 CSP 兼容问题；这不代表视觉、Windows/macOS、Tauri、手机、模型或通知验收完成。

浏览器验证安装及执行方式见下节；这个入口使用独立临时库，不接真实资料。

## 开发与自动检查

基础开发只需要 Python 3.10+，应用没有第三方运行依赖。在仓库根目录运行：

```bash
python3 -m unittest discover -s prototype/tests -v
python3 scripts/run_local.py --init
```

浏览器验证是单独的开发依赖，建议放入隔离环境（Mac/Linux）：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m playwright install chromium
.venv/bin/python -m prototype.browser_smoke
```

Linux 若缺 Chromium 系统库，可使用 Playwright 官方 `install --with-deps chromium` 命令；需要安装系统包的权限。Windows 使用 `.venv\Scripts\python.exe` 替代 `.venv/bin/python`。已有 Chromium 时可加 `--executable /实际浏览器路径`。

浏览器检查使用独立临时测试库，验证输入、真实 Markdown 保存、编辑及页面重载，不需要先启动默认服务。结果在被 Git 忽略的 `.local/browser-result.json`，失败以非零状态退出。定位器断言保持页面 CSP，不要求开启 `unsafe-eval`。

GitHub Actions 在推送和 PR 时自动运行 Python 3.10/3.12/3.13 的现有测试、JavaScript 语法检查和 Chromium 冒烟验证，并保留浏览器结果。工作流文件已配置不代表远端运行已经通过，需查看对应提交的 Actions 结果。P0 历史红/绿对照不算当前原型的产品验收，不纳入基础 CI。

## Git 状态与发布边界

当前工作区面向 `keanrain/corilo`。开发基线从用户提供的 Corilo 本地交接包导入，保留初始、原型和品牌改名三个提交；原包中的 `keanrain/xuye` 及旧授权结果是历史记录。

后续在开发分支提交并经审阅合入。此开发基础不创建网站部署，不修改仓库可见性，不自动推送 `main`，不调用历史 `scripts/publish_github.py` 或用 `repository-bootstrap.json` 重复建库。推送成功与否以真实 Git 返回及远端 ref 核对为准。

## 开发依据

[知识库索引](docs/README.md) · [产品](docs/PRODUCT.md) · [业务规格](docs/PRODUCT-SPEC.md) · [技术](docs/TECHNICAL_DESIGN.md) · [交互](docs/DESIGN.md)

产品规则由 v0.12 文档定义（2026-10-09），旧 v0.11 的范围已被替代。`p0/` 保留过去的固定源码、候选补丁与历史日志；不把它们当作本原型已集成代码。上游许可声明仍保留在原位置，可里整体发行许可尚未确定。

下一步直接接入完整 Files.md 页面与 Pi，交付桌面自动启动链路，同时准备 Android 自定义运行环境；随后完成 GitHub 私有仓库同步。正式架构和验收见上面的文档，不再扩大临时 Python 原型。

## 本轮改名与已有本地开发

2026-09-24 交接包的开发目录为 `corilo/`，当时分支为 `feat/local-prototype`、origin 为 `keanrain/xuye`。当前云环境的远端和提交边界见上节。此前提交和上游许可、P0 固定源码、历史测试/日志及 `.fig` 保留。

已有本地改动时，不用整个新目录覆盖旧目录或 `.git/`；从导出包的 `integration/` 读取改名提交并在本地审阅合入。历史 `scripts/publish_github.py` 仍针对原仓库初始化，不是改名工具，不应因本次品牌调整再次运行。
