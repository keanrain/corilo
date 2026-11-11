# Corilo 可里设计索引

v0.33 · 2026-11-11。DeepSeek Harness 为主体，当前主包 `@corilo/dsh-notes` 0.7.0 移植 Files.md 完整前端，先保留菜单与功能，不继续零散拼装页面。笔记、清单、待办、日记统一在工作区使用普通文件；Agent 使用 Harness 原生会话和工具。日期、可靠提醒与自动记忆尚未交付。

| 文档 | 职责 |
|---|---|
| [接手快照](HANDOFF.md) | 当前版本、运行／迁移、证据及后续工作；不是业务规则来源 |
| [根 README](../README.md) | 安装启动、当前功能与升级边界 |
| [产品](PRODUCT.md) | 定位、范围与取舍 |
| [业务规格](PRODUCT-SPEC.md) | 唯一当前业务规则和验收条件 |
| [交互设计](DESIGN.md) | Files.md 工作区与 Harness Agent 的衔接 |
| [技术设计](TECHNICAL_DESIGN.md) | 架构、兼容与实际证据 |
| [开发指南](DEVELOPMENT.md) | 目录、命令、检查和分发 |
| [插件导航](../plugins/README.md) | 工作区包及旧待办包 |

新实例只加载一个工作区插件。旧双插件配置、SQLite 数据库及旧应用保留；待办迁移必须明确执行，不能只隐藏入口后声称已迁移。`corilo-import-todos` 默认预览，`--apply` 将记录导入 Markdown，原 SQLite 不改写、不删除。完整操作见包内指南。

真实 Harness、Chromium 工作区流程、工具管线、包外生产安装及迁移测试分别记录；不代表真实 DeepSeek、物理手机、WebKit、目标 Linux 常驻部署或 NAS 已验收。个人自部署不依赖 Corilo 账号、Supabase 或 GitHub 绑定。

旧规则见 [v0.32 业务规格](history/PRODUCT-SPEC-v0.32.md)、[v0.32 技术记录](history/TECHNICAL_DESIGN-v0.32.md)、[v0.32 交互](history/DESIGN-v0.32.md)。这些极简自定义页面规则已被本轮 Files.md 移植方向替代。更早档案仍保留在 history/，旧 app/、Android、原型和凭据不自动迁移。旧云端提交继续关闭。
