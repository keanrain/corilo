# Corilo 可里

> 运行时更新：notes／todos 和独立学习导师固定使用 DSH **0.2.2-rc.3**。此版本当前在 npm `next` 标签，`latest` 仍为 rc.1；请按锁文件安装。Python 原型及其专用启动、CI 已移除，本地数据保留。

## 大仓中的独立产品

| 目录 | 产品 | 开发入口 |
|---|---|---|
| `plugins/notes` | 笔记工作区 `@corilo/dsh-notes` | `npm run test:notes` |
| `plugins/todos` | 任务与日程 `@corilo/dsh-todos` | `npm run test:todos` |
| [`packages/learn-anything`](packages/learn-anything/README.md) | 独立学习导师 `@corilo/learn-anything` | `npm run setup:learn-anything`、`npm run test:learn-anything` |

各包独立依赖锁、安装和分发。学习导师仅供已有 DSH 用户安装，通过 `npm run build:learn-anything` 构建、`npm run pack:learn-anything` 打包，不随默认 notes＋todos 组合自动启用。`app/`、`android/`、`p0/` 保留旧实现与研究；根 `npm start/test` 仍服务旧应用。

当前版本为 **notes 0.7.0、todos 0.6.1**。源码新实例默认启用 notes＋todos planner v2；已有单插件或旧双插件配置按原模式运行，数据库不自动迁移。

笔记使用 Files.md 工作区，保留文件树、Markdown、清单、收集、日记、附件和分栏编辑。任务插件提供任务日期、清单、优先级、日历、时间块、持久提醒和主动授权网页通知。普通页面操作不需要模型；Harness 负责模型、会话、登录和权限。

## 三步启动

需要 Node.js ≥24.9.0。在仓库根执行，实例路径使用仓库外的绝对路径：

```sh
npm run setup:corilo
npm run init:corilo -- --directory /absolute/corilo-instance
npm run start:corilo -- --directory /absolute/corilo-instance
```

`setup` 安装并构建 notes 和 todos。`init` 只创建配置，不覆盖或迁移已有实例；以后直接 `start`。使用 Harness 打印的鉴权地址，关闭模型配置引导后使用侧栏的笔记和任务／日程入口。默认回环端口 3000，Ctrl+C 停止；预检使用 `npm run check:corilo -- --directory /absolute/corilo-instance`。

界面保留 Files.md 原生文件树、新建、查找、标题内改名、移动／归档、分栏、收集、日记和 Markdown 清单。Agent 按钮先保存当前输入，再切到 Harness 会话；返回时保留编辑区。文件由小主机统一保存，其他电脑／手机通过浏览器访问，不需要每台设备选择本地文件夹。

## 旧实例与待办

旧单插件及双插件配置保留。todos 0.6.1 在省略 `planner` 时继续使用 v1 模式；启用 planner 必须使用新的空资料目录，不能直接打开旧 v1 库。Files.md 仍支持 Markdown 清单；下面是可选单向导出，不再是默认退役流程：

```sh
# 先停止源、目标服务并备份；默认仅预览
node plugins/notes/import-todos.mjs --source /absolute/old/todos/todos.sqlite --root /absolute/corilo-instance/notes
# 核对预览后执行
node plugins/notes/import-todos.mjs --source /absolute/old/todos/todos.sqlite --root /absolute/corilo-instance/notes --apply
```

导入保留原 SQLite，已完成／未完成转为清单，取消记录及原字段保存在 archive/ 的迁移记录中；重试不会重复追加。仅在用户明确选择以后使用 Markdown 管理这些事项时，才考虑移除旧入口；继续使用独立任务的用户保留原 SQLite 与插件。原文清单与数据库不自动同步。[完整说明](plugins/notes/README.md)。

## 分发与边界

notes 和 todos 可分别在各自目录执行 `npm pack`，不需要旧 app/；收到包的人按各包指南安装生产依赖及配置。两包仍为 private，尚未公开发布 npm。[快速开始](plugins/notes/QUICKSTART.zh-CN.md)。

Files.md 固定为源码记录中的版本，Harness 固定 `0.2.2-rc.3`。当前真实 Harness／Chromium 与迁移验收不代表真实 DeepSeek、物理手机、原生输入法／WebKit、麦克风、目标 Linux 常驻部署或 NAS 已验收。提醒由 todos 持久保存，关闭页面不推送；重复、CalDAV／ICS、外部通知和自动记忆未实现。NAS 先做备份，未经验证的 SMB/NFS 不作为工作盘。

目录保持：`plugins/notes` 当前工作区包，`plugins/todos` 当前任务与日程包，`launcher/` 源码入口，`docs/` 当前文档与归档。旧 app/、Android 与用户数据保留，根 `npm start/test` 仍运行旧应用。

[设计索引](docs/README.md) · [业务规则](docs/PRODUCT-SPEC.md) · [架构](docs/TECHNICAL_DESIGN.md) · [开发指南](docs/DEVELOPMENT.md) · [插件导航](plugins/README.md)
