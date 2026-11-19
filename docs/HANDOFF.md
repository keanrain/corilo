# Corilo 可里当前交接

更新于 2026-11-19。当前产品规则见 [业务规格](PRODUCT-SPEC.md)，启动和验证命令见 [开发指南](DEVELOPMENT.md)。版本与分发渠道见 [分发指南](RELEASING.md)。

## 笔记 0.9.0 与待办 0.8.0（2026-11-19）

分支 `feat/sidebar-notes`，基于 main `486c193`。

- todos：侧边栏布局（视图、清单及未完成计数、日历／提醒、已完成／已取消，窄屏为抽屉）；侧栏清单作为独立位置；任务视图顶部回车快速添加；新增只读 `tasks/summary`。
- notes：只用于查看和编辑笔记，隐藏收集页与侧栏收集项，去掉工作区 Agent 按钮；上游打开收集页的路径改为保持或打开笔记；默认打开上次查看或最近修改的笔记，空资料提示新建；配色与待办统一。`Chat.md` 不删除不改动；Agent 的收集工具（`corilo_notes_capture`）已移除，工具共七个。
- 数据格式、SQLite schema、权威边界与 DSH 版本不变。
- 本地应用时，补上快速添加的回执与草稿保护，并让启动器验证走保留的笔记新建接口。已通过 notes 64 项 Node（含真实 restic 恢复）、todos 45 项 Node、旧 app 三套浏览器及工具链 19 项。测试使用合成资料。

## 笔记 0.8.0 与待办 0.7.0 体验改进（2026-11-18）

分支 `feat/ux-p0-p1`，基于 main `4d0e740`。依据《笔记与日程插件体验优化方案》的 P0／P1 项；收集自动分拣（方案 P1 #6）待定，未实现。

- notes：修复图片资源被当作文本转码（`img/icon.png` 87,111 字节被发成 156,029 字节）；Files.md 界面文案运行时中文化，vendor 不改；默认打开收集页；新笔记命名为「未命名」并选中标题。
- todos：去掉每次打开的「确认时区」闸门，时区按浏览器记住；新建任务按视图预填日期／清单；提醒、定时日程起止和精确截止改为日期 + 时间控件，夏令时缺口／重叠列出带偏移的候选；提醒快捷项与已过提示；「今天」显示当天日程；周／日视图从 8:00 显示；窄屏头部紧凑。
- 数据格式、SQLite schema、存储的时刻格式、权威边界与 DSH 版本均不变；不迁移用户资料。
- 已执行：notes 64 项 Node（63 通过，1 项 restic 实测因环境无 restic 跳过）、todos 44 项 Node；notes Files.md／classic／中英切换三套浏览器；todos v1 四套与 planner 三套浏览器；旧 app 三套浏览器；工具链 19 项、启动器 4 项，均通过。图片资源与时区闸门两项回归已先在旧实现上确认失败；其余新增断言针对新控件，旧实现中没有对应元素。仅 Chromium 与合成资料，未做真机、真实模型或目标部署验收；远端 CI 未运行。

## 上一轮依赖清理

- notes 0.7.1 移除未使用的 `uuid` 开发依赖。CodeMirror 6、Lezer、DOMPurify 和 markdown-it 随客户端打包，独立生产安装无需另外安装它们。
- todos 0.6.6 将 FullCalendar 和 Luxon 留在构建阶段。上个版本已验证切换宿主面板后仍能完成保存和回执核对，并修复冲突预览乱序及已完成任务的日程关联显示。[0.6.5 发布](https://github.com/keanrain/corilo/releases/tag/packages-20261118)
- 导师 0.1.0 独立安装到已有 DSH。空学习工作区使用 SQLite，旧 JSON／JSONL 需显式迁移。迁移、导出与中断恢复见 [导师指南](../packages/learn-anything/README.md)。
- 源码新实例默认启用 notes＋todos planner v2。旧实例可继续使用原配置；启用 planner v2 需要新的空目录。三个插件使用 DSH 0.2.2-rc.3、Node.js ≥24.9.0。

## 上一轮清理的验证

- 两包独立锁合计减少 45 项生产依赖记录（notes 32 项、todos 13 项）。保留依赖的解析版本与完整性摘要一致。
- 已执行 notes 61 项和 todos 37 项 Node 测试，包含包外生产安装和真实 DSH 启动。notes 的真实 restic 恢复测试、工具链 19 项、启动器 4 项均通过。

- 真实 DSH 的 notes Files.md、classic 与语言切换，以及 todos planner／v1 浏览器回归均通过。检查了 330 个仓库内 Markdown 链接，并复核最终两份安装包的文档相对链接和归档内容。

## 历史与验收

- 文档索引提供当前入口。[文档索引](README.md)
- 历次交接保留了导师真实 DSH mock 端到端流程、SQLite 恢复、旧包生产安装、浏览器回归和发布记录。[历史交接](history/HANDOFF-through-2026-11-18.md)
- 真实模型、物理手机、目标部署及整实例恢复仍需各自的验收证据。旧阶段规划与目录见 [历史索引](history/README.md)。
