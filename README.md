# Corilo 可里

基于 **DeepSeek Harness** 的个人笔记与待办插件：简单记录、查找与完成事情，资料保存在自己的设备并可带走。首期面向 Linux 小主机／常开电脑，复用 Harness 的网页、会话、模型设置与默认工具。

当前专注核心笔记和待办。日期、日程、提醒、笔记联动与自动记忆暂缓；不要求 Supabase、Corilo 账号或 GitHub 绑定。

## 一起使用笔记和待办

需要 Node.js ≥24.9.0、Git ≥2.36。在仓库根目录执行下面三步，实例目录选在**仓库之外**，使用绝对路径：

```sh
npm run setup:corilo
npm run init:corilo -- --directory /absolute/corilo-instance
npm run start:corilo -- --directory /absolute/corilo-instance
```

`setup` 按两个插件各自的锁文件安装依赖并构建；`init` 只需一次，独占生成配置，不覆盖或迁移已有实例；以后只需 `start`。打开终端打印的鉴权地址，关闭 Harness 模型密钥引导即可直接记笔记与待办，核心操作不用模型。Ctrl+C 停止。

默认监听回环地址、固定端口 `3000`，可为 `start` 添加 `--port 其他端口`。排错用 `npm run check:corilo -- --directory /absolute/corilo-instance`；检查不创建资料目录、原生 home 或待办数据库，数据库 schema 在实际启动时校验。旧独立实例继续按各插件指南管理，统一入口不自动接管；源码路径改变后需核对配置，详见[开发指南](docs/DEVELOPMENT.md)。

## 当前功能

| 插件 | 核心体验 | 次级能力 |
|---|---|---|
| [笔记](plugins/notes/README.md) v0.2.5 | Markdown 阅读编辑、分页查找与正文搜索、零模型原话保存、冲突保留草稿 | 浏览器持久草稿、Git 历史／回收站、restic 笔记备份恢复 |
| [待办](plugins/todos/README.md) v0.2.2 | 快速连续新增、直接完成／撤销、刷新恢复草稿 | 编辑／取消、版本与幂等保护、JSON 导出 |

页面与 Agent 工具共用各插件业务服务。视觉复用 Astryx Neutral 0.7.11 静态 token，使用宿主 React；不是 Astryx React 组件集成。

## 仓库与分发

```text
plugins/notes/      独立笔记 npm 包、客户端、服务与测试
plugins/todos/      独立待办 npm 包、客户端、服务与测试
launcher/          源码组合启动器与启动验收
deploy/systemd/   统一用户服务示例（不自动安装）
scripts/          开发工具、历史脚本及旧入口兼容转发
docs/             当前产品／架构／开发文档与历史档案
app/              保留的旧本机／云端应用与 vendor
android/ prototype/ p0/   保留的历史工程与证据
```

两个插件独立安装、构建、打包，不依赖根应用发布；安装与 tarball 分发入口见[插件导航](plugins/README.md)。当前 npm 包仍为 `private`，尚未公开发布 npm。本仓库统一启动器用于源码组合使用，不是第三个已发布包。

实例与源码分开：`notes/` 存正文，`state/` 存笔记历史，`todos/` 存 SQLite；`runtime/{harness,agents}` 存 Harness 原生配置／会话，`workspace/` 为默认工具工作目录。整个实例包含敏感状态，不能当作无凭据的资料导出。

## 使用边界

Harness 固定为开发者预览版 `0.2.2-rc.1`，升级须验证兼容性。插件版本保护只协调各自服务，默认文件／bash 工具及外部编辑器不受其队列约束，也不是多租户隔离边界。

真实发布版 Harness、Chromium 核心流程与独立包生产安装已有验收；物理手机／原生输入法／WebKit、真实 DeepSeek、远程部署、设备开机自启及 NAS 尚未验收。NAS 先作备份方向，未验证 SMB/NFS 或双向同步目录为工作目录。笔记级 restic 恢复不等于完整实例备份。

Linux 常驻可审阅[统一 systemd 用户服务示例](deploy/systemd/corilo.service.example)，替换绝对路径后按[Linux 指南](plugins/notes/LINUX.zh-CN.md)管理，将服务名改为 `corilo.service` 并采用统一入口；原生 home 由启动器固定。示例不配置远程监听，也不自动安装或启用。

## 文档入口

[设计索引](docs/README.md) · [当前业务规则](docs/PRODUCT-SPEC.md) · [当前架构](docs/TECHNICAL_DESIGN.md) · [开发与检查](docs/DEVELOPMENT.md) · [开发脚本](scripts/README.md)

`npm start` 与 `npm test` 仍分别运行旧本机应用及旧测试；旧代码和资料保留，不自动迁移。迁移前完整运行说明见[旧应用档案](docs/history/LEGACY-APP.md)。
