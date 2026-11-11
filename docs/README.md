# Corilo 可里设计索引

v0.34 · 2026-11-11。目标为 **一个 Harness、两个业务插件**：Files.md 管笔记、资料与日记；独立 todos 插件管任务、日程与时间块。Agent 使用原生会话与工具。产品、业务、交互和技术方案已更新，新增能力尚未实现。

当前代码仍为 `@corilo/dsh-notes` 0.7.0、`@corilo/dsh-todos` 0.5.2；启动器默认仅加载 notes，旧双插件可启动。阶段 A 验收后才调整默认组合，不把方案当作已安装功能。

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

当前默认启动行为仍为单工作区。旧双插件配置、SQLite 数据库及旧应用保留；未来扩展基于显式新库升级，不自动迁移或删除。`corilo-import-todos` 默认预览，`--apply` 将记录导入 Markdown，原 SQLite 不改写、不删除。这是可选单向导出，已不作为待办插件退役路径。完整操作见包内指南。

真实 Harness、Chromium 工作区流程、工具管线、包外生产安装及迁移测试分别记录；不代表真实 DeepSeek、物理手机、WebKit、目标 Linux 常驻部署或 NAS 已验收。个人自部署不依赖 Corilo 账号、Supabase 或 GitHub 绑定。

旧规则见 [v0.32 业务规格](history/PRODUCT-SPEC-v0.32.md)、[v0.32 技术记录](history/TECHNICAL_DESIGN-v0.32.md)、[v0.32 交互](history/DESIGN-v0.32.md)。这些极简自定义页面规则已被本轮 Files.md 移植方向替代。更早档案仍保留在 history/，旧 app/、Android、原型和凭据不自动迁移。旧云端提交继续关闭。

本轮 v0.34 取代 v0.33 中只使用 Markdown 管理个人待办的方向；Files.md 保留要求不变。[v0.33 产品](history/PRODUCT-v0.33.md)、[规格](history/PRODUCT-SPEC-v0.33.md)、[技术](history/TECHNICAL_DESIGN-v0.33.md)、[交互](history/DESIGN-v0.33.md) 留作历史，不继续作为当前需求。实施顺序见技术方案第 9 节。
