# Corilo 可里交接文档

2026-11-11（Asia/Taipei）快照，供下一位 agent 直接接手。本文件记录交接状态；业务规则仍以 [PRODUCT-SPEC.md](PRODUCT-SPEC.md) 为唯一来源。先读仓库 [AGENTS.md](../AGENTS.md) 和 [设计索引](README.md)，再读当前产品、交互与技术设计。

## 1. 仓库与授权

| 项目 | 当前状态 |
|---|---|
| 仓库目录 | `/workspace/corilo` |
| 分支 | `feat/cloud-notes` |
| 远端 | `https://github.com/keanrain/corilo.git` |
| 功能代码基线 | `40b16fb`，已推送；交接文档自身另有后续提交 |
| 当前主包 | `@corilo/dsh-notes` **0.7.0** |
| 旧待办包 | `@corilo/dsh-todos` **0.5.2**，存量兼容 |
| 当前规格 | **v0.33** |
| 工作区 | 开始编写本文前干净；接手时以 `git status`、`git log` 为准 |

用户希望持续推进、少停下来确认；已授权在开发分支提交并推送。继续使用现有 checkout，不擅自创建 worktree，不 force-push。没有授权部署、公开 npm 发布、开通付费／外部服务或发送通知。保留现有资料、凭据、配置及其他人的改动。测试使用合成数据，不能输出真实 token、密钥或笔记。

## 2. 最新产品决定：不要退回旧路线

用户原先要求两个插件只保留核心功能，随后明确改变方向：

> 完整移植 Files.md 前端，先保留它自己的菜单和功能，裁剪后面再说；机器人能力使用 Harness Agent；独立待办插件收敛到统一工作区。

因此当前采用 **DeepSeek Harness 主体＋Files.md 工作区插件**。不要再依据 v0.32 的极简页面规则删除 Files.md 菜单，也不需要重新讨论已经确定的底座。

- 新实例只加载一个工作区插件，笔记、清单、待办、收集、日记统一使用普通文件。
- Harness 提供原生会话、Agent、模型设置、鉴权和权限；不重写 Agent loop，不恢复旧 Pi 主运行链路。
- 普通编辑、勾选、收集、日记不调用模型。Agent 仅在用户明确要求时操作同一份资料。
- 首个部署目标是 Linux 小主机／常开电脑，其他电脑和手机通过浏览器访问同一服务；具体硬件、发行版和远程访问方式尚未确定。
- NAS 先作备份，不把未经验证的 SMB/NFS 或双向同步目录作为工作盘。
- 不要求 Supabase、Corilo 官方账号或 GitHub 绑定。
- 可靠提醒、日期调度、通知渠道及自动记忆并未因为这次移植而交付。

Files.md 的原生 chat 是 `Chat.md` 收集界面；Harness 会话才是模型对话。两者不要混淆。Go 同步、托管 Files.md API、Telegram Bot 和旧 Pi 均未接入当前运行链路；PWA Service Worker／浏览器离线副本也没有接入。这里的“完整移植”指固定版本的前端及菜单和可用主机文件交互，不代表开通原项目全部外部服务或通过全部设备能力验收。

## 3. 当前架构与关键文件

```text
浏览器 → 固定 Harness Web
          ├─ 原生会话／Agent／模型设置／认证／权限
          └─ @corilo/dsh-notes 0.7.0
               ├─ Files.md iframe → 鉴权 Fetch API → WorkspaceStore
               └─ corilo_notes_* 工具 → NotesStore
                                            ↓
                                   同一服务队列／主机目录
```

| 位置 | 职责 |
|---|---|
| [plugins/notes/index.mjs](../plugins/notes/index.mjs) | 宿主插件配置、八个 Agent 工具、服务及路由注册 |
| [workspace-store.mjs](../plugins/notes/workspace-store.mjs) | 目录、附件、设置、版本化写入、移动和删除；复用 NotesStore 队列 |
| [storage.mjs](../plugins/notes/storage.mjs) | 原 Markdown 文件服务；Agent 与工作区共享文件版本 |
| [workspace-api.mjs](../plugins/notes/workspace-api.mjs) | Harness 精确鉴权路由、静态资源及校验式运行时转换 |
| [workspace/adapter.js](../plugins/notes/workspace/adapter.js) | 将 Files.md FileSystemHandle 接口适配为主机 HTTP 操作 |
| [workspace/host.js](../plugins/notes/workspace/host.js) | 保存、导航、组字、冲突／未知结果、原生 Agent 入口 |
| [workspace/host.css](../plugins/notes/workspace/host.css) | 主机状态／Agent 条及布局空间适配 |
| [client/workspace.jsx](../plugins/notes/client/workspace.jsx) | 持续挂载 iframe、原生面板导航、来源校验、未保存提醒 |
| [import-todos.mjs](../plugins/notes/import-todos.mjs) | 只读 SQLite 预览及显式迁移，随独立包提供 CLI |
| [vendor/filesmd/SOURCE.json](../plugins/notes/vendor/filesmd/SOURCE.json) | 固定来源、逐文件 SHA-256 和集成说明 |
| [launcher/corilo.mjs](../launcher/corilo.mjs) | 新单插件配置、旧双插件兼容、启动和只读预检 |

