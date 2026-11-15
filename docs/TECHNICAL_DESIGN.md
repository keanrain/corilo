# Corilo 可里技术说明

2026-11-15。本文描述当前代码结构；产品规则见 [业务规格](PRODUCT-SPEC.md)，命令与验证入口见 [开发指南](DEVELOPMENT.md)。原设计保存在 [v0.34 技术方案](history/v0.34/TECHNICAL_DESIGN.md)。

## 运行与依赖边界

三个业务插件均适配 DSH 0.2.2-rc.3、Node.js ≥24.9.0。各包保留独立依赖锁与分发产物；根包依赖服务旧 app，不作为插件的共享运行时。没有 npm workspaces 或根依赖提升。

`launcher/` 为新实例组合 notes＋todos planner，并兼容已有配置；它不是第三个发行包。导师包位于 `packages/learn-anything/`，只向已有 DSH 提供插件，不初始化独立 profile，不改变宿主默认预设、日志或插件清单设置。

## 笔记

Files.md 固定上游资源保留于 `plugins/notes/vendor/filesmd/`，通过持久 iframe 显示。`workspace-api.mjs` 负责宿主适配与鉴权文件路由，`workspace-store.mjs` 和 `storage.mjs` 处理文件、版本及写入队列。UI 与原生 Agent 工具操作同一磁盘资料。

上游差异通过适配层处理，不修改 vendor 掩盖错误、不放宽整个宿主 CSP。classic 界面继续兼容，其测试不能替代 Files.md 验收。

## 任务与日历

`planner: true` 选择 v2 服务和页面；省略该配置保持 v1 模式。v2 采用 Node 原生 SQLite，`schedule-schema.mjs` 定义 records、receipts、reminders、notifications 等表；`schedule-service.mjs` 与 `task-service.mjs` 承担事务、校验和业务操作，`schedule-queries.mjs` 承担筛选与分页。

记录包含版本，修改使用请求回执处理重复请求与未知结果。当前记录正文仍存 JSON；没有自动迁移 v1、改变既有库身份或在启动时补建新索引。

前端按列表、日历、详情、提醒和状态管理分拆。日历使用锁定版本的 FullCalendar 标准组件，日期边界使用 Temporal；结束时间排他。提醒事实落 SQLite，启动及每 30 秒补扫；网页通知认领仅保证一次尝试，不保证浏览器收到。

## 学习导师

bundle 注册导师、考官和检查员预设，教学工具在预设内挂载。宿主 UI 插件入口保留为 Web 客户端发现锚点；客户端构建产物随包分发。学习记录位于会话工作区 `.learn/`，正式验证须由真实作答与考官证据支持。

## 存储与兼容

Markdown 文件、todos 数据库、DSH 会话和导师学习记录具有不同数据边界。现有 notes/state 备份工具不是三插件整实例备份。运行中的 SQLite 不应仅复制主库而遗漏 WAL；恢复流程需分别验证。

旧 `app/`、`android/`、`p0/` 与既有数据原位保留，Python prototype 已删除。新增能力优先使用 DSH 公开扩展点，不建立第二套模型管理、认证或 Agent loop。重复、外部通知、跨插件来源关联与旧库升级仍未交付。
