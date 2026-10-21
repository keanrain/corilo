# 内部 Docker worker（2026-10-21）

这是云端 Agent 的内部执行基础，不是可上线的 AI 服务。公共网关仍禁用 Agent；没有启用参数。worker 只运行现有 Pi SDK，默认文件/bash 工具和配置格式不变，不启动文件宿主。

## 开发验证

需要 Linux、Docker Engine、本地文件系统、Node 24、非 root 构建用户和可丢弃 PostgreSQL。Docker API 权限只能交给可信控制器。容器和控制器使用同一台机器的绝对挂载路径。

```sh
npm ci --ignore-scripts
# 普通环境；需要代理 CA 的环境额外传 BuildKit proxy_ca secret。
docker build -f app/cloud/worker/Dockerfile -t corilo-worker:test .
export CORILO_TEST_WORKER_IMAGE="$(docker image inspect --format '{{.Id}}' corilo-worker:test)"
# CORILO_TEST_DATABASE_URL 必须由调用方指向可丢弃测试数据库。
npm run test:worker
```

测试使用虚构资料、真实 Docker/PostgreSQL 和固定依赖版本的 Pi 默认工具。测试专用 entrypoint 验证 read/write/edit/bash、后台进程停止、只读根和 Git/宿主锁挂载、无网络、临时空间上限、停止与创建竞争、创建响应丢失后延迟创建、文件宿主重启和终态提交后文件占用释放。另运行正式 entrypoint，确认没有模型凭据时失败；没有实际模型调用。CI 包含构建与检查，远端结果以 Actions 为准。

## 控制边界

- `ExecutionController` 通过 Linux flock 保证同一 journalRoot 单实例；可信 `hostFor` 必须用数据库归属解析宿主。当前是内部对象接口，尚无独立控制器服务/RPC 或启动调度器。
- `DockerWorkers` 只接受不可变镜像与显式 CPU、内存、PID、临时空间额度。每次 run 挂载该库正文、该会话状态、只读 Pi 配置和单个请求，不挂载整个用户根目录、Docker socket 或平台密钥。
- 非 root、只读根、cap-drop、禁止提权、默认 seccomp、无网络、禁止重启、关闭 Docker 日志；Git 元数据和宿主锁用嵌套只读挂载保护。云端 Git 禁用全局配置和 hooks。
- 启动意图先持久化；启动/停止串行。创建结果未知且尚未发现容器时保留占用，不把不存在当作已停止。确认整个容器删除后才提交文件历史、结束任务、释放文件占用。请求文件随后清理，恢复不重放 prompt。
- 文件占用保存在可信宿主配置目录，重启后仍禁止文件修改和导出；终态提交后未释放的占用也可恢复。文件占用记录损坏或写入失败时保持关闭，需操作方检查，不能直接删锁继续执行。

## 仍未完成

无网络 worker 无法访问 DeepSeek。[内部模型出口与任务调用额度](../MODEL-OUTLET.md) 已实现，尚未连接 worker。下一阶段须接单任务连接路径、身份与 Pi 配置装配、完整费用预算，以及知识库/会话持久磁盘硬额度。不能把 bind mount 或 tmpfs 上限当作持久磁盘额度。

尚未验证真实模型、带出口网络的 IPv4/IPv6/DNS/相邻容器隔离、内存 OOM/PID 压力、控制器进程 SIGKILL、断电/磁盘故障和完整备份恢复。测试重建控制器对象和真实重启文件宿主，不冒充完整控制器崩溃验收。Docker 共享内核，不是公开不可信代码的绝对安全边界。journal 的归档/未知结果人工恢复流程、会话展示、前端重连、账号删除及完整 N01–N19 验收仍待实现。
