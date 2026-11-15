# Corilo 插件

v0.34 设计恢复独立任务与日程；当前运行版本及启动命令尚未变化，新增能力见[产品方案](../docs/PRODUCT.md)与[技术方案](../docs/TECHNICAL_DESIGN.md)。

| 目录 | 包 | 状态 |
|---|---|---|
| [notes/](notes/README.md) | `@corilo/dsh-notes` 0.7.0 | 当前 Files.md 工作区，笔记／清单／待办／日记＋原生 Agent |
| [todos/](todos/README.md) | `@corilo/dsh-todos` 0.5.2 | 基础 SQLite 待办，后续日程扩展基础；当前新配置尚未默认加载 |

工作区包拥有独立依赖、构建、客户端、文件服务、迁移命令与许可，在仓库外安装生产依赖即可运行。Files.md 原生前端固定来源随包分发，运行时适配文件和 Agent，不依赖旧 app/。

[根目录三步](../README.md#三步启动)现在只安装／加载工作区。旧双插件配置继续可启动，需要相应旧依赖；没有自动迁移、删除数据库或改写配置。SQLite → Markdown 工具只作为可选导出，不再建议默认退役插件；使用时先停服务、备份并显式执行。未来任务新库升级另行实现，不能混用这两个方向。

根依赖仍用于旧应用；launcher/ 只是源码启动入口，不是第三个发行包。不引入 npm workspace 或另一套 Agent／同步服务。包保持 private，未发布 npm。打包需进入对应包目录执行 npm pack，不能发布整个仓库；测试、node_modules、截图和真实资料不进入包。

开发与验收见 [开发指南](../docs/DEVELOPMENT.md)。旧包的独立安装／测试仍有效，不以旧 UI 测试代表当前 Files.md 工作区已验收。
