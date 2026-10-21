# 云端文件服务（开发阶段）

已有邀请兑换、登录会话、每账号独立知识库、跨设备版本检查与知识库导出。身份验证使用 Supabase Auth 的邮箱/密码登录，应用不存密码；服务端使用 PostgreSQL 保存邀请、会话摘要与账号/库归属。**云端 AI 与 GitHub 同步接口禁用，不能把此文件服务当已具备 Agent 隔离的产品。**

当前入口只支持身份提供商中已经验证邮箱的账号；操作方需先在自己的 Supabase 项目完成账号开通/邮箱验证。应用没有公共注册、密码重置、邮箱投递或 OAuth 回调。不会替用户发送邀请邮件。管理员生成的 Corilo 邀请码是另一层应用准入，只能由绑定邮箱兑换，默认 72 小时有效。后续自助账号流程仍须联调完善。

## 启动

需要 Linux、Node 24、Git、util-linux 的 `flock`、PostgreSQL 和 Supabase Auth 项目。把下列环境变量放在部署环境的安全配置中，不能提交或贴到聊天：

| 变量 | 用途 |
|---|---|
| `DATABASE_URL` | 应用专用 PostgreSQL 连接串；远程连接使用验证证书的 TLS |
| `SUPABASE_URL` | 项目 HTTPS origin |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase publishable/anon key；不用 service-role key |
| `CORILO_PUBLIC_ORIGIN` | 完整 HTTPS 公网 origin，不能含路径 |
| `CORILO_CLOUD_DATA` | 专用持久数据目录，知识库不放应用代码仓库内 |
| `PORT` | 网关 loopback 端口，默认 3000 |

```bash
npm ci --ignore-scripts
# 使用独立数据库/角色；只显式初始化，不在每次启动自动改 schema。
npm run start:cloud -- --migrate
# 输出一个敏感的邀请码，操作者自行安全转交，不记录到日志或 Git。
npm run start:cloud -- --invite recipient@example.com
npm run start:cloud
```

身份配置缺失时启动失败，不回退到测试身份或匿名用户。数据表位于 `corilo_private` schema，不应暴露到 Supabase 浏览器 Data API；控制数据库凭据只给服务端。邀请码和应用会话仅存 SHA-256 摘要。

网关只监听 `127.0.0.1`，由同机 HTTPS 反向代理接入，代理必须保留正确 Host，且不得缓存页面、API、登录响应和下载。网关严格检查配置的 Host、Origin，以及写请求来源；不相信客户端传来的用户 ID、内部宿主 token 或 X-Forwarded-For。生产会话使用 `__Host-`、HttpOnly、Secure、SameSite=Strict cookie，24 小时有效；退出撤销当前会话，停用账号在下一请求生效。HTTP 仅允许 `127.0.0.1` 开发用途，未增加生产不安全 cookie 模式。

每个账号创建的知识库由服务端生成 UUID 并在数据库中绑定归属，正文与状态分目录保存。底层复用本机文件宿主，网关内部注入宿主凭证，不把凭证交给浏览器。文件宿主在云端模式不实例化 Pi，不读取运营者的 Pi 密钥或调用 Git 同步。每实例当前最多保留 20 个文件宿主，直到正常退出；满额返回明确错误。不是多节点或自动扩容实现。

## 检查

```bash
# 指向可丢弃的测试数据库；真实密码从环境注入。
# 先单独配置 CORILO_TEST_DATABASE_URL，绝不要从生产 DATABASE_URL 直接复用。
npm run test:cloud
```

不要将上例指向生产数据库：测试会创建虚构账号和邀请。测试需要 Python Playwright/Chromium；安装方式见根 README。检查使用真实 PostgreSQL、真实文件宿主、真实 Chromium 登录/原话保存/下载/退出与第二设备刷新；只有身份提供商使用合成响应，另测试 Supabase adapter 的响应校验。测试替身只在测试文件中注入，正式 CLI 不提供绕过身份开关。

CI 使用独立 PostgreSQL 容器，见 `.github/workflows/cloud.yml`。工作流存在不等于远端已通过。

## 限制与下一步

- 未联调真实 Supabase、未上线 HTTPS、未实测 Android/iPhone 浏览器；390px Chromium 不是手机验收。
- 账号预开通、邀请撤销/禁用目前由操作方管理数据库；没有管理控制台，密码恢复依赖身份提供商。
- 单机文件服务；Linux 内核锁随进程退出释放。只有明确标记为 cloud-files 且原 PID 已不存在的旧宿主锁可自动恢复；活跃、未知、本机 Pi 或旧版本锁拒绝抢占。要求同机本地文件系统及同一 PID 命名空间，不支持多个容器用独立 PID 空间共享库。不要删除 `.corilo-host.flock`，也不自动清理 Git 的锁或宣称支持写 Git 中途的完整崩溃恢复。持久任务状态服务已有基础，内部 Docker worker 与恢复已接入，边界和剩余缺口见下。
- 自动登录重定向只在未登录首页触发；编辑中会话过期保留草稿并显示重新登录错误，不强制丢弃页面。
- 已有文件写入 ETag 及删除/移动的来源版本保护：缺失或过期的 expected 被拒绝，目录版本涵盖后代元数据；界面保留实际读取的版本，冲突需刷新核对。完善导入、账号删除、独立备份和历史恢复 UI 尚待补齐。完整 N01–N19 仍未验收。
- 登录限流每连接来源地址 5 分钟 30 次，在同机代理后可能共享额度；需在实际入口配置受信任的客户端限流。不要直接信任任意 forwarded headers。
- 现有 Files.md 适配依赖 inline scripts，公网安全审查及 CSP 收紧仍需完成。当前结果不代表可直接公开邀请上线。

