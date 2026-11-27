# Corilo Files.md 工作区 for DeepSeek Harness

**简体中文** | [English](README.md)

Corilo 自有界面跟随 DSH 语言设置（中文／English），切换不改变用户内容或草稿。

**版本 0.9.0** · [中文快速开始](QUICKSTART.zh-CN.md) · MIT · 尚未发布 npm。

一个插件在 Harness 中提供 Files.md 工作区：文件、Markdown 笔记、清单、日记、分栏编辑和媒体，只用于查看和编辑笔记。保留固定上游版本的完整 Web 目录与菜单。Harness 提供认证、原生 Agent 会话、模型配置和权限；不启动 Go 同步服务、Pi loop、Telegram 服务或独立模型界面。

## 安装与运行

需要 Node.js **>=24.9.0**、Harness **0.2.2-rc.3**，使用固定依赖。在源码仓库中执行：

```sh
npm --prefix plugins/notes ci --ignore-scripts
npm --prefix plugins/notes run build
node plugins/notes/cli.mjs init --directory /absolute/corilo-instance
node plugins/notes/cli.mjs start --config /absolute/corilo-instance/notes.patch.json
```

收到独立包时，在新的安装目录中执行：

```sh
npm init -y
npm install --ignore-scripts /absolute/corilo-dsh-notes-0.9.0.tgz
npx --no-install corilo-notes init --directory /absolute/corilo-instance
npx --no-install corilo-notes start --config /absolute/corilo-instance/notes.patch.json
```

包内包含已构建客户端、固定 Files.md 资源与许可声明；生产安装不需要源码仓库、esbuild 或旧应用。使用 Harness 打印的私有鉴权地址，不分享 token。关闭模型密钥引导即可无模型编辑。已有 DSH 可使用 `notes.patch.example.yml`，将入口和 root 设为绝对路径。

## 工作区与 Agent

原生 Files.md 界面运行在持久 iframe 中。文件访问使用 Harness 鉴权路由，以主机磁盘为唯一权威；无需浏览器目录授权、本地镜像或外部同步。原生菜单、新建文件／目录、搜索、标题改名、移动／归档、链接、分栏、日记和清单保留；收集页与 Agent 按钮不提供。宿主保存状态栏在工作区上方预留空间。外部嵌入媒体不会自动加载，本地媒体仍可使用。目录选择器说明目录在主机配置，外部机器人／API 操作会说明相关服务未连接。

已有的 `Chat.md` 原样保留在磁盘上，界面不再显示收集页；`Later.md` 是 Markdown 清单，`journal/` 保存日记，`media/` 保存附件。这些文件与 Harness 模型会话分开。切到其他宿主面板前先保存待提交编辑；返回保留同一 iframe 和编辑会话。Agent 工具读取、按版本保存同一组文件，并与工作区共享队列。直接编辑、日记和复选框操作不调用模型。

写入校验实际读取的版本；旧版本写入失败并保留输入。未知写入结果会暂停该文件后续写入，直到读取核验结果。错误时可以核验文件、明确采用磁盘版本或另存笔记。改名不得覆盖已有目标。服务队列不能与任意外部编辑器／默认 shell 工具形成事务。离开页面会提示未保存输入；不承诺浏览器刷新／崩溃恢复。

正文／设置上限 1 MiB，附件 16 MiB。目录列表最多 20000 项、累计读取 64 MiB；递归版本扫描预算为 20 层／20000 项／10 秒。拒绝隐藏路径、路径穿越、软硬链接和特殊文件，涉及危险后代的操作明确失败。root 是实例配置，不是所有 Harness 工具的沙箱。

## 笔记目录即 Agent 工作区

插件启动时会把 `root` 自动登记为 DSH 工作区（宿主提供 `workspaceController` 服务时；重复启动不会产生重复项，登记失败只记录警告，不影响笔记功能；`interface: classic` 同样登记）。这样 Agent 会话可以直接把笔记目录当作工作目录。插件只登记目录，不会在其中创建任何文件。