Files.md 上游：`https://github.com/zakirullin/files.md`，固定 commit **`9e948ba6071e320c41c866f92817cf96f9bb7ba6`**。`vendor/filesmd/web/` 原文保持不变，含原生 HTML／JS／CSS、CodeMirror 5／HyperMD、资源和许可。不要直接修改 vendor 掩盖回归；适配通过校验式运行时转换完成。`.gitattributes` 保持其原始字节，测试检查哈希。MIT 及各第三方许可随包分发。

iframe 是独立文档，避免全局样式和原生 JS 污染 Harness。它持续挂载，面板切换只显隐，因此返回时保留编辑状态。消息只接受同源且来源为该 iframe 的事件。Agent 入口调用 Harness 的 `layout.selectPanel(null)`，没有第二套聊天、模型配置或 token 系统。

旧 React／CodeMirror 6／Astryx 笔记页仍在同一包内，通过 **`interface: classic`** 显式启用；CLI 检查和 rebind 保留该选项。它只是兼容路径，不能用其截图或浏览器测试代表新工作区。

## 4. 文件、工具与可靠性边界

- `Chat.md`：直接收集；`Later.md`：Markdown 待办；`journal/`：日记；`media/`：附件；`config.json`：Files.md 设置。
- 仍有八个工具：`corilo_notes_list/browse/search/read/create/save/rename/capture`。工具名称稳定，保存描述说明个人待办和日记的 Markdown 约定。
- 页面与工具共用 NotesStore 及队列。内容 SHA-256 来自实际读取，陈旧写入拒绝；目录移动／删除也校验后代版本。
- 保存失败不标记干净、不自动覆盖；冲突核对、明确采用文件或保存副本。未知写入先只读核对，不盲目重发。收集丢响应也阻止重复发送，改名丢响应可核对新路径。
- 组字时不提交当前编辑器；提交回执只确认快照；保存副本检查提交期间的新输入。关闭未保存页面会提醒，不承诺刷新／崩溃恢复。
- 正文／设置 1 MiB，附件 16 MiB；单目录累计文件读取 64 MiB；扫描／目录版本最多 20000 项、20 层、10 秒预算。
- 拒绝路径穿越、隐藏路径、软／硬链接及特殊文件；移动目标存在时不覆盖；不安全目录操作拒绝。
- 外部图片／音视频不自动请求，本地附件正常使用；已有组合 Unicode 文件名按主机原形读写，不静默正规化为另一个文件。
- 队列只协调本服务。默认 shell／文件工具和任意外部编辑器不在其跨进程事务范围内；root 不是整个 Harness 的安全沙箱。

## 5. 安装与运行

固定 **Node.js >=24.9.0**、**Harness 0.2.2-rc.1**。Harness 是开发者预览版，不能单独升级后猜插件兼容性；不要使用 npm latest 推断版本。

仓库根目录的新实例三步：

```sh
npm run setup:corilo
npm run init:corilo -- --directory /absolute/corilo-instance
npm run start:corilo -- --directory /absolute/corilo-instance
```

`setup` 现在只安装／构建 notes 工作区包；新 init 只加载工作区，不创建待办 SQLite。初始化独占创建配置，不覆盖旧实例。使用 Harness 打印的鉴权地址，关闭模型引导后点侧栏“笔记”。默认回环端口 3000；Ctrl+C 停止。

```sh
npm run check:corilo -- --directory /absolute/corilo-instance
# 独立源码插件入口
node plugins/notes/cli.mjs init --directory /absolute/standalone-instance
node plugins/notes/cli.mjs start --config /absolute/standalone-instance/notes.patch.json
```

已有 DSH 使用 [notes.patch.example.yml](../plugins/notes/notes.patch.example.yml) 加载绝对包入口和主机 root。另一套安装好的 DSH 不会因仓库推送自动更新；须安装新包、核对 overlay、重启并刷新页面。

根 `npm start` **仍是旧 app 入口**。旧 `scripts/corilo.mjs` 只是 launcher 的兼容转发。不要误启动旧 Pi／云端链路来证明新插件可用。

## 6. 旧待办迁移与退役