## 内部持久任务基础

`--migrate` 同时创建 conversations、runs、run_events、model_grants、model_reservations。`runs.mjs` 提供控制面内部的会话、幂等提交、状态/事件读取、领取、心跳、停止及恢复状态管理；要求显式配置队列、并发、租约和时长，测试覆盖真实 PostgreSQL。`npm run test:cloud` 顺序运行文件/身份、任务、模型调用额度和真实 Pi/合成模型出口集成测试，共用可丢弃数据库。

当前网关只开放所属账号的会话查看与停止，不开放任务创建/提交；CLI 不启动调度器，也没有启用云端 AI 的参数。内部 Docker worker 控制器已连接 Runs、文件宿主持久占用和按会话隔离的状态目录，另有真实容器测试。内部模型出口与任务调用额度已通过单任务 socket 连接 worker；会话读取与停止已连接，任务提交尚未开放；任务状态不能作为真实进程已终止的证明。运行及限制见 [worker 说明](worker/README.md)。

## 内部模型出口

`ModelGrants` 将限任务、限模型身份及请求次数/输出 token 预留保存在 PostgreSQL；`startModelRelay` 提供有界的 DeepSeek 兼容流式协议，平台密钥只在可信出口使用。现有 CLI 不启动出口，不新增启用公网 AI 的开关。真实 Pi 默认文件工具已通过正式 Docker 入口与合成上游协议检查，没有调用真实 DeepSeek；完整费用计量、持久磁盘额度、公共任务提交与部署仍缺失。边界见 [模型出口说明](MODEL-OUTLET.md)。

## 后续组件接入

成熟组件选型见 [技术设计第 17 节](../../docs/TECHNICAL_DESIGN.md#17-成熟组件选型与接入边界2026-10-21)。首期保留内部应用会话和 Runs；接 Supabase 官方身份操作、Docker worker、Caddy/Compose 与 restic 备份。当前没有 SDK 迁移、生产镜像、部署配置或备份交付，不能直接按目标拓扑启动。

特别注意：Supabase 管理台停用身份或重置密码不会自动删除当前 Corilo 应用会话；目前停用须落实到 Corilo 账号状态，后续恢复密码流程需要接应用会话撤销。网关仍固定 loopback，Caddy 与网关分容器前需实现受控 bind 配置，不能通过放宽 Host/Origin 检查解决连接问题。

## 对话查看与停止

登录后 `GET /api/conversations?before=<会话UUID>&limit=25` 按时间分页（1–100 条），`GET /api/conversations/:id` 返回最多 25 个最近任务及已保存的 Pi 用户/助手文本。服务端从账号推导知识库路径，分页游标也须属于当前账号；不接收 owner 或磁盘路径。`POST /api/runs/:id/stop` 要求正常 Cookie 和同源 Origin。排队取消直接进入 stopped；运行任务先进入 stopping，必须由控制器确认 worker 退出后才结束。CLI 未启动控制器时不会自行完成运行任务的停止。

网页可选对话、加载更早记录、刷新任务状态和停止；保留输入/编辑草稿，最多显示最近 500 条消息，不自动重放任务。新 AI 提交仍禁用。

读取使用 Pi 原生当前分支投影，过滤工具结果、思考块与错误诊断；不修改或迁移会话文件，不是完整会话归档。Linux 文件描述符逐级锚定目录，拒绝软/硬链接与特殊文件，读取限制 4 MiB/2000 行。该知识库有 queued/running/stopping 任务时暂停正文读取；缺失正文显示空，损坏/过大/多个 session 文件显示暂不可用，任务状态仍可查看。Pi 压缩前文本不保证展示，图片附件暂不渲染。

当前开发 `/workspace` 为 overlay，未验证项目配额支持。bind mount、容器根层大小限制或定期目录大小统计都不限制用户持久目录的即时写入；持久磁盘硬额度仍是开放 Agent 前的缺口。

## 内部调度生命周期

`hosts.mjs` 由网关复用，集中管理所属账号的文件宿主，限制容量、复用并发初始化并等待初始化中的宿主关闭。`forRun` 仅供可信控制面按持久任务归属取得同一宿主，停用账号仍可恢复，不是浏览器接口。

`scheduler.mjs` 的 `startScheduler({controller, concurrency, pollMs, retryMs, onError})` 返回 `status()` 和幂等的 `close()`，先获取控制器锁并执行恢复，再领取有界批次。失败退避，关闭不再领取；等待恢复操作结束及活跃执行停止，失败明确报错，不自动重放任务或清除占用。错误回调只有阶段码，不含正文/异常诊断。并发受 Runs 全局额度再次限制；当前每批等待最慢任务，不保证满负载吞吐。`status().active` 是本批执行调用数，不等于数据库中的活跃 worker 总数。

该模块尚无生产 CLI。生产网关不得得到 Docker socket；独立控制器尚需鉴权的文件宿主通信，不能同时打开第二个宿主。真实容器测试内共用 registry 验证生命周期，不冒充独立服务已部署。

持久硬额度仍未实现；[只读存储诊断与实施条件](storage-quota.md) 可用于核实部署准备，不能据诊断结果开放 AI。
