# @corilo/dsh-todos 变更记录 / Changelog

此文件记录当前可分发代码，不代表已经发布 npm。后续每个版本单独记录变更与兼容边界。

This records currently distributable code, not an npm publication. Maintain changes and compatibility boundaries separately for each future version.

## 0.6.4

- 冲突预览完整列出任务与日程可编辑字段，包括已清空的值、截止时区、关联任务与提醒；保留输入前提示核对全部字段。
  Show every editable task/event field in conflict previews, including cleared values, deadline zones, linked tasks, and reminders; explain full-form replacement before keeping local input.
- 冲突恢复入口不再随继续编辑消失；采用服务器内容、保留输入或成功保存后清除冲突状态。
  Keep conflict recovery available while editing; clear it after adopting the server version, rebasing local input, or saving successfully.
- 保存和回执核对在刷新完成后同时释放提交锁与按钮状态；刷新期间的新输入继续保留。
  Release the submission lock and busy controls together after save/receipt refresh; preserve input entered during refresh.
- 增加真实 DSH 冲突与延迟刷新回归测试。保持 v1、配置和 SQLite 数据格式兼容，不自动迁移资料。
  Add real DSH conflict and delayed-refresh regressions. Preserve v1, configuration, and SQLite formats without automatic data migration.

## 0.6.3

- 使用紧凑导航、容器宽度自适应列表／详情与统一的 planner／兼容版清单视觉；日期更易读，存储时区不变。
  Use compact navigation, container-aware list/details layout, consistent planner/v1 styling, and readable dates without changing stored zones.
- 任务可直接完成与恢复，保留版本校验、未知结果核对和原请求重试；冲突后刷新，不自动重复写入。
  Complete/reopen tasks directly with version checks, unknown-result reconciliation, original-request retries, and conflict refresh without automatic repeated writes.
- 精修伸缩标题／说明、干净关闭、草稿确认、Esc／键盘焦点、筛选收起、可读冲突预览和提醒状态；不迁移既有资料。
  Refine growing titles/descriptions, clean and dirty close, Escape/focus handling, filter dismissal, readable conflict previews, and reminder states without migrating data.

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
