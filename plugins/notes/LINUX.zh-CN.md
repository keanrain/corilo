> 当前 0.7.0 的工作区不需要 Git 或历史目录。此文中涉及 Git／stateRoot／历史／恢复的步骤仅适用于旧版资料，当前核心使用见 [快速开始](QUICKSTART.zh-CN.md)。systemd 示例仅是人工部署参考，尚未部署到用户设备。

# Linux 常开主机运行指南

适用于使用 systemd 用户服务的 Linux 常开电脑或小主机。插件 v0.2.2 继续复用固定版 Harness `0.2.2-rc.1`，用系统自带 systemd 管理进程。服务示例仅监听回环地址，不自动配置手机远程访问。发行版、真实硬件、开机后无人登录和网络访问必须在目标主机实际验收。

## 先完成前台启动

按[快速开始](QUICKSTART.zh-CN.md)安装插件，使用普通用户初始化并前台启动一次。不用 root 运行 Harness。确认无需模型密钥也能打开工作区、保存中文、勾选清单和记录日记，再正常停止。不要让前台服务与常驻服务同时写同一资料目录。

推荐把四种位置分开：

```text
corilo-install/       当前版本安装目录与 npm lockfile，可并列保留旧版
corilo-instance/
├─ notes/            普通笔记与附件
├─ state/            该库历史与回收站
└─ notes.patch.json  指向当前插件安装的配置
corilo-runtime/
├─ harness/          DSH_HOME：Harness 配置、会话、日志等
└─ agents/           DSH_AGENTS_HOME：原生共享 Agent 配置根
```

`DSH_HOME` 与 `DSH_AGENTS_HOME` 是固定版 Harness 的原生环境变量。后者默认是 `~/.agents`，不随 DSH_HOME 自动隔离；显式配置可避免无意读取同用户已有的共享 Agent 配置。选定后保持这些路径不变，前台和服务使用同一组变量。更换 DSH_HOME 不会自动迁移已有的 Harness 会话或模型配置。

显式 home 不是完整环境沙箱：Harness 的凭据解析还可能读取继承的环境变量、WorkingDirectory 下的 `.env` 及 DSH_HOME 下的 `.env`。用户服务也可能继承用户 manager 的环境。为服务使用固定、本人管理的实例工作目录，不把源码仓库设为工作目录，不把凭据写进 unit 或笔记；沿用 Harness 原生模型设置，不能据两个 home 路径就声称所有凭据完全隔离。

先创建本人拥有的 runtime 父目录并设为仅本人可访问，再运行前台检查。例如，替换以下绝对路径：

```sh
install -d -m 700 '/absolute/corilo-runtime' '/absolute/corilo-runtime/harness' '/absolute/corilo-runtime/agents'
export DSH_HOME='/absolute/corilo-runtime/harness'
export DSH_AGENTS_HOME='/absolute/corilo-runtime/agents'
node '/absolute/corilo-install/node_modules/@corilo/dsh-notes/cli.mjs' check --config '/absolute/corilo-instance/notes.patch.json'
node '/absolute/corilo-install/node_modules/@corilo/dsh-notes/cli.mjs' start --config '/absolute/corilo-instance/notes.patch.json' --port 3000
```

源码安装将 cli.mjs 路径换为源码中的绝对路径；安装包内已有构建文件。`check` 不启动服务，也不证明端口空闲或完整历史没有损坏。前台启动时仍使用终端打印的鉴权 URL；不要省去鉴权参数猜测成功。停止前台进程后再继续。

Linux 无桌面环境可能缺少 `xdg-user-dir`，Harness 默认 Documents 工作目录初始化会提示失败。在其 Choose workspace 中选择一个已有目录，或安装发行版提供的 `xdg-user-dirs` 并配置实际 Documents 目录。工作目录与 Corilo notes 根分别管理；插件根和 unit 的 WorkingDirectory 都不是默认 bash/文件工具的沙箱。

## 准备用户服务

[corilo-notes.service.example](corilo-notes.service.example) 是可审阅的用户服务示例。先复制到临时文件并替换全部 `/absolute/...`，特别是 Node 可执行文件、插件入口、实例和 runtime 路径。Node 的实际绝对路径可在前台运行 `node -p process.execPath` 获取；不要依赖交互式 shell 的 nvm 初始化或 `npx` 联网解析。Git 应在示例 PATH 内；若实际安装在其他目录，调整 PATH 后重做检查。固定端口示例为 `3000`，与现有程序冲突时改为另一个固定端口。

