# Corilo 可里技术设计

v0.33 · 2026-11-11。业务规则见 [PRODUCT-SPEC.md](PRODUCT-SPEC.md)，交互见 [DESIGN.md](DESIGN.md)。旧自定义极简页面记录见 [v0.32](history/TECHNICAL_DESIGN-v0.32.md)。

## 当前架构

```text
浏览器 → DeepSeek Harness Web 0.2.2-rc.1
          ├─ 原生会话／Agent／模型设置／认证／权限
          └─ @corilo/dsh-notes 0.7.0
               ├─ 原生 Files.md 工作区 iframe → 鉴权 Fetch 路由
               │                                 ↓
               │                            WorkspaceStore
               ├─ corilo_notes_* Agent 工具 → NotesStore + 共用队列
               │                                 ↓
               └─ Markdown／清单／日记／设置／附件：主机普通文件
旧 @corilo/dsh-todos 0.5.2 → 只读迁移工具 → Later.md + archive/迁移记录
```

新源码实例只加载工作区包。旧双插件 overlay 和旧入口脚本继续支持；不自动改配置、迁移 SQLite 或删除包。root package 的 setup:corilo 只安装并构建当前工作区；旧配置若继续加载 SQLite 包，需要保留其依赖。根 npm start/test 仍服务旧应用。

## 前端与宿主接入

`vendor/filesmd/web` 固定上游 commit `9e948ba6071e320c41c866f92817cf96f9bb7ba6`，完整保留原生 HTML／JS／CSS、CodeMirror 5／HyperMD、菜单、资源及许可。SOURCE.json 记录逐文件 SHA-256，测试比对来源。`workspace-api.mjs` 按精确资源路径注册 Harness Connection Fetch 路由，在返回内容时做校验式转换：插入适配层、接管生命周期、安全渲染文件名、保留已有 Unicode 文件名原形、阻止外部媒体自动加载及避免读失败被误当空文件。原始 vendor 文件不修改。

`client/workspace.jsx` 为 Harness 主面板提供工作区入口。iframe 始终挂在插件生命周期内，通过显隐和 ResizeObserver 定位到主面板；切换到原生 Agent 或其他面板不销毁文档。消息只接受该 iframe 与同源来源，用于未保存状态及 `layout.selectPanel(null)`。外部链接仅允许 http/https/mailto，由显式用户操作打开；文件资源通过本地句柄转 blob，不自动外联。

iframe 拥有独立文档与 CSP，内联处理器仅在该 vendored 工作区需要，不放宽整个 Harness CSP。沿用原生 cookie、Host／Origin 和所有者检查，不新建 token、账号、模型配置、权限或 Agent loop。静态资源和文件 API 都在原生鉴权后才可访问。iframe 顶部主机状态／Agent 条预留空间，手机增加调用原生 toggleSidebar 的文件入口。

`workspace/adapter.js` 将 FileSystemHandle 接口适配为主机 API，保留读取版本；`workspace/host.js` 接管保存、导航、组字保护、冲突及未知结果核对。收集提交响应丢失时按实际文件只读核对，阻止同一文件再次写入；不把浏览器局部副本当已落盘。新旧文件名不确定时核对目标，副本保存检查编辑快照，不能覆盖期间的新输入。

原 React／CodeMirror 6／Astryx 页面通过 `interface: classic` 保留兼容，单包 CLI 检查并在 rebind 时保留该选项；它的旧浏览器测试不代表新工作区验收。初期保留兼容代码和依赖，不回滚旧数据。

## 文件服务与 Agent

`WorkspaceStore` 持有同一个 `NotesStore`，所有业务文件操作复用其队列。普通 Markdown 的读写版本与原 Agent 工具完全一致。工作区扩展目录、config.json、媒体和跨目录移动／归档，使用普通主机文件及版本保护；文件复制使用 NotesStore 的正式新建。正文／设置 1 MiB，附件 16 MiB；目录列表累计文件读取 64 MiB，扫描／目录版本最多 20000 项／20 层／10 秒。拒绝隐藏路径、穿越、链接和特殊文件，移动／删除不安全目录拒绝。

写入临时文件、同步并原子发布；文件移动复制并独占发布目标，再删除原名，不覆盖已有目标。目录版本包含后代 metadata，陈旧目录操作拒绝。提交后出错明确报告未知；不承诺对外部编辑器或 Harness 默认 shell 工具提供跨进程事务。工作区目录身份包含路径和 inode，改变后拒绝继续写入。

八个 corilo_notes_* 工具保持名称稳定。save 描述明确个人待办使用 Later.md Markdown 复选框，收集使用 Chat.md，日记位于 journal/，更新前读版本并保留无关内容。原生收集、勾选、日记不调用模型；Agent 只在用户明确要求时操作同一资料。旧工具执行计划与个人事项严格区分。

## SQLite 迁移

`import-todos.mjs` 作为独立 CLI 随包，复用 Node SQLite 只读事务，不需要运行旧插件。默认只预览；--apply 才写文件。源 v1 类型／身份、文件及 sidecar 检查、数量／大小限制先校验。现有 Later.md 保留，未完成与完成映射为复选框，取消记录不重新打开；所有原业务字段在 archive/ 迁移记录中的公开 JSON 精确保留。

planned 日志先于目标提交，包含源身份与指纹、目标前后 SHA、完整导入内容和原数据；然后更新 Later.md，最后标记 complete。重试完成导入不再追加；中断后目标已提交时只补确认；源变化、目标竞争或日志损坏均拒绝继续。目标和日志各自 1 MiB，超限预检失败。源数据库、幂等回执和原包均保留。迁移要求源、目标服务停写；没有静默导入或自动移除原配置。

## 实际证据

- 当前工作区真实发布版 Harness／Chromium：原生菜单、新建文件／目录、编辑、标题改名、实际复选框勾选、分栏、键盘查找、收集、日记、媒体；Agent 导航往返保留 iframe；冲突、写入／收集／改名丢响应核对、日记读失败保留原文、冲突副本、外部媒体不自动请求、已有组合 Unicode 文件名原位编辑、桌面及 390px 文件入口通过。
- 笔记包 Node 59 项：58 通过，1 项旧 restic 演练因环境缺程序跳过。覆盖真实 Cordis 工具管线、发布版启动、仓库外生产安装与完整静态资源、源文件哈希、文件安全和迁移映射／原库不变／防重复／中断恢复。最新迁移日志校验另补跑迁移用例通过。
- 源码入口 4 项通过，覆盖新单工作区和旧双插件启动、只读预检、401、持久路径与 SIGTERM。旧待办 14 项 Node、三套浏览器；classic 笔记浏览器；旧应用 59 项 Node 和三套浏览器均通过。

上述均为合成资料，没有真实模型或外部服务调用。真实 DeepSeek、物理手机／原生输入法、WebKit、实际麦克风、目标 Linux systemd／开机自启、远程部署、NAS 和完整实例备份恢复尚未验收。CI 配置存在不等于远端 Actions 已通过。
