# Corilo 可里开发约束

先读 docs/README.md、PRODUCT.md、PRODUCT-SPEC.md、TECHNICAL_DESIGN.md、DESIGN.md。当前依据 v0.16（2026-10-21）：云端个人记忆与行动助手，简单使用、资料可带走；完整 Files.md 页面/编辑器、服务端 Pi 默认能力、初始 DeepSeek；邀请制小范围使用，每人独立知识库。桌面/Android/iPhone 使用响应式网页。暂停本地启动器和 Android 集成 APK；GitHub 不再是客户端同步或使用前提。

用户要求简单、一体化、直接开发正式应用。模型认证与选择直接复用 Pi 标准配置（含 PI_CODING_AGENT_DIR），不另做用户模型配置表单或强制覆盖已有模型。本机模式复用原配置、不复制认证；云端使用各用户执行环境的 Pi 原生配置，由服务端管理，不能挂载运营者本机的共享认证目录。不新增替代 demo，不为 Pi 另做权限、逐文件审批、事务写入或模型管理框架；不恢复旧 Today/Bot 原型；记忆、待办、一次性提醒按最新规格分阶段实现，通知不得以模型承诺代替可靠调度。新增云端账户、跨设备访问与用户隔离按 v0.16 实现；隔离、额度和平台凭据保护属于服务端边界，不是另造 Pi 工具权限框架。系统提示词约束行为，不把 cwd 宣称为沙箱。产品规则仅在 docs/PRODUCT-SPEC.md 维护，其他文档不得创建平行 PRD。

当前正式代码位于 app/：完整 Files.md 页面以原样 vendor＋适配层接入磁盘宿主，Pi 默认 SDK 和本地 Git 历史、GitHub 同步与冲突 UI 已接入（临时远端/Linux 检查）；真实 GitHub 凭据联调、分发安装包与 APK 尚未完成。当前优先云端改造，app/host/ 保留本机宿主；不能只改监听地址就宣称可公网多用户部署。app/cloud/ 已实现首条邀请/会话/独立文件服务链路，真实 PostgreSQL/Chromium 与合成身份检查通过；已有内部持久任务、Docker worker 控制器和持久文件写入协调，真实容器默认 Pi 工具检查通过；内部模型出口与持久任务调用额度已加入，真实 Pi/合成上游协议检查通过；出口已通过单任务 Unix socket 连接无通用网络的 worker，真实容器合成模型文件链路通过；网关已接入所属账号的会话查看与停止接口，仍不开放任务提交；已有内部有界调度生命周期及共享文件宿主管理，停止失败会保留占用并报错；网关已支持私有 Unix 控制通道，独立控制器客户端可操作同一宿主；恢复控制器 CLI 已接入，缺失或归属不匹配的 journal 拒绝确认停止；真实 Supabase/DeepSeek、完整费用计量及持久磁盘额度未完成，公网 Agent 仍禁用。android/ 暂停并保留，仅手动 CI；禁止用缺失 runtime 的空壳 APK 冒充可用版本。prototype/ Python 原型继续保留，不作为正式入口扩展。p0/ 的片段、候选和历史日志不代表正式实现。docs/upstream-baseline.json 是调查基线；实际依赖锁为 package-lock.json，完整 Files.md 来源记录在 app/vendor/filesmd/SOURCE.json。只有真实运行后才写通过，区分函数、浏览器、模型、桌面及 Android 真机证据。

使用现有 checkout；用户未要求时不创建 worktree。保留现有改动、历史、许可与兼容标识，包括 .personalos/、personalos 字段、.local/xuye-prototype/、.xuye-local/、库识别和会话键，不因品牌替换迁移用户数据。

开发验证使用虚构资料，不硬编码凭据。按已授权范围在开发分支提交推送，不 force-push、不覆盖他人修改。部署、仓库可见性修改及破坏性操作须有对应授权。知识库仓库与代码仓库分开。

