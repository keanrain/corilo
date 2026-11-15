> 旧版存量兼容指南：当前 0.6.0 不再生成历史／回收站，也不要求部署这套备份流程。以下仅用于处理旧格式资料；当前使用见 [快速开始](QUICKSTART.zh-CN.md)。

# 笔记与历史的独立备份、恢复

使用成熟开源工具 [restic](https://restic.net/) 管理加密、增量备份、仓库校验与提取；Corilo 只补充异地恢复时的历史目录绑定检查。以下流程针对 `init --directory` 创建的 `notes/`、`state/` 布局。Linux 本地临时仓库已用 restic **0.18.1** 实测；实际 NAS、其他操作系统和远程仓库仍需在目标设备演练。

范围是**已经落盘的笔记、知识库内附件、本机版本历史和回收站**。这不是完整 Harness 实例备份：不包含模型配置、凭据、对话、默认工具在其他目录写的文件，也不包含浏览器 IndexedDB 草稿。升级前先把需要的草稿保存到文件。恢复不会执行会话、调用模型或发送通知。

## 准备独立仓库

从 restic 官方安装说明安装，保留加密密码的独立安全副本；密码丢失无法恢复。示例使用 Linux/POSIX shell。将示例绝对路径改成自己设备的路径。

```sh
export RESTIC_REPOSITORY='/mnt/backup/corilo-restic'
export RESTIC_PASSWORD_FILE='/secure/restic-password'
restic version
restic init
```

`RESTIC_PASSWORD_FILE` 是用户事先创建、仅本人可读的密码文件，不能位于 `notes/`、`state/` 或备份仓库内。不要把密码直接写在命令参数、仓库文档或聊天中。仓库应位于另一块盘或独立设备；同盘目录只适合恢复演练，不抵御磁盘损坏。现有仓库不用再次 `init`。

## 停服后备份

先在运行服务的终端按 Ctrl+C，并确认服务已经退出；若服务由系统管理，使用其正常停止命令并确认已停。停止其他 Harness 实例、默认 bash/文件工具和外部编辑器写入，整个备份期间保持不写入。插件自己的串行队列不能为外部进程提供一致性快照，restic 也不会替 Corilo 停服。

```sh
cd '/srv/corilo-instance' && \
restic backup notes state --tag corilo-notes-v1 --tag "corilo-root=$(pwd -P)/notes" && \
restic check --read-data && \
restic snapshots --tag corilo-notes-v1 --json
```

必须从实例父目录按相对路径备份 `notes state`，这样提取结果恰为两个目录；不备份整个父目录或整个 HOME。`corilo-root=` 标签把备份时的**原始规范绝对知识库路径**保存在加密快照元数据中，灾后恢复到新路径时必须使用它核对历史绑定。自行指定分离目录的高级安装，需先设计等价的两目录备份布局，不能直接照搬这条命令。

只有 `backup` 和 `check` 都成功才记为成功；权限错误、退出码 3 等不完整备份不能当成功。记下本次完整快照 ID 及插件/Harness 版本，之后可重新启动原实例。不要只依赖可变化的 `latest` 来选择恢复版本。`check --read-data` 会读取整个仓库，耗时随资料增长；当前未设置自动调度、自动清理或保留期限。

笔记中的敏感资料仍属于备份内容；“排除凭据”指示例没有选取 Harness 配置目录，并不检测或删除用户自己写入笔记的秘密。

## 先提取、比对，再准备新实例

为恢复演练选择一个**全新的、尚不存在**的提取路径和另一个新实例路径。不要将 restore 指向原库、现有实例或 HOME。如果要在同一设备回退，保留原实例，先恢复到另一个目录。

```sh
restic snapshots --tag corilo-notes-v1 --json
restic restore '完整快照ID' --target '/srv/corilo-extracted' --verify
```

确认提取目录只有 `notes/` 和 `state/`。恢复演练时将提取出的笔记/附件与停写的原库逐文件 SHA-256 比对，检查数量、相对路径和内容；`--verify` 验证提取文件与快照内容相同，不证明备份前就已经完整，也不替代实际打开笔记和恢复历史。

从已选择快照的 `tags` 中读取 `corilo-root=` 后面的完整路径。下面示例假设它是 `/srv/corilo-instance/notes`。原始路径仅用于核对绑定，原库无需存在。

设置已安装插件包的绝对目录（内含 `restore.mjs` 和 `cli.mjs`）。以下二选一并替换为自己的真实路径；后面的命令直接用 Node，不要求全局安装或修改 PATH：

```sh
# 独立 tarball 安装在 /opt/corilo/releases/0.2.1 的示例：
CORILO_PACKAGE='/opt/corilo/releases/0.2.1/node_modules/@corilo/dsh-notes'
# 若使用源码 checkout，则改用：
# CORILO_PACKAGE='/absolute/path/to/corilo/plugins/notes'
```

```sh
node "$CORILO_PACKAGE/restore.mjs" \
  --restored-directory '/srv/corilo-extracted' \
  --original-root '/srv/corilo-instance/notes' \
  --target-directory '/srv/corilo-recovered'
```

helper 在创建新目标前检查目录组成、路径分离、原 rootId、链接/特殊文件、历史 Git 配置及 `git fsck` 完整性。上限为 20,000 个提取条目、40 层；超限明确拒绝。目标连空目录也不能预先存在，父目录需已存在且无符号链接。helper 复制整个两目录树，随后仅在新副本里更新绝对路径绑定；原提取结果、原库和备份仓库不变。Git 校验针对历史对象，普通笔记/附件字节核对应由提取验证和上述比对完成。

复制期间也不要修改提取目录。失败时可能留下新目标的部分副本；检查失败原因并使用另一个未存在的目标重试，不把部分副本当成功，不自动删除任何用户目录。只有命令返回 `ready: true` 才进入下一步。

使用当前固定插件重新生成配置，不恢复旧路径配置或模型密钥：

```sh
node "$CORILO_PACKAGE/cli.mjs" init \
  --root '/srv/corilo-recovered/notes' \
  --state-root '/srv/corilo-recovered/state' \
  --config '/srv/corilo-recovered/notes.patch.json'
node "$CORILO_PACKAGE/cli.mjs" check --config '/srv/corilo-recovered/notes.patch.json'
node "$CORILO_PACKAGE/cli.mjs" start --config '/srv/corilo-recovered/notes.patch.json'
```

在 Harness 中打开笔记、查看旧版本，并把回收站中的一篇恢复到新文件名，核对文本与附件。新绝对根目录具有新的浏览器知识库身份，原浏览器草稿不会自动出现。通过后再决定正式切换；原实例与提取结果继续保留，避免未经检查覆盖现有资料。

## 可重复的合成演练

仓库开发者可运行：

```sh
CORILO_REQUIRE_RESTIC=1 node --test plugins/notes/test/backup-restic.test.mjs
```

也可设置 `CORILO_TEST_RESTIC` 为 restic 可执行文件的绝对路径。测试仅用自动清理的临时目录、合成密码和虚构资料，过滤调用者已有的 `RESTIC_*` 配置，真实执行加密仓库初始化、备份、全量数据检查、指定快照提取与恢复，逐文件比对笔记、二进制附件与历史目录，并验证历史/回收站可用。另测试错 rootId、现有目标、额外文件、链接和损坏历史拒绝。默认没有 restic 时只跳过真实演练，设置 `CORILO_REQUIRE_RESTIC=1` 则缺少工具会失败。
