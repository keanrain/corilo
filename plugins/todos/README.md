# Corilo 个人待办 for DeepSeek Harness

独立个人待办插件，固定支持 Harness **0.2.2-rc.1**，Node.js **>=24.9.0**。使用 Node 自带的 `node:sqlite`，没有额外数据库服务、ORM 或第二个 Agent loop。Node 的 SQLite 接口仍有实验性提示，必须保持所测运行时兼容。包版本 0.4.1，目前没有发布到 npm。

页面直接创建、查看、编辑、完成、取消或重新打开待办，不需要模型密钥；Agent 工具使用同一持久化服务。个人待办与 Harness 的 Agent 执行计划分开。首版不包含日期、日历、提醒调度或通知，创建待办不代表安排通知。

当前主流程是回车连续新增、列表直接完成/撤销、点标题直接编辑。已存详情默认在离开编辑区、切换待办或返回列表时保存，无需重复点保存；首次点击会先保存修改再完成目标操作。新待办主要从清单内单行录入，辅助入口保留在更多操作。

0.4.0 参考 [Vikunja](https://github.com/go-vikunja/vikunja) 与 [Super Productivity](https://github.com/super-productivity/super-productivity) 的清单／详情分工：标题自动换行，说明按内容伸缩，更多操作浮层不挤动页面。从完成或取消列表新增后回到未完成；新增成功会清除搜索，让新事项可见。清单聚焦时 N 快速录入、/ 查找、上下键移动任务焦点、Enter 打开，详情 Esc 保存后返回。输入与组字不触发导航，错误与未知结果仍保留原请求。

图标复用 **Lucide React 1.70.0**，字段伸缩复用 **react-textarea-autosize 8.5.9**；两者为构建依赖，已打入客户端，沿用宿主 React。构建 peer 通过 override 固定为与宿主一致的 React 18.3.1，React 本身始终 external；独立生产安装不需要这些构建依赖。许可证随包保留。

视觉使用 [Astryx Neutral](https://github.com/meta/astryx) 0.7.11 的 62 个静态设计 token，局部适配原生控件；浅深色与字体继承 Harness，主次按钮、焦点、列表与反馈保持一致。每包 token 子集约 3.6 KB，不载全局 reset 或网络字体。固定 Harness 的 React 实测为 18.3.1，Astryx React 组件要求 >=19，因此本包**没有接入其 React 组件**或另带 React。MIT 与来源哈希随代码记录，原功能和保存保护不变。

## 安装与启动

两个插件一起从源码使用时，优先按[根目录上手](https://github.com/keanrain/corilo/blob/feat/cloud-notes/README.md#一起使用笔记和待办)的 setup/init/start 三步，一个实例目录即可；下面保留独立插件方式。

源码方式，在 Corilo 仓库根目录：

```sh
npm --prefix plugins/todos ci --ignore-scripts
npm --prefix plugins/todos run build
```

按 `todos.patch.example.yml` 创建自己的本地 overlay，把入口和资料目录改为绝对路径。SQLite 使用专用目录，例如 `/absolute/corilo-instance/todos`；不放入 Markdown、笔记历史或 Harness 凭据/会话目录。`notesRoot` 可指定现有知识库，用于拒绝与数据库目录互相嵌套；它不授予额外读写权限。

```sh
cd plugins/todos
./node_modules/.bin/dsh web --patch /absolute/todos.patch.yml --no-open --port 3000
```

沿用 Harness 打印的鉴权访问地址，不分享 token。关闭模型密钥引导即可点击侧栏的待办入口直接使用。模型设置和默认工具权限仍由 Harness 提供；root 不是默认 bash 或文件工具的沙箱。

若要与笔记一起使用，在 Harness 的 overlay 中同时插入两包的绝对入口：

```yaml
- insert:
    - id: corilo-notes
      name: /absolute/corilo-install/node_modules/@corilo/dsh-notes/index.mjs
      config:
        root: /absolute/corilo-instance/notes
        stateRoot: /absolute/corilo-instance/state
    - id: corilo-todos
      name: /absolute/corilo-install/node_modules/@corilo/dsh-todos/index.mjs
      config:
        root: /absolute/corilo-instance/todos
        notesRoot: /absolute/corilo-instance/notes
```

使用固定 Harness 原生启动命令加载这份组合配置。源码统一入口 `launcher/corilo.mjs`（原 `scripts/corilo.mjs` 保留兼容转发） 已负责生成组合，无需手写。笔记包的 `corilo-notes` CLI 只接受单笔记 overlay，不用于解析多插件组合。原 Linux 用户服务示例的单笔记启动命令也不会自动加载待办；不要悄悄替换已运行实例的配置。常驻时继续固定 `DSH_HOME`、`DSH_AGENTS_HOME`、工作目录与端口，参考笔记包的 Linux 指南。

## 页面与可靠性

- 首页只填标题即可连续新增，成功后清空并聚焦输入框。列表行可直接完成/撤销，完成后的提示也提供撤销入口；行操作不覆盖其他待办的编辑草稿。
- 状态按钮直接切换未完成、已完成、全部或已取消，搜索始终可见，支持标题/详情的字面搜索及每页 100 条的继续加载。SQLite 原生搜索对 ASCII 英文字母忽略大小写，中文逐字匹配。
- 点标题在桌面侧栏、手机独立详情视图编辑；“返回列表”或切换前先按读取版本保存已明确编辑的详情，失败／冲突停留原处；恢复草稿本身不触发保存，未编辑恢复内容仍可再次归档。关闭更多操作内的“离开详情时保存”后可沿用显式保存与导航草稿。详情草稿只归档当前事项，恢复不覆盖独立快速输入或带回已新增的旧输入；归档与导航之间也保留完整崩溃恢复副本。恢复仍需明确操作，不自动写主机。结果未知的请求必须先处理，不能通过切换丢弃。编辑区 Ctrl／⌘S 复用显式保存。输入法组字期间不提交；未知结果及失败暂停自动保存，保留原请求和浏览器恢复副本。
- 修改使用读取时的整数版本；其他页面已修改时拒绝陈旧写入，并保留编辑内容供核对。完成、取消和重新打开也遵循相同版本保护。
- 每个写请求携带 UUID v4。SQLite 将变更和幂等回执放在一个事务中；丢失响应后明确重试同一个请求不会重复创建。相同 UUID 改成其他内容会被拒绝。原请求重试返回当时的提交结果，后续修改须重新读取当前版本。
- 页面复用 idb 保护详细编辑、快速输入和结果未知的完整请求。刷新后明确恢复/丢弃，保留原版本和 UUID，不自动重发；多标签通过事务与内容校验保护较新草稿，按持久 SQLite 身份隔离。浏览器副本不等于主机已保存；存储失败明显提示，直接保存仍可用，清除站点数据或更换浏览器来源会失去恢复副本。
- 关联笔记保存相对 `.md`/`.markdown` 路径，页面显示路径供在笔记“按路径打开”中使用；不验证文件存在、不自动移动笔记，也不承诺重命名后自动修复关联。

## 存储与资料带走

专用目录包含 `todos.sqlite`，运行时可能有 `-wal` 与 `-shm`。SQLite WAL、FULL 同步和事务负责本地持久化及并发，写锁等待最多 2 秒；默认同一主机本地文件系统，不将未经验证的网络共享目录当工作数据库。未知 schema、危险链接、特殊文件或无关目录内容会拒绝打开，不自动迁移/覆盖已有数据库。

待办含 `id`、`title`、`body`、`notePath`、`status`、`version`、`createdAt` 和 `updatedAt`。标题去掉首尾空白后 1–200 字符，详情最多 20000 字符，关联路径最多 1024 字节。完成/取消保留记录，不作物理删除。请求回执随数据库持久保存，尚未设置自动清理或磁盘配额。

页面和 `corilo_todos_export` 可导出公开 `corilo-todos-v1` JSON，含所有状态的业务记录，最多 10000 条/8 MiB；超限报错，不能把部分导出叫完整。JSON 不含凭据、Harness 会话或幂等回执；首版不提供 JSON 导入，不把它称作等价数据库灾备。

需要备份时停止所有使用该目录的 Harness 实例及外部写入，复用 restic 备份**整个待办资料目录**，恢复到新的空目录后校验并用匹配版本重新打开。不要只复制运行中的主数据库而漏掉 WAL。现有笔记备份仅选择 notes/state，**不会自动包含待办**；笔记 `restore.mjs` 只接受 notes/state，也不能处理三目录组合。待办目录属于新增备份边界，NAS/全实例一致性恢复仍需单独验收。

## Agent 工具

| 工具 | 用途 |
|---|---|
| `corilo_todos_list` | 筛选、字面搜索、分页列出个人待办 |
| `corilo_todos_read` | 读取内容和当前版本 |
| `corilo_todos_create` | 带请求 UUID 新建待办 |
| `corilo_todos_update` | 检查版本后修改、完成、取消或重新打开 |
| `corilo_todos_export` | 导出版本化 JSON |

在 Agent 对话中使用工具仍涉及模型轮次；直接页面操作没有模型请求。调用只在用户明确要求记录/修改个人事项时使用，不把普通讨论或 Agent 执行步骤自动写成个人待办。

## 独立分发与验证

```sh
cd plugins/todos
npm pack --pack-destination /absolute/existing/output-directory
```

收件人在自己的 npm 安装目录执行 `npm init -y`，再 `npm install --ignore-scripts /absolute/corilo-dsh-todos-0.4.1.tgz`；按示例配置，使用安装目录的 `./node_modules/.bin/dsh` 启动。首次仍需下载固定生产依赖，保留生成的 lockfile；安装包不需要源码或 esbuild。

源码验证：

```sh
npm run test:todos
npm --prefix plugins/todos run test:browser
```

浏览器共存检查还需已安装、构建 `plugins/notes`；浏览器依赖沿用根目录 `requirements-dev.txt` 和 Chromium。测试使用临时资料与合成凭据，不调用模型。真实模型、物理手机、NAS 与目标设备部署证据分别记录在主技术设计中，不能由工具或 Chromium 测试代替。