systemd 不是 shell：ExecStart 中不写 `~`、`$(...)` 或 shell 重定向；路径含空格使用双引号。路径含 `%` 时在 unit 中写成 `%%`，避免被解析为 systemd specifier。示例没有自动安装动作，也没有放宽监听地址或关闭鉴权。

下面命令仅在你已审阅、替换路径并决定在这台设备启用服务时执行；不是远程部署命令：

```sh
install -d -m 700 ~/.config/systemd/user
install -m 600 '/absolute/reviewed-corilo-notes.service' ~/.config/systemd/user/corilo-notes.service
systemd-analyze --user verify ~/.config/systemd/user/corilo-notes.service
systemctl --user daemon-reload
systemctl --user start corilo-notes.service
systemctl --user status corilo-notes.service
```

示例使用 `Restart=on-failure`，连续失败会触发频率限制，不会无休止高速重试。手动 stop 不触发重启。`KillMode=mixed` 先将 SIGTERM 交给 CLI，由 CLI 转发给 Harness；超时后才结束残留 cgroup 进程。`UMask=0077` 限制本进程新建文件的默认权限，不会自动修复已有目录或文件权限。这些设置不是 Agent 沙箱或多用户隔离保证。

服务日志会包含 Harness 的带 token 访问地址，也可能包含会话诊断；只在自己的设备查看，分享前去掉完整 URL/token 与个人资料。日志由系统 journal 管理，不另造日志服务或把日志放进知识库：

```sh
journalctl --user -u corilo-notes.service -n 40 --no-pager
```

重启后若旧鉴权地址不可用，使用本次启动日志中的访问地址，沿用 Harness 原生认证；不要把旧地址或 token 固定写进 unit、笔记或公开脚本。

## 登录后自启与无人登录

先通过前台与手动用户服务验收，再选择是否自启：

```sh
systemctl --user enable corilo-notes.service
```

这将用户服务接到 `default.target`，不等于保证机器开机但无人登录时也运行。若需要无人登录保持运行，按该发行版权限流程由设备管理员评估 `loginctl enable-linger 用户名`；启用后需实测重启与未登录状态。不要为此默认改成 root 服务。关闭自启可执行 `systemctl --user disable corilo-notes.service`；它不停止已运行实例，停止用下面的 stop 命令。

休眠、断电、网络中断期间无法提供服务；开机自启不等于全年可靠在线。电源策略、磁盘挂载顺序与备份目标连通性应在目标小主机上确认，不把休眠电脑宣称为可靠提醒主机。

## 停服、备份与升级窗口

```sh
systemctl --user stop corilo-notes.service
systemctl --user is-active corilo-notes.service
```

确认 inactive，并停止其他 Harness 实例和外部编辑器写入。然后按[restic 指南](BACKUP.zh-CN.md)备份 notes 与 state；该备份不含 runtime 中的会话/凭据，也不含浏览器草稿。维护历史、恢复或升级也在相同停写窗口进行。完成检查后执行 `systemctl --user start corilo-notes.service`，核对已知笔记及历史。

升级按[快速指南](QUICKSTART.zh-CN.md)并列安装与 rebind，保留旧安装/配置。unit 中改为新安装与新配置的绝对路径后，先 verify，再 daemon-reload 和 start；失败回退时先 stop，恢复原 unit 中的入口/配置并 reload。不要让新旧服务同时运行；不要只覆盖 npm 安装后假设 unit 和配置中的旧绝对路径都会自动更新。

## 手机访问与目标机验收

回环地址仅供运行服务的主机访问。下一阶段可评估 Tailscale 等成熟私网方案，但尚未在此交付中安装、开通或验证。不要直接把端口改成公网监听。Harness 默认工具能执行本机命令，远程访问者拿到认证等同获得相应 Agent 能力，仍需验证身份、Host/Origin、TLS 与暴露范围。

目标设备验收按实际顺序进行：前台无模型保存；用户服务手动启动与正常停止；固定端口重启后读取同一笔记/历史；预期的登录或无人登录启动；独立备份后恢复到新目录；最后才配置并验收手机远程访问。物理 Android/iPhone、原生输入法、iOS WebKit 和真实 NAS 恢复不能用 Chromium 触控模拟或 unit 语法检查替代。

本轮对替换为临时路径的示例执行 `systemd-analyze verify`，实际通过。容器中的 `--user verify` 因缺少用户 RuntimeDirectory 无法初始化 manager；未在用户设备启用服务，语法检查不等于用户服务实机运行。真实 Harness 子进程的启动、停止和重启检查另由测试记录，不等于实际开机、自启或机器睡眠恢复验收。
