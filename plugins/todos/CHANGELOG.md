# @corilo/dsh-todos 变更记录 / Changelog

此文件记录当前可分发代码，不代表已经发布 npm。后续每个版本单独记录变更与兼容边界。

This records currently distributable code, not an npm publication. Maintain changes and compatibility boundaries separately for each future version.

## 0.8.2

- 改为固定兼容 DSH 0.2.2-rc.5（Node.js ≥24.9.0 不变）。rc.3→rc.5 的宿主改动集中在网页搜索、DeepSeek 模型接入和新增的内容拒绝错误码，本包用到的接口未变；锁文件只更新 DSH 包。在 rc.5 上不再因版本要求被宿主拒绝。数据格式不变，无需迁移；rc.3 实例请继续使用上一版本。
  Now pinned to DSH 0.2.2-rc.5 (Node.js ≥24.9.0 unchanged). Host changes from rc.3 to rc.5 are in web search, DeepSeek model access and a new content-refused error code; the interfaces this package uses are unchanged, and the lockfile only updates DSH packages. The host no longer rejects it on rc.5. Data formats are unchanged, so no migration; rc.3 instances should stay on the previous version.

## 0.8.1

- 「已添加」「已保存」「任务已完成」「任务已恢复」这类成功提示 3 秒后自动消失；错误、版本冲突、结果未知和未保存提示保持到处理完成。
  Success notices (added, saved, completed, restored) disappear after 3 seconds; errors, conflicts, unknown outcomes and unsaved notices stay until handled.
- 取消勾选「全天」不再跳到今天：保留事件当前日期，按日程自己的时区设为 09:00–09:30；改回全天时取该时区的日期。时间不存在时报错，不做猜测。
  Unchecking all-day keeps the event's date (09:00–09:30 in the event's own zone) instead of jumping to today; the reverse uses the date in that zone. A nonexistent time is an error, never a guess.
- 全天日程的表单与冲突预览显示包含当天的「结束」日期（最后一天），存储和 API 仍为不含当天的结束日期；结束早于开始时显示校验错误并禁用保存。
  All-day events show an inclusive "End" date (last day) in the form and conflict preview; storage and API keep the exclusive end. An end before the start shows a validation error and disables Save.
- 编辑表单默认只显示常用字段，其余收进「更多」；已有非默认内容（说明、清单、优先级、状态、地点、关联任务、不同时区）时自动展开。
  The editor shows common fields by default and folds the rest into "More", which opens automatically when any folded field holds non-default data.
- 「新建日程」只在「今天」和「日历」视图显示，其他视图看不到已保存的日程。
  "New event" appears only in Today and Calendar, the views where saved events are visible.

## 0.8.0

- 改为侧边栏布局：左侧列出今天、未来、收集箱、全部（带未完成计数）、日历、提醒、各个清单（带计数）和已完成／已取消；刷新、导出和显示时区也在侧栏。窄屏时侧栏收为抽屉，标题左侧的菜单按钮打开。
  Sidebar layout: Today, Future, Inbox and All with open-task counts, Calendar, Reminders, every named list with its count, and Done/Cancelled; refresh, export and the display zone live there too. On narrow screens the sidebar is a drawer opened from the menu button.
- 从侧栏选中的清单作为一个独立位置显示（清单名作标题），不再显示为“已筛选”。
  A list picked in the sidebar is shown as its own place, not as an active filter.
- 每个任务视图顶部新增快速添加：输入标题回车即创建，沿用当前视图的日期／清单预填和回执处理；「添加任务」按钮打开完整详情并带上已输入的标题。
  Inline quick add at the top of each task view; Enter creates the task with the view's defaults and the usual receipt handling. "添加任务" opens the full editor prefilled with the typed title.
- 新增只读接口 `tasks/summary`，按与各视图相同的规则返回侧栏计数。
  New read-only `tasks/summary` API returning sidebar counts computed with the same rules as the views.

## 0.7.0

- 显示时区直接采用本机时区并按浏览器记住，不再每次打开都要先点「确认时区」。在时区弹层中可以明确改用其他时区。
  The display zone applies immediately and is remembered per browser; the "Confirm time zone" gate is gone. Choose another zone explicitly in the time-zone popover.
- 在「今天」「未来」或某个清单筛选下新建任务，会预填对应的计划日期或清单，保存后仍留在当前视图。
  Tasks added from Today, Future or a list filter get the matching planned date or list, so they stay in the view they were added from.
- 提醒、定时日程的开始／结束和精确截止改为「日期 + 时间」控件，按记录所属时区理解，存储格式不变。夏令时切换造成的不存在或重复时刻不做猜测，改为列出带 UTC 偏移的候选让用户选择。提醒提供快捷时间，选择已过的时间会就地提示不会提醒。冲突预览显示本地时间加偏移。
  Reminders, timed event start/end and exact deadlines use date + time controls in the record's zone; stored instants are unchanged. Daylight-saving gaps and overlaps are never guessed: candidates with explicit UTC offsets are offered. Reminder shortcuts and an inline note for past reminder times. Conflict previews show wall-clock time plus offset.
- 「今天」顶部列出当天的日程与任务时间块。周／日视图从 8:00 开始显示。窄屏头部更紧凑，「今天」「日历」排在标签最前。状态文案改为「未完成」，「已取消」改用禁止图标；时区与本机相同时只显示图标。
  Today lists the day's events and task time blocks. Week/day grids open at 8:00. Compact phone heading with Today and Calendar first. Status reads "Open"; Cancelled uses a ban icon; the zone name shows only when it differs from the device.

## 0.6.6

- 将 FullCalendar 和 Luxon 移为构建依赖，生产安装继续使用已构建的客户端。Temporal 仍供宿主处理日期。
  Move FullCalendar and Luxon to build dependencies. Production installs use the bundled client, and the host continues to use Temporal for dates.
- 文档按 planner v2 和 v1 兼容模式组织，更新安装包示例。
  Organize documentation around planner v2 and v1 compatibility, and update the install examples.

## 0.6.5

- 待办面板切走再返回时，保存和回执核对仍可完成，草稿保留。列表刷新超时后恢复保存与关闭操作。
  Finish saves and receipt checks across host panel switches while preserving drafts. Restore save and close controls if a list refresh times out.
- 冲突预览只采用最近一次请求的结果。日程按记录 ID 显示已完成或尚未分页加载的关联任务，采用服务器版本时保留可见关联。
  Apply only the latest conflict preview request. Look up event links by task ID so completed and off-page tasks remain visible after adopting the server version.

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
