# Corilo 可里设计索引

**简体中文** | [English](README.en.md)

2026-11-15 仓库更新：notes／todos 升级固定 DSH rc.3；独立学习导师见 [packages/learn-anything](../packages/learn-anything/README.md)。Python 原型已按用户要求删除，历史实现可从 Git 查阅，本地数据保留。

> 当前补丁版本：todos 0.6.3。提醒、跨日分类、日历任务分页与代码结构修复见 [交接文档](HANDOFF.md)；旧配置和数据库不自动迁移。

当前源码实例默认启用 **notes 0.7.0＋todos 0.6.3 planner v2**：Files.md 管笔记、资料与日记；todos 管任务、日历、时间块和提醒。Agent 使用 Harness 原生会话与工具。学习导师仅供已有 DSH 用户独立安装，不加入默认组合。

| 文档 | 职责 |
|---|---|
| [接手快照](HANDOFF.md) | 当前版本、运行／迁移、证据及后续工作；不是业务规则来源 |
| [根 README](../README.zh-CN.md) | 安装启动、当前功能与升级边界 |
| [产品](PRODUCT.md) | 定位、范围与取舍 |
| [业务规格](PRODUCT-SPEC.md) | 当前业务范围与关键约束 |
| [交互设计](DESIGN.md) | 笔记、planner 与导师的当前交互边界 |
| [技术设计](TECHNICAL_DESIGN.md) | 当前架构、依赖与存储兼容边界 |
| [开发指南](DEVELOPMENT.md) | 目录、命令、检查和分发 |
| [分发指南](RELEASING.md) | 三个产品的独立版本、变更记录与发版准备 |
| [插件导航](../plugins/README.md) | 笔记与任务／日程包 |

新实例生成双插件 planner 配置；已有单插件／v1 双插件配置、SQLite 数据库及旧应用保留。planner 只能使用新的空资料目录，旧库升级工具尚未实现，不自动迁移或删除。`corilo-import-todos` 默认预览，`--apply` 将记录导入 Markdown，原 SQLite 不改写、不删除。这是可选单向导出，已不作为待办插件退役路径。完整操作见包内指南。

真实 Harness、Chromium 工作区流程、工具管线、包外生产安装及迁移测试分别记录；不代表真实 DeepSeek、物理手机、WebKit、目标 Linux 常驻部署或 NAS 已验收。个人自部署不依赖 Corilo 账号、Supabase 或 GitHub 绑定。

旧规则见 [v0.32 业务规格](history/PRODUCT-SPEC-v0.32.md)、[v0.32 技术记录](history/TECHNICAL_DESIGN-v0.32.md)、[v0.32 交互](history/DESIGN-v0.32.md)。这些极简自定义页面规则已被本轮 Files.md 移植方向替代。更早档案仍保留在 history/，旧 app/、Android 和凭据不自动迁移。旧云端提交继续关闭。

v0.34 设计恢复独立任务与日程，取代 v0.33 中只使用 Markdown 管理个人待办的方向；Files.md 保留要求不变。[v0.33 产品](history/PRODUCT-v0.33.md)、[规格](history/PRODUCT-SPEC-v0.33.md)、[技术](history/TECHNICAL_DESIGN-v0.33.md)、[交互](history/DESIGN-v0.33.md) 留作历史，不继续作为当前需求。历史阶段计划不代表当前待实现清单，当前范围以产品与业务规格为准。

原 v0.34 文档完整归档为 [产品](history/v0.34/PRODUCT.md)、[规格](history/v0.34/PRODUCT-SPEC.md)、[技术](history/v0.34/TECHNICAL_DESIGN.md)和[交互](history/v0.34/DESIGN.md)。当前入口已按实际代码重写，未实现的长期目标留在历史中。