旧 `plugins/todos` 0.5.2 和已生成双插件 overlay 保留。新实例不加载它，旧实例不会自动迁移或删除资料。继续启动旧双插件实例时仍需旧包依赖：

```sh
npm --prefix plugins/todos ci --ignore-scripts
npm --prefix plugins/todos run build
```

迁移前停止源、目标服务，备份 SQLite 整个目录和目标 notes。以下示例只说明命令，**本轮未迁移任何真实用户数据库**：

```sh
# 默认仅预览，不创建目标目录
node plugins/notes/import-todos.mjs --source /absolute/old/todos/todos.sqlite --root /absolute/notes
# 核对后显式导入
node plugins/notes/import-todos.mjs --source /absolute/old/todos/todos.sqlite --root /absolute/notes --apply
```

独立安装包提供 `corilo-import-todos` 命令。导入逻辑：

1. 源数据库只读，校验格式、身份、文件和 sidecar；原数据库与请求回执保留。
2. 保留现有 Later.md，追加未完成／已完成复选框；取消记录不重新打开。
3. 详情和原关联保留可读内容，全部原业务字段在 `archive/Todo import <identity>.md` 的公开 JSON 中完整保存。
4. 先写 planned 迁移日志，再写目标，最后标记 complete。源／目标 SHA 校验和完整日志用于中断恢复、防重复追加及损坏检查。
5. 同源再次执行不重复导入；源后来改变、未完成阶段目标竞争或日志损坏时拒绝继续，不能手删日志后强行重跑。
6. 目标和日志分别最多 1 MiB，超限在写入前失败；不要宣称任意规模资料都可直接迁完。

核对成功后，用户可从旧组合 overlay 移除 `corilo-todos` 项，保留旧配置备份和原 SQLite。launcher 接受固定单插件及旧双插件配置。不要同时维护 SQLite 和 Markdown 两套“当前待办”，也不要以删源码或隐藏入口代替迁移验收。

## 7. 测试命令与已通过证据

```sh
# 主包：Node／真实管线／启动／独立安装／迁移／源哈希
npm run test:notes
# 新工作区 + 可选 classic 页面，两个都在真实 Harness 中运行
npm --prefix plugins/notes run test:browser
# 新单插件和旧双插件启动
npm run test:startup
# 旧待办兼容
npm run test:todos
npm --prefix plugins/todos run test:browser
# 旧应用回归
npm test
python3 app/tests/browser_smoke.py
python3 app/tests/browser_review.py
python3 app/tests/browser_sync.py
```

Python 依赖见 requirements-dev.txt，需 Playwright Chromium。npm 缓存若默认 HOME 不可写，可设置 `npm_config_cache=/workspace/work/npm-cache`。不要通过修改真实 HOME／凭据解决测试隔离问题。

本轮实际证据：

| 检查 | 结果 |
|---|---|
| 工作区包 Node | 59 项，58 通过、1 项旧 restic 演练因缺程序跳过 |
| 新 Files.md 浏览器 | 原生菜单、新建目录／文件、编辑／改名、分栏、实际复选框、键盘查找、收集／日记、媒体、Agent 往返、桌面／390px 文件入口通过 |
| 异常浏览器 | 冲突保留输入、写入／收集／改名丢响应核对、日记读失败不覆盖、保存副本、外部媒体不请求、Unicode 原文件名编辑通过 |
| 旧 classic 笔记页 | 核心浏览器通过，仅作兼容证据 |
| 源码启动 | 4 项通过，含新单插件、旧双插件、401、固定路径及 SIGTERM |
| 旧待办 | 14 项 Node、三套浏览器通过 |
| 旧应用 | 59 项 Node、三套浏览器通过 |
| 独立生产安装 | 离开仓库安装生产依赖，真实 Harness 加载静态资源、读取原有文件及正常退出通过 |
| SQLite 迁移 | 合成数据库映射、源文件不变、防重复、竞争及中断恢复通过；末次校验增强另补跑通过 |

`plugins/notes/test/workspace_browser.py` 才是当前 UI 验收；`core_browser.py` 明确配置 classic。无需真实模型即可继续开发与验证，不应停下来索要密钥。CI 本地配置存在及本地通过不代表远端 Actions 已通过。

**尚未验收**：真实 DeepSeek、物理手机／原生输入法、WebKit、麦克风、目标 Linux systemd／开机自启、远程访问部署、NAS、完整实例备份恢复。不能把普通 Markdown 清单称为可靠提醒。

## 8. 本地可交付物与日志

以下是当前执行环境的临时产物，**不在 Git 中，也不能假定跨环境仍存在**；缺失时按源码重建：

