# Corilo 可里技术说明

**简体中文** | [English](TECHNICAL_DESIGN.en.md)

2026-11-15。本文描述当前代码结构；产品规则见 [业务规格](PRODUCT-SPEC.md)，命令与验证入口见 [开发指南](DEVELOPMENT.md)。原设计保存在 [v0.34 技术方案](history/v0.34/TECHNICAL_DESIGN.md)。

## 运行与依赖边界

三个业务插件均适配 DSH 0.2.2-rc.5、Node.js ≥24.9.0。各包保留独立依赖锁与分发产物；根包依赖服务旧 app，不作为插件的共享运行时。没有 npm workspaces 或根依赖提升。

`launcher/` 为新实例组合 notes＋todos planner，并兼容已有配置；它不是第三个发行包。导师包位于 `packages/learn-anything/`，只向已有 DSH 提供插件，不初始化独立 profile，不改变宿主默认预设、日志或插件清单设置。

## 笔记

Files.md 固定上游资源保留于 `plugins/notes/vendor/filesmd/`，通过持久 iframe 显示。`workspace-api.mjs` 负责宿主适配与鉴权文件路由，`workspace-store.mjs` 和 `storage.mjs` 处理文件、版本及写入队列。UI 与原生 Agent 工具操作同一磁盘资料。

上游差异通过适配层处理，不修改 vendor 掩盖错误、不放宽整个宿主 CSP。classic 界面继续兼容，其测试不能替代 Files.md 验收。

## 任务与日历

`planner: true` 选择 v2 服务和页面；省略该配置保持 v1 模式。v2 采用 Node 原生 SQLite，`schedule-schema.mjs` 定义 records、receipts、reminders、notifications 等表；`schedule-service.mjs` 与 `task-service.mjs` 承担事务、校验和业务操作，`schedule-queries.mjs` 承担筛选与分页。

记录包含版本，修改使用请求回执处理重复请求与未知结果。当前记录正文仍存 JSON；没有自动迁移 v1、改变既有库身份或在启动时补建新索引。

前端按列表、日历、详情、提醒和状态管理分拆。日历使用锁定版本的 FullCalendar 标准组件，日期边界使用 Temporal；结束时间排他。提醒事实落 SQLite，启动及每 30 秒补扫；网页通知认领仅保证一次尝试，不保证浏览器收到。

## 学习导师

bundle 注册导师、考官和检查员预设，教学工具在预设内挂载。宿主 UI 插件入口保留为 Web 客户端发现锚点；客户端构建产物随包分发。学习记录位于会话工作区 `.learn/`。新的空学习工作区在第一次学习记录写入时创建 `learner.sqlite`，使用 Node 内置 `node:sqlite`，不增加原生编译依赖。课程、知识点与靶图、验证、诊断、复习排期和提醒绑定保存在数据库；教材原文、解析块和引用元数据保留在 `materials/` 文件目录。正式验证须由真实作答与考官证据支持。

SQLite 模式下，一次学习写操作的验证记录、掌握度和复习排期在同一事务中提交或回滚。工具和 UI 共享工作区写入口；异步判题期间先暂存修改，提交时校验数据库修订号，冲突时拒绝本次写入，不自动重放考官请求。DSH 提醒任务属于宿主外部状态，安排在学习事务提交后执行，不是跨服务事务；提醒失败不回滚已经提交的学习成绩。

已有 JSON／JSONL 学习记录保持旧后端，只有显式执行迁移才切换为 SQLite；保留原文件不表示双写或自动同步。`.learn/.backend.json` 记录后端及数据库实例身份；启动只打开已识别的数据库，数据库缺失、实例不符、损坏或不兼容时拒绝回退旧记录，不自动升级其 schema。中断后遗留的首次建库 `.initialization.json` 或迁移 `.migration.lock` 标记必须显式恢复，恢复会校验停机、文件身份及快照摘要；待定首次建库可继续发布，待定旧数据迁移则中止并保留暂存数据。运行时使用 WAL，并校验主库及附属文件；备份、导出和还原前须停止相关服务。存储 API 当前仍将一致学习快照读入内存，业务历史扫描尚未改为 SQL 索引查询，也未实现 FTS5 检索。迁移、导出和恢复操作见 [导师指南](../packages/learn-anything/README.md)。

## 存储与兼容

Markdown 文件、todos 数据库、DSH 会话和导师学习记录具有不同数据边界。现有 notes/state 备份工具不是三插件整实例备份。运行中的 SQLite 不应仅复制主库而遗漏 WAL；恢复流程需分别验证。

旧 `app/`、`p0/` 与既有数据原位保留，Python prototype 与 `android/` 工程（2026-11-27，按用户要求）已删除，移动端暂以手机浏览器打开 DSH 网页。新增能力优先使用 DSH 公开扩展点，不建立第二套模型管理、认证或 Agent loop。重复、外部通知、跨插件来源关联与旧库升级仍未交付。
