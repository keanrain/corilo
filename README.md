# Corilo 可里

**设计更新 v0.34：** 下一阶段恢复独立任务与日程插件，采用 notes＋todos，并保留 Files.md 菜单。[产品方案](docs/PRODUCT.md)与[技术方案](docs/TECHNICAL_DESIGN.md)已写入仓库；以下安装说明描述当前可运行代码，日期、日历和提醒仍待开发。

运行在 **DeepSeek Harness** 中的 Files.md 工作区：笔记、待办清单、日记和附件都保存在自己的设备，既能直接操作，也能交给原生 Agent。

当前主包 **`@corilo/dsh-notes` 0.7.0** 完整移植 Files.md 前端，保留其菜单和交互；新实例只加载这一个插件。普通编辑、勾选、收集与日记不用模型。Harness 负责模型、会话、登录和权限，不运行旧 Pi、Telegram Bot 或另一套同步服务。

## 三步启动

需要 Node.js ≥24.9.0。在仓库根执行，实例路径使用仓库外的绝对路径：

```sh
npm run setup:corilo
npm run init:corilo -- --directory /absolute/corilo-instance
npm run start:corilo -- --directory /absolute/corilo-instance
```

`setup` 只安装并构建工作区包。`init` 只创建配置，不覆盖或迁移已有实例；以后直接 `start`。使用 Harness 打印的鉴权地址，关闭模型配置引导后点击侧栏“笔记”。默认回环端口 3000，Ctrl+C 停止；预检使用 `npm run check:corilo -- --directory /absolute/corilo-instance`。

界面保留 Files.md 原生文件树、新建、查找、标题内改名、移动／归档、分栏、收集、日记和 Markdown 清单。Agent 按钮先保存当前输入，再切到 Harness 会话；返回时保留编辑区。文件由小主机统一保存，其他电脑／手机通过浏览器访问，不需要每台设备选择本地文件夹。

## 旧实例与待办

旧双插件配置和 `plugins/todos` 0.5.2 保留，后续任务／日程在此扩展，不自动改写配置或删除 SQLite。Files.md 仍支持 Markdown 清单；下面是可选单向导出，不再是默认退役流程：

```sh
# 先停止源、目标服务并备份；默认仅预览
node plugins/notes/import-todos.mjs --source /absolute/old/todos/todos.sqlite --root /absolute/corilo-instance/notes
# 核对预览后执行
node plugins/notes/import-todos.mjs --source /absolute/old/todos/todos.sqlite --root /absolute/corilo-instance/notes --apply
```

导入保留原 SQLite，已完成／未完成转为清单，取消记录及原字段保存在 archive/ 的迁移记录中；重试不会重复追加。仅在用户明确选择以后使用 Markdown 管理这些事项时，才考虑移除旧入口；继续使用独立任务的用户保留原 SQLite 与插件。原文清单与数据库不自动同步。[完整说明](plugins/notes/README.md)。

## 分发与边界

插件可独立打包，不需要旧 app/：进入 `plugins/notes` 执行 `npm pack`，收到包的人只需安装生产依赖并初始化。包仍为 private，尚未公开发布 npm。[快速开始](plugins/notes/QUICKSTART.zh-CN.md)。

Files.md 固定为源码记录中的版本，Harness 固定 `0.2.2-rc.1`。当前真实 Harness／Chromium 与迁移验收不代表真实 DeepSeek、物理手机、原生输入法／WebKit、麦克风、目标 Linux 常驻部署或 NAS 已验收。没有可靠提醒或自动记忆；NAS 先做备份，未经验证的 SMB/NFS 不作为工作盘。

目录保持：`plugins/notes` 当前工作区包，`plugins/todos` 当前基础待办及后续日程扩展，`launcher/` 源码入口，`docs/` 当前文档与归档。旧 app/、Android、原型与用户数据保留，根 `npm start/test` 仍运行旧应用。

[设计索引](docs/README.md) · [业务规则](docs/PRODUCT-SPEC.md) · [架构](docs/TECHNICAL_DESIGN.md) · [开发指南](docs/DEVELOPMENT.md) · [插件导航](plugins/README.md)