| 产物 | 路径 |
|---|---|
| 独立包 | `/workspace/work/corilo-workspace-v0.7/corilo-dsh-notes-0.7.0.tgz` |
| 包 SHA-256 | `a92113622daa6570b5d7162a4208de5df7f71e189b0b76b8dd4e52685eca6f98` |
| 桌面截图 | `/workspace/work/workspace-review/workspace-desktop.png` |
| 手机模拟截图 | `/workspace/work/workspace-review/workspace-mobile.png` |
| 工作区浏览器日志 | `/workspace/work/workspace-browser.log` |
| 主包 Node 日志 | `/workspace/work/workspace-notes-node.log` |
| 源码入口日志 | `/workspace/work/workspace-startup.log` |
| 最后存储／迁移补跑 | `/workspace/work/workspace-final-storage.log`、`/workspace/work/workspace-migration.log` |

重新打包必须进入包目录，输出目录先创建，不能在仓库根误打包旧应用：

```sh
cd plugins/notes
npm pack --pack-destination /absolute/existing/output-directory
```

包版本仍 private，未执行 npm publish。归档原文及字体等资源随包，约 6.9 MiB；不要为消除上游空白或换行而重写 vendor。

## 9. 接下来优先做什么

1. **对新整合做一次集中 review**：iframe 生命周期、双编辑器版本归属、未知写入／收集／改名、文件／目录删除移动、迁移日志完整性和可用性。这里是建议检查范围，不是已经确认的缺陷列表。
2. **让另一套实际 DSH 安装跑新版**：验证确实安装 0.7.0、加载正确 overlay、重启后资产更新；不要再用仓库内 classic 界面冒充其效果。
3. **用真实设备走完整日常流程**：手机查找／新建／编辑、切 Agent 返回、断线／重连、重启；原生输入法和 WebKit 分别记录。没有目标设备时继续做不依赖设备的改进和回归。
4. **仅在有真实旧库路径后执行迁移**：先停写备份、预览、导入、比对，确认后再移除旧插件入口；本轮只有合成演练。
5. 随后再推进目标 Linux 常驻／远程鉴权和实例级备份。未经用户新要求，不扩展提醒、自动记忆、外部通知服务，也不重新裁剪 Files.md 菜单。

当前文档导航：[产品](PRODUCT.md)、[规格](PRODUCT-SPEC.md)、[交互](DESIGN.md)、[架构](TECHNICAL_DESIGN.md)、[开发](DEVELOPMENT.md)、[插件指南](../plugins/notes/README.md)。历史 v0.32 与更早 Pi／Files.md 云端路线均不作为当前需求。

## 10. 接手续查（2026-11-11）

从远端 `6d33cbc` 接手并检查工作区／Agent 共用存储、iframe 生命周期、双编辑器保存、移动删除、未知回执和迁移日志。确认并修复一个可复现的数据丢失窗口：打开另一文件等待保存回执期间继续输入，旧实现会用新文件覆盖这些尚未提交的输入。现在正文严格来自提交快照，保存结束及加入既有保存的调用都检查剩余脏状态；有新输入时拒绝继续导航并保留编辑器，下一次保存再提交新输入。没有改 vendor、菜单、模型链路或真实用户资料。

真实 Harness／Chromium 的新增用例先在旧实现失败，再在修复后通过，覆盖打开文件与同时打开收集界面等待同一次保存的情形。完整 Files.md 工作区和 classic 浏览器、旧应用三套浏览器均重新通过；主包 Node 59 项中 58 通过，1 项 restic 因缺程序跳过。历史记录不替代这些本轮执行结果。真实模型、物理手机、WebKit 和目标设备部署仍未验收。

另在可丢弃、仓库外的独立 DSH 0.2.2-rc.1 实跑安装与升级：先启动无 Corilo 的宿主，再安装从 `6d33cbc` 重建的 0.7.0 包，其 SHA-256 与第 8 节交接包完全一致；写入合成资料后停止服务，安装本轮修复构建并重启。overlay 原字节、既有资料及旧包写入的资料保留；新服务 host.js 与新安装文件逐字一致且哈希已改变，401 与正常退出检查通过。两包均为本地 0.7.0 构建，不代表发布新 npm 版本；包哈希及检查结果见 [本轮证据](evidence/workspace-upgrade-review.json)。新演练脚本 `plugins/notes/test/upgrade.mjs` 的命令见开发指南。

演练直接调用固定 DSH 原生入口，`--patch` 必须先于 `--no-open`／`--port` 等应用参数。宿主依赖用 --save-exact 固定，并在每次安装后核对实际版本。该演练验证另一套真实安装的 DSH，不代表已修改用户既有实例，也不以 HTTP 静态资源核对替代该实例的浏览器验收。仍需用户目标 DSH 的实际路径与环境才能继续其就地升级；未部署、未发布 npm、未迁移真实数据库。