应用改动运行 npm test，并对文件接口或 UI 改动运行 python3 app/tests/browser_smoke.py 、python3 app/tests/browser_review.py 与 python3 app/tests/browser_sync.py。浏览器脚本使用系统 Chromium 或已安装的 Playwright Chromium，保存失败不得降低 CSP 来通过测试。vendored 上游默认保持原样，接入改动集中在 app/host 和 app/web；若修改上游文件，记录补丁与来源差异。

仅在实际修改 Android Java/打包实现时，另运行 android/tests/test_payload.py 和 InstallerChecks.java（见 android/README.md）。自定义 Termux runtime 构建应使用至少预留 80 GiB 的专用构建机；当前 32 GB 云盘两次在容器准备阶段耗尽空间，已清理本次容器。Java 编译/宿主归档检查不等于 Android 执行验收。

云端业务验收使用 N01–N19，旧 C 系列与本地测试不替代云端验收。正式产品规则只在 PRODUCT-SPEC.md 更新，其他文件引用或解释实现。先完成邀请登录与云端文件纵向链路，再接隔离执行的 Pi；不把尚未实现的云端模式写成可运行命令。

云端改动运行 `npm run test:cloud`，必须使用可丢弃 PostgreSQL 数据库（CORILO_TEST_DATABASE_URL），不可指向生产库。正式 CLI 不允许测试身份绕过。云端文件模式在执行隔离完成前禁止开放 Agent；账户文件路由隔离不等于 shell 隔离。

文档对齐：PRODUCT-SPEC 第 0 节区分 Agent run、用户 todo、日程 event 与 reminder，第 8 节集中待定决策。技术设计第 8 节是阶段计划、第 11 节是当前证据，第 9/10 节是历史快照，不覆盖现状。技术设计第 12–16 节是未实现的详细方案，默认 Pi bash 通过普通 CLI 调用领域 API，不能误写为已可运行命令。不得把提醒渠道、自动记忆策略、自托管交付日期或数据桥接方案写成用户已确认选择。

成熟组件路线见技术设计第 17 节：Supabase 官方身份操作配合现有 HttpOnly 应用会话；首期 Runs/PostgreSQL 为唯一业务任务状态，暂不叠 pg-boss/Redis；Docker 是首个 worker 后端，worker 不再启动 startHost；Caddy/Compose 和 restic 为待接入方案。保留启动/停止互斥及文件写入协调，不用队列超时或一次容器不存在检查代替真实停止确认。不得把来源核验写成实际集成通过，也不得擅自开通套餐或发送邮件。

修改 worker/控制器时，另以可丢弃 PostgreSQL 和实际 Docker 镜像运行 `npm run test:worker`；见 app/cloud/worker/README.md。无网络工具测试不替代真实模型出口和完整隔离验收。

内部模型出口见 app/cloud/MODEL-OUTLET.md。预留输出 token/请求次数不是实际费用计量；真实 Pi 对合成 SSE 的检查不是真实 DeepSeek 验收。平台长期密钥只留可信出口，不能为了连接模型放开 worker 通用外网或宿主网络。

持久磁盘额度诊断见 app/cloud/storage-quota.md；storage-preflight 只读且永远不宣称 enforcement 已验证。项目配额须另外验证 worker 无法修改项目 ID/继承，不能仅据非 root/cap-drop 或挂载标记开放 AI。scheduler.mjs 已接独立恢复 CLI（start:controller），只恢复不领取新任务；不得为了共享宿主对象而将 Docker socket 交给公网网关。

文件宿主控制通道见 app/cloud/HOST-CONTROL.md：控制 token 只属于可信控制器，不能传给 worker/浏览器。控制器须先确认 worker 停止再 checkpoint/release；网关停止不等于 worker 停止。socket 正常关闭会清理，强杀后的既有路径不得自动删除。独立进程测试不代表生产权限隔离已验收。

恢复入口见 app/cloud/CONTROLLER.md。start:controller 只处理已有任务，不领取、不启动、不签发模型身份；无需伪造执行额度。journal 是恢复证据，根目录必须与原控制器一致，缺失不能当作容器已停止。--once 完成只表示符合条件的一轮检查完成，不代表所有 worker 都已停止。
