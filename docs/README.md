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

- 仓库中可运行的是 Python 本地原型，入口见[根 README](../README.md)。尚未集成完整 Files.md、Pi、GitHub 同步或 Android APK。
- 2026-10-08 的开发检查覆盖原型 30 项测试和 Chromium 保存、编辑、重载；不等于正式应用通过验收。
- Pi 1.1.0 在 Linux 上的默认 read/write/edit/bash 工具已作真实文件检查，模型调用为零。Android ARM64 依赖包检查不等于 Android 执行通过。
- Termux 集成已完成源码调查，尚未重建 Corilo 专属 prefix、编译 APK 或真机测试。
- Android 17 是首期目标之一。Google SDK 仓库已列出 Platform 37.0；SDK 元数据不能证明应用兼容。

历史设计和当时的执行记录保留在 [v0.11 最后基线](https://github.com/keanrain/corilo/tree/6252b1597866900f71e1df188e9dda66fccda888/docs)。`p0/`、`prototype/verification.*` 是各自执行时的证据，不自动升级为新版本验收。新验收编号使用 C01–C21，旧 S01–S28 不再定义首期范围。

## 2026-10-09 开发方案复核

已补齐：Files.md 浏览器文件系统到宿主磁盘的接入范围；Agent 修改前的 Git 恢复基线；Pi 默认认证与 Git 凭据存储的区分；同步分支、跨平台文件名及重连语义。Android 自定义 prefix 和可执行路径与桌面工程同时开始，尚未解决前不把 APK 列为已具备交付条件。

本轮只审查方案及相关上游源码、修改文档，没有新增应用实现或平台测试。
