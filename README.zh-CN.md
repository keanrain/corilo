# Corilo 可里

[English](README.md) | **简体中文**

> 运行时：notes／todos 和独立学习导师固定使用 DSH **0.2.2-rc.3**，请按各包锁文件安装，不依赖 npm 标签。

## 大仓中的独立产品

| 目录 | 产品 | 开发入口 |
|---|---|---|
| `plugins/notes` | 笔记工作区 `@corilo/dsh-notes` | `npm run test:notes` |
| `plugins/todos` | 任务与日程 `@corilo/dsh-todos` | `npm run test:todos` |
| [`packages/learn-anything`](packages/learn-anything/README.md) | 独立学习导师 `@corilo/learn-anything` | `npm run setup:learn-anything`、`npm run test:learn-anything` |

各包独立依赖锁、安装和分发。学习导师仅供已有 DSH 用户安装，通过 `npm run build:learn-anything` 构建、`npm run pack:learn-anything` 打包，不随默认 notes＋todos 组合自动启用。`app/`、`android/`、`p0/` 保留旧实现与研究；根 `npm start/test` 仍服务旧应用。

源码新实例默认启用 notes＋todos planner v2；已有单插件或旧双插件配置按原模式运行，数据库不自动迁移。

笔记使用 Files.md 工作区，保留文件树、Markdown、清单、日记、附件和分栏编辑。任务插件提供任务日期、清单、优先级、日历、时间块、持久提醒和主动授权网页通知。普通页面操作不需要模型；Harness 负责模型、会话、登录和权限。

Corilo 自有界面跟随 DSH 的语言设置，支持中文与 English；切换语言不改变笔记、任务内容或导师作答。Files.md 上游界面和导师教学材料保持原有内容。

## 三步启动

需要 Node.js ≥24.9.0。在仓库根执行，实例路径使用仓库外的绝对路径：

```sh
npm run setup:corilo
npm run init:corilo -- --directory /absolute/corilo-instance
npm run start:corilo -- --directory /absolute/corilo-instance
```

`setup` 安装并构建 notes 和 todos。`init` 只创建配置，不覆盖或迁移已有实例；以后直接 `start`。使用 Harness 打印的鉴权地址，关闭模型配置引导后使用侧栏的笔记和任务／日程入口。默认回环端口 3000，Ctrl+C 停止；预检使用 `npm run check:corilo -- --directory /absolute/corilo-instance`。

## 旧实例与待办

省略 `planner` 的待办实例继续使用 v1。启用 planner v2 需要新的空资料目录。需要把旧任务单向导出为 Markdown 清单时，先停服备份，再使用包内指南的只读预览和显式导入步骤。导出保留原 SQLite，清单和数据库各自保存。[待办指南](plugins/todos/README.md) · [导出步骤](plugins/notes/README.zh-CN.md#已有安装与-sqlite-待办)

## 分发与边界

三包分别提供 GitHub 预发布和独立的本地打包命令。版本、校验和及安装方式见 [分发指南](docs/RELEASING.md) 和 [GitHub Releases](https://github.com/keanrain/corilo/releases)。

提醒持久保存，关闭页面后停止网页递送。重复任务、CalDAV／ICS、外部通知和自动记忆尚未交付。部署与测试范围见 [产品说明](docs/PRODUCT.md) 和 [交接](docs/HANDOFF.md)。

[设计索引](docs/README.md) · [业务规则](docs/PRODUCT-SPEC.md) · [架构](docs/TECHNICAL_DESIGN.md) · [开发指南](docs/DEVELOPMENT.md) · [插件导航](plugins/README.md)
