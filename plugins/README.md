# 可独立分发的 Corilo 插件

| 目录 | npm 包名 | 主要职责 |
|---|---|---|
| [notes/](notes/README.md) | `@corilo/dsh-notes` | Markdown 笔记、直接原话保存、历史及回收站 |
| [todos/](todos/README.md) | `@corilo/dsh-todos` | SQLite 个人待办、状态流转、持久幂等保护 |

每个目录是独立 npm 包，自己的 package.json、package-lock.json、Host、client、构建和测试都放在包内。两个插件均可通过固定版本 Harness 的公开扩展点独立加载；页面与 Agent 工具共用本包业务服务。

## 边界

- 插件目录保持稳定，现有 Harness overlay 记录其绝对入口；整理仓库不移动它们或迁移实例资料。
- 不依赖仓库根的旧应用依赖，也不从另一个包相对导入源码。构建工具保持包内可执行，独立 tarball 使用者不需要整个 Corilo 仓库。
- 根目录和 [launcher/](../launcher/README.md) 是源码开发/组合启动入口，当前不是第三个 npm 发行包。资料和原生凭据放在用户选择的仓库外实例。
- 根锁文件服务旧应用兼容；两个插件各自的锁文件固定各自安装。当前不用 npm workspaces 强行合并，也不因为少量构建代码相似就增加共享运行依赖。
- Astryx token 副本由 [vendor-astryx.mjs](../scripts/vendor-astryx.mjs) 从固定来源生成，各自随客户端构建内联；第三方许可分别随包分发。

## 安装、检查和打包

两个插件一起使用，按[根目录三步上手](../README.md#一起使用笔记和待办)。独立运行方式见上表中的包 README。

在仓库根执行对应的 `npm run test:notes` / `npm run test:todos`。打包前进入目标插件目录，再执行 `npm pack --dry-run` 查看分发清单；不要在仓库根尝试发布。

目前两包仍为 `private: true`，未因为仓库整理而开放发布。公开发布前确认 npm scope 权限、包名及不可重复的版本号，并单独调整包的发布配置。各包 `files` 是发行边界：业务源码、构建客户端、说明和许可会分发，测试、node_modules、截图和真实资料不属于发行内容。具体开发检查见 [开发指南](../docs/DEVELOPMENT.md)。
