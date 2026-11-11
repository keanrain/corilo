# 开发与仓库导航

v0.34 · 2026-11-11。此页命令描述现有运行代码，任务／日程方案不自动改变安装与启动行为。产品规则见 [PRODUCT-SPEC.md](PRODUCT-SPEC.md)，架构边界见 [TECHNICAL_DESIGN.md](TECHNICAL_DESIGN.md)。本页只维护目录、命令与分发约定；命令均在仓库根目录执行。

## 目录职责

| 位置 | 当前用途 |
|---|---|
| [plugins/](../plugins/README.md) | 当前工作区包／基础待办与后续日程扩展包；各自包含宿主服务、客户端、CLI、构建与测试 |
| [launcher/corilo.mjs](../launcher/corilo.mjs)、`launcher/test/` | 源码单工作区启动及旧双插件兼容验收 |
| [deploy/systemd/](../deploy/systemd/corilo.service.example) | 手工部署参考，不随初始化自动安装 |
| [scripts/](../scripts/README.md) | 设计资产生成、历史开发工具；`scripts/corilo.mjs` 只兼容转发至新入口 |
| `docs/`、`docs/history/` | 当前设计／开发文档与不可混用的历史记录 |
| `app/host/`、`app/cloud/`、`app/vendor/` | 保留的本机 Pi／云端服务与固定 vendor；根 npm 依赖用于这套应用 |
| `android/`、`prototype/`、`p0/` | 暂停的工程、原型和历史验收证据 |

实例目录必须在仓库之外。不要提交用户笔记、SQLite、运行 home、token、模型密钥或真实测试资料；保留已有旧应用数据，不自动迁移。

## 运行时与锁文件

当前插件和源码组合入口需要 **Node.js ≥24.9.0**（Git 仅供旧存量恢复工具使用）；旧待办和迁移工具使用 Node 原生 SQLite。根 `package.json` 的 `engines >=22.19.0` 是保留的旧应用约定，不能据此用 Node 22 启动当前插件。根命令是便捷入口，不代表所有命令拥有同一运行时要求。

仓库保留三个 npm 锁文件：

- 根 `package-lock.json` 固定旧应用 Pi／云端依赖，不参与当前插件发布。
- `plugins/notes/package-lock.json` 固定笔记包运行／构建／测试依赖。
- `plugins/todos/package-lock.json` 固定待办包运行／构建／测试依赖。

两包必须可在仓库外仅装生产依赖运行，因此不改为 npm workspace 或依赖根目录 hoist。安装、构建与升级分别在包目录操作；不单独升级 Harness 运行时或依据 `latest` 猜兼容版本。固定 Harness 为 `0.2.2-rc.1`。

## 当前命令

| 目的 | 命令 | 边界 |
|---|---|---|
| 安装并构建工作区 | `npm run setup:corilo` | 使用工作区锁文件，忽略安装脚本后显式构建；不启动服务，不需先装根依赖 |
| 初始化组合实例 | `npm run init:corilo -- --directory /absolute/corilo-instance` | 独占创建单工作区配置，不覆盖或迁移 |
| 只读预检 | `npm run check:corilo -- --directory /absolute/corilo-instance` | 不创建资料、原生 home 或数据库；不代替启动时 SQLite schema 检查 |
| 启动组合实例 | `npm run start:corilo -- --directory /absolute/corilo-instance` | 委托原生 Harness；默认回环 `3000`，可追加 `--port` |
| 笔记服务／真实宿主／分发测试 | `npm run test:notes` | 包内 `npm test` 自动构建 |
| 待办服务／真实宿主／分发测试 | `npm run test:todos` | 包内 `npm test` 自动构建 |
| 源码组合启动测试 | `npm run test:startup` | 使用 `launcher/test/cli.test.mjs`，新工作区只需 notes；旧双插件兼容用例还需 todos |

统一实例不自动接管已有独立插件实例。配置使用绝对入口路径，移动 checkout 前保留原配置与安装；独立包路径切换／回退参考[笔记指南](../plugins/notes/QUICKSTART.zh-CN.md)和[待办 README](../plugins/todos/README.md)。入口只接受固定单工作区或旧双插件配置，不执行任意 overlay 或自动迁移。

