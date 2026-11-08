# Corilo 可里笔记插件：快速开始

**不配模型密钥，也能保存、打开和编辑笔记。** 笔记是主机上的普通 Markdown 文件。需要助手对话时，再使用 Harness 自带的模型设置。

准备 **Node.js ≥24.9.0**、**Git ≥2.36** 和 npm。插件会安装固定版 Harness `0.2.2-rc.1`，不用另外全局安装 `dsh`。首次安装依赖需要联网；目前没有开箱即用的桌面安装器。

## 从源码启动

在 Corilo 仓库根目录执行：

```sh
npm ci --prefix plugins/notes --ignore-scripts
npm --prefix plugins/notes run build
node plugins/notes/cli.mjs init --directory /absolute/path/to/corilo-instance
node plugins/notes/cli.mjs check --config /absolute/path/to/corilo-instance/notes.patch.json
node plugins/notes/cli.mjs start --config /absolute/path/to/corilo-instance/notes.patch.json
```

将示例路径换成你选定的主机绝对路径。`init --directory` 创建实例目录与配置，不覆盖已有配置、不迁移笔记。`start` 首次成功加载后才创建笔记与恢复目录。

## 收到独立安装包后启动

收到 `corilo-dsh-notes-0.2.0.tgz` 后，在你选定的安装目录执行：

```sh
npm init -y
npm install --ignore-scripts /absolute/path/to/corilo-dsh-notes-0.2.0.tgz
npx --no-install corilo-notes init --directory /absolute/path/to/corilo-instance
npx --no-install corilo-notes check --config /absolute/path/to/corilo-instance/notes.patch.json
npx --no-install corilo-notes start --config /absolute/path/to/corilo-instance/notes.patch.json
```

安装包不含全部依赖，npm 会下载固定版 Harness 及其他运行依赖。保留安装目录里的 `package-lock.json`；使用安装包不需要 Corilo 源码或 esbuild。包目前没有发布到 npm。

## 打开后直接记笔记

1. 打开终端打印的鉴权访问地址；不要分享其中的 token。
2. 接受 Harness 的预览提示；如果出现 API Key 引导，关闭它即可。
3. 点击侧栏 **笔记**，输入文字，点击 **仅保存原话**。
4. 看到 **已保存** 后，正文已写入主机上的 Markdown 文件。浏览器“草稿已保存”只是本机浏览器的恢复副本。

停止服务用 `Ctrl+C`。以后重新执行相同的 `start --config ...` 即可；不是每次都执行 `init`。当前启动命令默认只监听主机回环地址；手机和其他电脑的远程访问仍需另行配置和实际验证。

## 记住这三个位置

```text
corilo-instance/
├─ notes/             普通 Markdown 正文
├─ state/             绑定此知识库的 Git 历史与回收站
└─ notes.patch.json   本地插件配置
```

正文、恢复数据和配置要分开；`state` 不能放在 `notes` 里面，二者也不能互相包含。不要把 Harness 的凭据、会话或配置放进笔记目录。若已有知识库，可使用完整的 `--root /... --state-root /... --config /...` 参数，显式指定现有正文目录和新的独立恢复目录。

## 整理本地历史

使用一段时间后，可整理 Git 对象和引用，保留全部版本及回收站记录。**先用 `Ctrl+C` 停止此实例正在运行的服务**，再执行：

```sh
# 源码安装，在仓库根目录
node plugins/notes/cli.mjs maintain --config /absolute/path/to/corilo-instance/notes.patch.json
```

独立安装包使用 `npx --no-install corilo-notes maintain --config /absolute/path/to/corilo-instance/notes.patch.json`。完成后用原 `start` 命令重开服务。整理不会自动删除旧历史、设置保留期限或清理笔记；它不能代替独立备份。

## 遇到问题

| 现象 | 下一步 |
|---|---|
| 提示客户端未构建 | 源码安装执行 `npm --prefix plugins/notes run build`；独立安装包应自带构建文件 |
| 提示配置已存在 | 不会覆盖；直接 `check` 后 `start`，或另选配置文件 |
| 提示状态目录属于其他知识库 | 使用匹配的正文与状态目录，或选择新的空状态目录；不要改写绑定标记 |
| 保存失败／版本冲突 | 当前草稿保留；核对磁盘最新内容，或将草稿另存，避免盲目重试 |
| 浏览器草稿保护失败 | 先直接保存文件，确认落盘后再关页；不要依赖重载恢复 |

历史与回收站是主机上的本地恢复能力，不是独立备份；完整 NAS 备份恢复尚未交付。详细边界、工具 API、打包与测试命令见 [README](README.md)。
