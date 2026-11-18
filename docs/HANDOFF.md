# Corilo 可里当前交接

更新于 2026-11-18。当前产品规则见 [业务规格](PRODUCT-SPEC.md)，启动和验证命令见 [开发指南](DEVELOPMENT.md)。版本与分发渠道见 [分发指南](RELEASING.md)。

## 当前版本变化

- notes 0.7.1 移除未使用的 `uuid` 开发依赖。CodeMirror 6、Lezer、DOMPurify 和 markdown-it 随客户端打包，独立生产安装无需另外安装它们。
- todos 0.6.6 将 FullCalendar 和 Luxon 留在构建阶段。上个版本已验证切换宿主面板后仍能完成保存和回执核对，并修复冲突预览乱序及已完成任务的日程关联显示。[0.6.5 发布](https://github.com/keanrain/corilo/releases/tag/packages-20261118)
- 导师 0.1.0 独立安装到已有 DSH。空学习工作区使用 SQLite，旧 JSON／JSONL 需显式迁移。迁移、导出与中断恢复见 [导师指南](../packages/learn-anything/README.md)。
- 源码新实例默认启用 notes＋todos planner v2。旧实例可继续使用原配置；启用 planner v2 需要新的空目录。三个插件使用 DSH 0.2.2-rc.3、Node.js ≥24.9.0。

## 本轮验证

- 两包独立锁合计减少 45 项生产依赖记录（notes 32 项、todos 13 项）。保留依赖的解析版本与完整性摘要一致。
- 已执行 notes 61 项和 todos 37 项 Node 测试，包含包外生产安装和真实 DSH 启动。notes 的真实 restic 恢复测试、工具链 19 项、启动器 4 项均通过。

- 真实 DSH 的 notes Files.md、classic 与语言切换，以及 todos planner／v1 浏览器回归均通过。检查了 330 个仓库内 Markdown 链接，并复核最终两份安装包的文档相对链接和归档内容。

## 历史与验收

- 文档索引提供当前入口。[文档索引](README.md)
- 历次交接保留了导师真实 DSH mock 端到端流程、SQLite 恢复、旧包生产安装、浏览器回归和发布记录。[历史交接](history/HANDOFF-through-2026-11-18.md)
- 真实模型、物理手机、目标部署及整实例恢复仍需各自的验收证据。旧阶段规划与目录见 [历史索引](history/README.md)。
