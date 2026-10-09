# Corilo 可里设计索引

版本 v0.12 · 2026-10-09。本文档组按用户最新决策替代 v0.11，不代表正式应用已经实现。

| 文档 | 唯一职责 |
|---|---|
| [产品](PRODUCT.md) | 定位、首期范围与取舍 |
| [业务规格](PRODUCT-SPEC.md) | 行为规则与验收条件 |
| [技术设计](TECHNICAL_DESIGN.md) | 架构、平台、依赖及实施顺序 |
| [交互设计](DESIGN.md) | 页面、操作流程与状态反馈 |
| [上游基线](upstream-baseline.json) | 已调查版本；不是应用依赖锁文件 |

## 已确定的方向

个人本地 Markdown 知识库，复用完整 Files.md 页面和编辑器，去掉 Telegram Bot、Worker 和原同步连接。Pi coding agent 使用默认工具、模型管理和会话能力；模型在线调用，初期 DeepSeek。Agent 通过普通文件工具操作知识库，行为主要由系统提示词约定。

桌面 Windows/macOS 使用启动器自动启动本地服务并打开 Chrome；Android 使用集成运行环境的 APK 和 WebView。用户无需单独安装 Termux 或启动终端。首期 GitHub 私有仓库同步；Supabase、iOS、云端业务服务器后置。

## 实现状态

- `app/` 已接入完整 Files.md Web 源码、Node 磁盘宿主、Pi SDK 默认工具和本地 Git 历史；启动见[根 README](../README.md)。Git 同步与冲突 UI 已接入，真实 GitHub 连接、桌面安装包和 Android APK 尚未验收。Python 原型独立保留。
- 2026-10-08 的开发检查覆盖原型 30 项测试和 Chromium 保存、编辑、重载；不等于正式应用通过验收。
- Pi 1.1.0 在 Linux 上的默认 read/write/edit/bash 工具已作真实文件检查，模型调用为零。Android ARM64 依赖包检查不等于 Android 执行通过。
- Termux 集成已完成源码调查，尚未重建 Corilo 专属 prefix、编译 APK 或真机测试。
- Android 17 是首期目标之一。Google SDK 仓库已列出 Platform 37.0；SDK 元数据不能证明应用兼容。

历史设计和当时的执行记录保留在 [v0.11 最后基线](https://github.com/keanrain/corilo/tree/6252b1597866900f71e1df188e9dda66fccda888/docs)。`p0/`、`prototype/verification.*` 是各自执行时的证据，不自动升级为新版本验收。新验收编号使用 C01–C21，旧 S01–S28 不再定义首期范围。

## 2026-10-09 开发方案复核

已补齐：Files.md 浏览器文件系统到宿主磁盘的接入范围；Agent 修改前的 Git 恢复基线；Pi 默认认证与 Git 凭据存储的区分；同步分支、跨平台文件名及重连语义。Android 自定义 prefix 和可执行路径与桌面工程同时开始，尚未解决前不把 APK 列为已具备交付条件。

本轮只审查方案及相关上游源码、修改文档，没有新增应用实现或平台测试。

## 2026-10-09 正式开发首批代码

`app/host/` 实现文件接口、Pi 生命周期和本地提交；`app/web/` 将 Files.md 文件句柄映射到同一磁盘，并提供 Agent 对话。固定 Web 源码在 `app/vendor/filesmd/`，完整性清单与根许可随源码保存。原同步、临时知识库和知识库日志写入入口停用。

9 项 Node 检查与 Chromium 文件编辑/重载/冲突/草稿另存检查通过。完整 Pi 循环使用脚本化模型响应测试；没有真实 DeepSeek 调用，不作为模型效果验收。C03/C05/C08/C14/C19/C20 的相关路径仅有 Linux 集成证据，C01–C21 尚未整体验收。

当前未提供 GitHub 同步、安装包、APK、完整会话管理及历史恢复界面。强制终止后的宿主锁需要确认旧进程停止再清理；自动恢复与重复启动复用在启动器阶段完善。

## 2026-10-09 配置简化与代码复核

按最新要求移除专用模型配置入口，改为读取 Pi 的标准配置目录（含 `PI_CODING_AGENT_DIR`），不复制认证/模型配置、不强制选模型。已修复移动覆盖、分屏版本共享、文件名 HTML 渲染和发送前保存时序问题。详细结论、回归证据和仍未达到的交付目标见 [技术设计第 11 节](TECHNICAL_DESIGN.md#11-代码复核与目标差距2026-10-09)。

## 2026-10-09 Git 同步接入

正式宿主与页面已接入仓库绑定、手动/前台空闲同步、冲突预览及版本选择、解绑。使用临时 bare 远端进行真实 Git 和浏览器集成检查，未接触真实知识库。当前凭据复用本机 Git helper，第二台设备仍需先克隆再打开。实现边界和证据见 [技术设计第 12 节](TECHNICAL_DESIGN.md#12-git-同步实现2026-10-09)，此前记录按当时状态保留。
