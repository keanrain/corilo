# 文件宿主控制通道

2026-10-22。已接入内部 Unix socket 通信，不是公网 Agent 提交入口，也不是完整调度服务部署。

网关进程持有 `CloudHosts` 和知识库文件锁；独立可信控制器持有 Docker 权限，通过本通道请求文件占用、检查点和释放。两者无需共用 JavaScript 对象，控制器不再打开第二个文件宿主。网关代码不导入 Docker 控制器；实际部署仍须给进程/容器分配正确权限，测试进程分离不代表操作系统权限隔离已验收。

## 网关配置

`npm run start:cloud` 默认不监听控制 socket。可选同时设置：

- `CORILO_HOST_CONTROL_SOCKET`：绝对规范路径，长度不超过 100 字节，位于 `CORILO_CLOUD_DATA` 外。
- `CORILO_HOST_CONTROL_TOKEN`：由运营秘密管理提供的随机 32 字节值，以 64 位小写十六进制表示；不能复用登录 Cookie 或模型身份。

父目录须预先存在，归当前用户且权限严格为 0700；socket 创建为 0600。当前要求两端能以匹配的文件权限访问该目录，属于同机 Linux 通道。token 只配置给可信网关和控制器，不进入浏览器、worker、Pi 配置、知识库或日志。配置一个而遗漏另一个会拒绝启动；配置本通道不会启用调度或 AI 提交。

启动时拒绝既有 socket 路径，不自动删除。正常关闭会移除监听 socket；强杀可能留下路径，须先确认旧监听者已退出，再由操作方处理。尚未实现自动强杀恢复，跨容器 PID 命名空间的文件宿主恢复限制仍然存在。

## 固定协议

使用 Unix HTTP，只有 `POST /runs/<UUID>/<操作>`，Authorization 为 Bearer 控制 token，Content-Type 为 application/json，正文严格为 `{}`。不接收 owner、目录、容器参数或任意命令；数据库推导该 run 的 owner/vault/conversation。拒绝查询串和浏览器来源/会话请求头。

| 操作 | 条件 | 响应 |
|---|---|---|
| begin | running 或 stopping | `{ "ok": true }`；同一占用幂等 |
| checkpoint | running/stopping 或终态；可信控制器已确认 worker 停止 | `{ "ok": true }` |
| release | 必须为数据库终态，且当前占用为空或精确属于该任务 | `{ "ok": true }` |
| status | 存在该任务 | `{ "active": true/false }`；只说明该任务是否持有占用 |

控制 token 是可信控制器级权限，不是租户 token。文件宿主不接 Docker，因此不能自行证明 worker 已停止；控制器仍必须先撤销出口、确认完整容器删除，再请求 checkpoint、提交数据库终态、release。仅有状态码或数据库终态不能替代实际停止证据。停用账号仍可由可信控制器清理任务。

每任务请求串行，状态在排队后重新读取，防止迟到 begin 重新打开终态占用。旧任务 release 不能释放另一个任务的占用。响应不返回文件宿主 token、地址、正文或平台诊断。正文最多 1 KiB，最多 128 个处理中的请求；接收正文限时，Git/磁盘操作仍须等待实际结束。

## 控制器使用

`new HostControlClient({socketPath, token, timeoutMs})` 的 `forRun(claim)` 返回已有控制器所需的方法。调用 `new ExecutionController({..., hostFor: claim => client.forRun(claim)})` 即可复用；`activeRunId()` 现在可异步，控制器恢复路径已等待结果。客户端响应最多 4 KiB，默认总时限 30 秒，不接受重定向，不自动重试。

断连或超时表示结果未确认，服务端操作可能仍完成。不得立即清掉占用或重放 prompt；继续由现有控制器恢复机制核对。关闭通道先停止接收，再等待已经授权的真实操作结束；关闭 HTTP 连接不能代替完成文件变更。网关关闭本身不代表 worker 已停止，持久占用会在正常重启后继续阻止编辑。

## 本轮证据与缺口

真实 Unix socket 检查覆盖错误凭据、非法字段/协议、超限响应/总时限、丢失响应不重试、断连操作仍完成、关闭等待、排队后重新鉴权和错误脱敏。真实 PostgreSQL 与独立网关子进程验证任务状态约束、正常重启保留占用、停用账号恢复、迟到 begin 与旧 release 拒绝；公开 HTTP 不提供控制能力，AI 提交仍返回禁用状态。

真实 Docker 调度检查使用独立网关进程与本客户端，运行 Pi 默认文件工具及后台 shell，正常重启网关后占用仍在，随后调度器关闭会停止完整容器并释放占用。原生产 Pi/合成 SSE 模型链路测试继续保留，没有调用真实 DeepSeek。

完整控制器 CLI、生产进程权限/容器重建/强杀验收、持久磁盘硬额度、真实身份与模型、费用计量及部署仍未交付。不要用 socket 接通代替这些验收。