`templates/AGENTS.md`（英文版 `templates/AGENTS.en.md`）是“管家守则”模板。请先审阅、按需修改，再自行复制到笔记根目录并命名为 `AGENTS.md`；DSH 会把它作为项目指令自动加载到每个会话。插件不会自动写入你的笔记目录。

## 已有安装与 SQLite 待办

旧配置继续加载，Files.md 为默认界面。要保留旧 React／CodeMirror 6 笔记页，请在插件配置中明确设置 `interface: classic`。旧 `stateRoot` 可接受但当前插件不使用。旧历史、IndexedDB、SQLite、凭据和会话均不自动迁移或删除；classic 恢复工具仅用于已有资料。

上述包内 CLI 创建单笔记实例。仓库启动器 `npm run init:corilo` 创建 notes＋todos，并启用 planner v2。旧单笔记与双插件配置继续兼容，已有待办数据库不自动迁移。日历、提醒及新目录要求见 [todos 指南](https://github.com/keanrain/corilo/blob/main/plugins/todos/README.md)。以下仅是用户明确选择 Markdown 管理任务后的可选单向导出；导入前停止源和目标服务并备份目录：

```sh
# 只读预览，不创建笔记目录。
corilo-import-todos --source /absolute/old/todos/todos.sqlite --root /absolute/notes
# 核对数量与路径后显式导入。
corilo-import-todos --source /absolute/old/todos/todos.sqlite --root /absolute/notes --apply
```

源码使用 `node plugins/notes/import-todos.mjs` 代替已安装命令。源文件必须是位于笔记目录之外的普通、无链接 v1 Corilo SQLite 文件，以只读方式打开。已有 `Later.md` 保留，新条目追加：open → `- [ ]`、done → `- [x]`；取消记录不重新打开。正文与关联仍可读，全部原始业务字段（含取消、时间戳和版本）原样保存在 `archive/Todo import <identity>.md` 的公开 JSON 中。

导入日志先于目标文件写入，记录计划／完成状态及写入前后版本；崩溃后重试不会重复追加。源数据后续变化或目标冲突需要核对。目标和日志均须不超过 1 MiB，超限在写入前失败。旧数据库、回执和插件保留。只有明确选择 Markdown 管理这些任务后才适合移除 `corilo-todos` 入口，不再默认推荐。导出清单与数据库不自动同步，不删除任何源资料。

## 工具、来源与验证

七个 `corilo_notes_*` 工具标识保持：list、browse、search、read、create、save、rename；收集工具随收集页一并移除。Agent 将个人清单与日记保存为普通、带版本的 Markdown；其执行计划 todo 是另一概念。真实 DeepSeek 交互需独立验证，不能由合成工具管线测试代替。

上游：https://github.com/zakirullin/files.md ，固定提交 `9e948ba6071e320c41c866f92817cf96f9bb7ba6`。`vendor/filesmd/SOURCE.json` 记录哈希，上游 Web 文件未改动。`workspace-api.mjs` 对文件名安全、生命周期、读取错误传播与仅本地媒体施加校验式运行时补丁；`workspace/` 适配文件句柄和原生 Agent 导航。原 MIT 与第三方声明随包分发。classic CodeMirror 6／Astryx 代码和声明仅为显式兼容保留。

```sh
npm --prefix plugins/notes test
npm --prefix plugins/notes run test:browser
# 独立打包，在本包目录执行。
npm pack --pack-destination /absolute/existing/output-directory
```

`test/workspace_browser.py` 覆盖当前真实 Harness 工作区，`test/core_browser.py` 覆盖可选 classic 页面。Node 测试覆盖存储、Agent 管线、宿主启动、隔离生产安装、来源哈希和 SQLite 迁移，均使用合成资料，不调用模型或外部服务。物理手机、原生输入法／WebKit、麦克风、真实模型、远程部署、Linux 服务／自启、NAS 和整实例恢复需单独验证。[Linux 指南](LINUX.zh-CN.md)；[旧恢复指南](BACKUP.zh-CN.md) 仅用于旧 notes/state 备份，不是完整 Harness 实例备份。
