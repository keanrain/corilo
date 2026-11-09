# Corilo 可里技术设计

v0.26 · 2026-11-09。当前为个人自部署的 Harness 插件架构。v0.26 调整两个插件的核心交互，仍复用原业务服务和草稿事务；唯一当前业务规则及 H 系列验收见 [PRODUCT-SPEC.md](PRODUCT-SPEC.md)。

## 当前架构

```text
浏览器 → DeepSeek Harness Web 0.2.2-rc.1
          ├─ 原生会话、Agent、模型配置、默认工具与权限机制
          ├─ Corilo 笔记页面 ─┐
          │  笔记 Agent 工具 ─┴─ NotesStore → Markdown / 独立 Git 历史
          └─ Corilo 待办页面 ─┐
             待办 Agent 工具 ─┴─ TodoStore → SQLite
浏览器 IndexedDB → 按资料库身份隔离的恢复草稿
源码 launcher → 两包组合配置 → 固定原生 Harness 启动器
```

不重写 Agent loop、模型管理或任务调度底座。当前核心写入通过业务服务执行，不调用模型；Agent 使用这些工具时仍由 Harness 管理模型交互。个人待办与 Harness 的 Agent 执行计划分开。

## 模块职责

| 路径 | 职责与依赖方向 |
|---|---|
| [plugins/notes](../plugins/notes/README.md) | 独立 npm 包；Markdown 文件、路径与版本校验、搜索、Git 历史／恢复、笔记页面及工具 |
| [plugins/todos](../plugins/todos/README.md) | 独立 npm 包；Node SQLite 持久状态、版本／幂等保护、待办页面及工具 |
| [launcher](../launcher/corilo.mjs) | 仓库源码组合入口；生成固定两包配置、预检、委托 Harness 启动，不承载业务存储 |
| [deploy/systemd](../deploy/systemd/corilo.service.example) | 统一实例的 systemd 用户服务示例，供人工审阅安装 |
| [scripts](../scripts/README.md) | 开发资产生成、历史工具及旧启动路径兼容转发 |
| `app/`、`android/`、`prototype/`、`p0/` | 保留的迁移前实现；不参与当前插件的发布依赖 |

两个插件各自锁定运行依赖与构建工具、独立分发；根 npm 依赖继续服务旧应用。组合入口调用现有包，不引入共享源码包或 npm workspace。目录与开发命令详见 [DEVELOPMENT.md](DEVELOPMENT.md)。

## 客户端与宿主通信

两包通过 `dsh.client`、`./client` 导出与固定 esbuild 生成的 lazy-CJS factory 接入公开 `main`／`sidebar.panellist` slot，使用宿主 React／Store。页面通过同源 JSON 请求访问 `ctx.connection.fetch.register` 注册的精确 API；沿用 Harness Connection 的认证、Host／Origin 与 owner 校验。页面与工具持有同一业务服务，浏览器不直接访问磁盘，不修改宿主源码或 CSP。

视觉复用 Astryx Neutral 0.7.11 的 MIT 静态 token，仅作用于插件根。固定宿主 React 18.3.1，而 Astryx React 组件要求 >=19，因此保持原生控件与宿主运行时，不额外引入 React。生成来源与许可随独立包保留。

## 资料与运行状态

统一实例位于仓库外：`notes/` 是 Markdown 正文，`state/` 是独立 Git 历史／回收站，`todos/` 是 SQLite；`runtime/harness` 与 `runtime/agents` 固定原生配置／会话位置，`workspace/` 为默认工具工作目录。配置使用安装路径的绝对引用，移动源码需显式核对，不自动迁移独立实例、凭据或旧 Pi 会话。

浏览器草稿复用 idb／IndexedDB，按资料库与页面身份隔离，恢复需明确操作。它受设备、origin 和站点数据清理影响，不能替代备份。笔记独立恢复复用 Git 与 restic；现有 restic 演练仅覆盖笔记／附件／历史，不含 Harness 凭据、会话、待办或浏览器草稿，不是完整实例恢复。

## 稳定边界

- Harness 与配套依赖固定 `0.2.2-rc.1`；预览版本升级必须重跑真实插件、分发及浏览器验收，不按 npm `latest` 推断兼容性。
- 插件服务负责其文件／数据库的检查与一致性；不限制 Harness 默认 bash／文件工具，不能承诺任意外部编辑器的跨进程事务或完整中间版本历史。
- 原生认证与工具权限由 Harness 提供。源码默认回环监听，不等于完成远程访问部署或多租户隔离；初始化不安装服务，check 不创建资料／原生 home／待办数据库，SQLite schema 在实际插件启动时校验。
- 本机磁盘作为工作目录；NAS 先作备份方向。未经验证不将 SMB/NFS 或双向同步目录作为工作目录。
- 旧云端 AI 提交保持关闭，`start:controller` 仅恢复已有任务；当前插件不会重放旧 PostgreSQL／Pi 任务或转换用户数据。

## 实现证据与未验收范围

截至 v0.24，实际通过：笔记 37 项 Node、待办 12 项 Node、统一启动 2 项检查；分别保留真实 Cordis／Harness 工具管线、发布版 Web 启动、匿名 401、SIGTERM 与独立 tarball 生产安装证据。笔记 9 套、待办 4 套浏览器检查覆盖真实 Harness 流程与运行时、草稿、移动视口、明暗视觉／焦点及作用域隔离；旧应用 59 项 Node 和三套浏览器回归仅保护旧链路。最新修复后的两个插件远端 Actions 已通过；完整逐轮证据见 [v0.17–v0.24 实施档案](history/HARNESS-IMPLEMENTATION-v0.17-v0.24.md)。

以上使用合成资料，没有真实模型或通知调用。物理手机、原生输入法、WebKit、真实 DeepSeek、远程部署、实际 Linux 用户 manager／自启／设备重启、NAS 与完整实例备份仍未验收。systemd 示例仅有静态 verify 与直接进程重启证据，不能替代设备交付。

旧云端技术与当时证据单独保留在 [v0.16 技术档案](history/TECHNICAL-DESIGN-v0.16.md)，不作为当前架构或当前 H 系列验收依据。

v0.25 仓库整理验证（2026-11-09）：笔记 37 项、待办 12 项、旧应用 59 项 Node 检查及更新后的源码启动 4 项检查通过。本轮没有修改页面，未重跑浏览器流程；上述浏览器证据仍归属 v0.24。

## v0.26 交互调整

笔记 v0.2.5、待办 v0.2.2。参考成熟产品的列表／文档和列表／详情分工，保留原生 Harness 插件入口、局部 Astryx token 与 IndexedDB 事务，不新增框架或宿主运行时。笔记补普通标题规范化与编辑区保存快捷键；待办在切换详情前复用现有 `drafts.stash`，保留失败不切换，未知请求不通过导航清除。手机用 CSS 切换列表与编辑视图，原组件仍挂载以保留输入。详见 [交互设计](DESIGN.md)。

本轮实际通过：笔记 37、待办 12、旧应用 59 项 Node 检查，源码组合启动 4 项；笔记全部 9 套、待办全部 4 套浏览器检查及旧应用三套浏览器回归。补充真实 Harness 检查覆盖普通标题与 `.markdown` 扩展名、CtrlS 和组字不提交、标题草稿切换／恢复、待办切换保留／事务失败停留、手机独立详情与返回列表，原有冲突／未知结果幂等保护继续通过。全部为合成资料、零模型／外部请求；物理手机、原生输入法与 WebKit 尚未验收。