## 浏览器与分发检查

当前默认浏览器验收为 plugins/notes/test/workspace_browser.py，旧 core_browser.py 只保护 interface: classic。新页面应在真实发布版 Harness 中验证，不能用旧应用浏览器脚本替代。Python 浏览器环境按 `requirements-dev.txt` 安装并准备 Playwright Chromium；可用脚本与准确运行方法分别见[笔记 README](../plugins/notes/README.md)、[待办 README](../plugins/todos/README.md)及两份插件 CI。使用隔离 home、临时合成资料，不调用真实模型；记录实际通过的流程与未验收设备。

变更共享入口时运行 `test:startup`；变更插件按范围运行对应 Node／真实宿主／浏览器检查。修改文件接口或 UI 还需按 AGENTS 保护旧应用的三套浏览器回归。普通文档调整检查本地链接及命令路径即可，不把未运行检查写作通过。

两包可独立 `npm pack`，不发布整个仓库或 launcher。在仓库根目录执行下面的包内容检查（先按上文完成安装／构建）：

```sh
(cd plugins/notes && npm pack --dry-run)
(cd plugins/todos && npm pack --dry-run)
```

`prepack` 构建客户端；固定运行依赖、许可证与指南应随包，不含测试资料、node_modules 或凭据。仓库外生产安装／启动验证由各包分发测试覆盖。当前两包均为 `private`，没有执行公开 `npm publish`；发布操作与取消 private 不属于仓库整理。

## 独立 DSH 安装与升级演练

已有两个不同构建的 Files.md 工作区包时，可运行：

```sh
npm_config_cache=/workspace/work/npm-cache node plugins/notes/test/upgrade.mjs /absolute/previous.tgz /absolute/next.tgz
```

脚本先在临时目录用 --save-exact 仅安装固定 DSH 0.2.2-rc.1 并实际启动，再安装旧包、通过鉴权 API 写入合成资料，停止服务、安装新包并重启。检查既有 overlay 字节不变、旧资料保留、服务返回的 host.js 与新安装文件完全一致且哈希改变、未认证请求为 401、SIGTERM 正常退出。它从独立 DSH 的原生入口启动，不依赖源码 launcher。两个包须已包含构建资源；可以是同版本的不同本地构建，不能把这种演练写成 npm 公开版本升级。

整个演练使用可丢弃实例并在结束后清理，输出只有包版本、哈希和检查结果；不会替用户升级真实实例。目标用户 DSH 的路径、overlay 和部署环境仍须单独核对。真实浏览器行为继续由 workspace_browser.py 验收，HTTP 资源检查不等于第二实例浏览器验收。

## 保留的旧应用命令

这些命令继续维护已有应用，不是当前插件入口。先用根 `npm ci --ignore-scripts` 安装旧应用依赖。

| 目的 | 命令 | 边界 |
|---|---|---|
| 旧本机应用 | `npm start` | `app/host/cli.mjs`；Node ≥22.19.0，不加载当前插件 |
| 旧 Node 回归 | `npm test` | `app/tests/*.test.mjs`，不含插件测试 |
| 旧浏览器回归 | `python3 app/tests/browser_smoke.py`、`python3 app/tests/browser_review.py`、`python3 app/tests/browser_sync.py` | 仅证明旧应用 |
| 旧云端文件服务 | `npm run start:cloud` | 先读 [cloud README](../app/cloud/README.md)；云端 AI 提交仍关闭 |
| 旧控制器 | `npm run start:controller` | 只恢复已有任务，不开放新执行 |
| 旧云端／worker 检查 | `npm run test:cloud`、`npm run test:worker` | 仅可丢弃 `CORILO_TEST_DATABASE_URL`；worker 另需真实镜像 |

完整旧启动、GitHub 同步、原型和导出说明见[旧应用档案](history/LEGACY-APP.md)，当时架构与数据库测试证据见 [v0.16 技术档案](history/TECHNICAL-DESIGN-v0.16.md)。不要用历史“下一步”扩展当前范围。
