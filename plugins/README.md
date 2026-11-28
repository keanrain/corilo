# Corilo 插件

**简体中文** | [English](README.en.md)

当前源码组合为 notes＋todos planner v2，运行在固定 DSH 0.2.2-rc.5 上。[学习导师](../packages/learn-anything/README.md) 是大仓中的另一个独立插件，仅供已有 DSH 用户安装，不加入默认组合。

| 目录 | 包 | 状态 |
|---|---|---|
| [notes/](notes/README.md) | `@corilo/dsh-notes` | 当前 Files.md 工作区，笔记／Markdown 清单／日记＋原生 Agent |
| [todos/](todos/README.md) | `@corilo/dsh-todos` | SQLite 任务／日程、时间块与提醒；新配置默认启用 planner v2，保留 v1 兼容模式 |

工作区包拥有独立依赖、构建、客户端、文件服务、迁移命令与许可，在仓库外安装生产依赖即可运行。Files.md 原生前端固定来源随包分发，运行时适配文件和 Agent，不依赖旧 app/。

[根目录三步](../README.zh-CN.md#三步启动)安装／构建两包，新实例加载双插件 planner。已有单插件／v1 双插件配置继续按原模式启动；没有自动迁移、删除数据库或改写配置。SQLite → Markdown 工具只作为可选导出，不再建议默认退役插件；使用时先停服务、备份并显式执行。planner 需要新的空资料目录，旧库升级工具尚未实现，不能混用这两个方向。

根依赖仍用于旧应用；launcher/ 只是源码启动入口，不是第三个发行包。不引入 npm workspace 或另一套 Agent／同步服务。包保持 private，未发布 npm。打包需进入对应包目录执行 npm pack，不能发布整个仓库；测试、node_modules、截图和真实资料不进入包。

开发与验收见 [开发指南](../docs/DEVELOPMENT.md)。旧包的独立安装／测试仍有效，不以旧 UI 测试代表当前 Files.md 工作区已验收。
