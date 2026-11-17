# @corilo/dsh-todos 变更记录 / Changelog

此文件记录当前可分发代码，不代表已经发布 npm。后续每个版本单独记录变更与兼容边界。

This records currently distributable code, not an npm publication. Maintain changes and compatibility boundaries separately for each future version.

## 0.6.2

- 重做 planner 侧栏、任务分组、筛选、日历与详情布局，增加浅深色、窄屏和键盘交互的真实 DSH 浏览器检查。
  Redesign planner navigation, grouped tasks, filters, calendar, and details; validate light/dark, narrow layouts, and keyboard interactions in real DSH.
- 保留日期、提醒、保存快照、冲突与回执流程，不迁移既有数据库或配置。
  Preserve date/reminder behavior, submitted snapshots, conflicts, and operation receipts without migrating databases or configurations.

- planner 与 v1 界面、日历和校验提示支持 DSH 中英文热切换，保留未保存输入及用户原文；增加双语文档。
  Planner/v1 UI, calendars, and validation messages follow live DSH Chinese/English switching, preserving drafts and user text; add bilingual documentation.

## 0.6.1

- 修复普通编辑丢弃已到期但尚未扫描提醒的问题，保留原待处理提醒并更新版本快照。
  Fixes ordinary edits dropping already-due reminders before scanning; retains pending reminders and updates their version snapshots.
- 跨日时间块按日期区间重叠进入今天／未来视图；全天和定时结束均采用排他边界。
  Time blocks spanning days appear in Today/Future by date-range overlap; all-day and timed ends are exclusive.
- 日历任务选择支持超过 100 条记录的续页，轮询保留已展开页数。
  Calendar task selection supports pagination beyond 100 records, retaining expanded pages during polling.
- 拆分 planner 页面模块，将普通列表筛选、计数和分页放入查询层，保持现有 v2 schema 与数据。
  Splits planner UI modules and moves ordinary list filtering, counting, and pagination into the query layer while preserving the v2 schema and data.
- 保留 v1 兼容模式；planner v2 使用新目录，不自动迁移旧库。
  Retains v1 compatibility; planner v2 uses a new directory without automatic old-database migration.
- 当前构建固定兼容 DSH 0.2.2-rc.3，Node.js ≥24.9.0；仅提供本地 tgz，包保持 private。
  The current build is pinned to DSH 0.2.2-rc.3 and Node.js ≥24.9.0; local tgz only, with the package remaining private.
