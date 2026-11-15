# 恢复控制器运行入口

2026-10-22。`npm run start:controller` 是当前可运行的独立恢复入口。它不领取排队任务、不启动新容器、不签发模型授权；没有启用执行的参数。公网 AI 提交仍关闭。完整执行入口须等待持久磁盘额度、真实服务与部署验收。

## 职责与调用顺序

入口组合现有 `ExecutionController`、私有文件宿主客户端及三个恢复基类：`RunRecovery`、`DockerWorkerRecovery`、`RunModelRecovery`。恢复与执行子类共用停止和撤销代码，避免维护两套生命周期；恢复对象不需要虚设并发/模型/容器资源配置。

按已有数据库规则处理 stopping、停用账号或租约/期限失效的任务：取得文件占用，禁止继续执行，撤销模型授权，确认完整 worker 删除，保存文件检查点，提交终态并释放占用。已经终态但尚未释放文件占用的 journal 也会检查。正常且未到期的 running 任务不会仅因启动恢复入口而被停止；queued 保持排队，不自动重放。

错误响应、单次容器不存在、缺失 journal 都不是完整停止证据。恢复缺少 journal 时保留占用并报错；不得创建假的 removed 记录。journal 中任务 ID、控制器绝对目录、容器名与阶段必须匹配，复制到另一个根目录的记录也不能直接使用。状态目录是执行记录的一部分，不可用新建空目录替换，也不能通过删日志或锁文件“修复”恢复失败。

## 配置

要求 Linux、非 root 运行身份、同机 Docker Engine、已迁移 PostgreSQL，以及已启动私有控制通道的网关。入口固定使用 `/var/run/docker.sock`，不读取 Docker CLI 的远程 context/endpoint。网关仍不需要 Docker 权限。

| 环境变量 | 用途 |
|---|---|
| `DATABASE_URL` | 已有 Corilo 数据库，入口不自动迁移 |
| `CORILO_CLOUD_DATA` | 与网关一致的用户数据目录 |
| `CORILO_CONTROLLER_STATE` | 与原执行控制器一致的 journal 根目录 |
| `CORILO_MODEL_SOCKET_ROOT` | 与原模型出口一致的 socket 根目录 |
| `CORILO_HOST_CONTROL_SOCKET` | 网关私有控制 socket |
| `CORILO_HOST_CONTROL_TOKEN` | 网关与控制器共享的随机 64 位小写十六进制秘密 |
| `CORILO_CONTROLLER_POLL_MS` | 可选，默认 1000，范围 20–5000 毫秒 |
| `CORILO_CONTROLLER_RETRY_MS` | 可选，默认 5000，范围 100–60000 毫秒，且不小于轮询间隔 |

目录必须预先存在并为规范绝对路径。journal、模型 socket 根目录、宿主 socket 父目录均须当前用户所有且权限严格 0700；彼此及与用户数据目录不可重叠。宿主 socket 须当前用户所有且权限 0600。预检只读，不会自动创建、改权限或删除部署路径。

不需要 DeepSeek API key、模型选择、worker 镜像或新任务资源额度，因为本入口只有恢复能力。不要把控制 token 放入浏览器、Pi 配置、知识库或 worker。凭据由部署的秘密管理配置，日志不打印值或原始异常。

```sh
# 在部署环境已配置上述变量、目录和现有数据库后：
npm run start:controller
# 只执行一轮符合条件的恢复，然后退出：
npm run start:controller -- --once
```

默认循环先恢复，失败按间隔退避；新任务领取分支被跳过。SIGINT/SIGTERM 只请求关闭，等待正在进行的恢复完成，再释放控制器锁及数据库连接。相同 journal 目录只允许一个控制器持有锁；不能改个目录绕过单实例约束。

## 输出与失败

stdout 仅输出 `controller_recovery_loop_started` 或 `controller_recovery_pass_complete`。前者表示循环已启动，不代表网关鉴权、所有依赖和所有任务均正常；后者表示这一轮符合条件的检查已完成，不代表所有 worker 都停止。尚未到期的租约仍可能占用资源。

配置、启动、恢复、数据库和关闭失败只输出固定错误码，不透传路径、正文或凭据。`--once` 失败非零退出；循环发生失败会记录错误并退避，退出时保留非零状态，即使之后某轮成功，也不抹去本进程内已经发生的失败。数据库空闲连接错误触发有序关闭，避免绕过脱敏及清理。

控制 socket 丢失或拒绝请求时不强行释放占用。网关强杀遗留 socket、跨 PID 命名空间、丢失 journal、未知 Docker create 结果仍需按既有边界排查；不得把正常退出测试称为断电或完整强杀恢复。

## 实测范围

Node 检查覆盖配置/路径、恢复能力边界、缺失/复制/不匹配 journal 拒绝及模型授权清理。真实 PostgreSQL 检查覆盖 recoveryOnly 循环不执行领取逻辑，既有任务状态与鉴权检查继续保留。

实际 Docker + PostgreSQL + 独立网关与正式控制器进程验证：恢复既有后台 shell worker、撤销授权、确认容器删除、释放文件占用；错误的空 journal 根目录报错且真实 worker/占用保持；排队任务在单次恢复、循环及重启后都未被领取；第二个控制器被锁拒绝，SIGTERM 正常退出。未调用真实模型；生产进程权限、磁盘硬额度和完整灾备仍未验收。
