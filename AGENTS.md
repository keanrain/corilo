# Corilo 可里开发约束

先读 docs/README.md、PRODUCT.md、PRODUCT-SPEC.md、TECHNICAL_DESIGN.md、DESIGN.md。当前依据 v0.14（2026-10-21）：云端个人记忆与行动助手，简单使用、资料可带走；完整 Files.md 页面/编辑器、服务端 Pi 默认能力、初始 DeepSeek；邀请制小范围使用，每人独立知识库。桌面/Android/iPhone 使用响应式网页。暂停本地启动器和 Android 集成 APK；GitHub 不再是客户端同步或使用前提。

用户要求简单、一体化、直接开发正式应用。模型认证与选择直接复用 Pi 标准配置（含 PI_CODING_AGENT_DIR），不另做配置表单、不复制模型配置或强制选模型。不新增替代 demo，不为 Pi 另做权限、逐文件审批、事务写入或模型管理框架；不恢复旧 Today/Bot 原型；记忆、待办、一次性提醒按最新规格分阶段实现，通知不得以模型承诺代替可靠调度。新增云端账户、跨设备访问与用户隔离按 v0.14 实现；隔离、额度和平台凭据保护属于服务端边界，不是另造 Pi 工具权限框架。系统提示词约束行为，不把 cwd 宣称为沙箱。产品规则仅在 docs/PRODUCT-SPEC.md 维护，其他文档不得创建平行 PRD。

当前正式代码位于 app/：完整 Files.md 页面以原样 vendor＋适配层接入磁盘宿主，Pi 默认 SDK 和本地 Git 历史、GitHub 同步与冲突 UI 已接入（临时远端/Linux 检查）；真实 GitHub 凭据联调、分发安装包与 APK 尚未完成。当前优先云端改造，但现有 app/ 仍是本机宿主，不能只改监听地址就宣称可公网多用户部署。账号鉴权、文件归属检查、执行隔离、持久任务和额度均待实现。android/ 暂停并保留，仅手动 CI；禁止用缺失 runtime 的空壳 APK 冒充可用版本。prototype/ Python 原型继续保留，不作为正式入口扩展。p0/ 的片段、候选和历史日志不代表正式实现。docs/upstream-baseline.json 是调查基线；实际依赖锁为 package-lock.json，完整 Files.md 来源记录在 app/vendor/filesmd/SOURCE.json。只有真实运行后才写通过，区分函数、浏览器、模型、桌面及 Android 真机证据。

使用现有 checkout；用户未要求时不创建 worktree。保留现有改动、历史、许可与兼容标识，包括 .personalos/、personalos 字段、.local/xuye-prototype/、.xuye-local/、库识别和会话键，不因品牌替换迁移用户数据。

开发验证使用虚构资料，不硬编码凭据。按已授权范围在开发分支提交推送，不 force-push、不覆盖他人修改。部署、仓库可见性修改及破坏性操作须有对应授权。知识库仓库与代码仓库分开。

应用改动运行 npm test，并对文件接口或 UI 改动运行 python3 app/tests/browser_smoke.py 、python3 app/tests/browser_review.py 与 python3 app/tests/browser_sync.py。浏览器脚本使用系统 Chromium 或已安装的 Playwright Chromium，保存失败不得降低 CSP 来通过测试。vendored 上游默认保持原样，接入改动集中在 app/host 和 app/web；若修改上游文件，记录补丁与来源差异。

仅在实际修改 Android Java/打包实现时，另运行 android/tests/test_payload.py 和 InstallerChecks.java（见 android/README.md）。自定义 Termux runtime 构建应使用至少预留 80 GiB 的专用构建机；当前 32 GB 云盘两次在容器准备阶段耗尽空间，已清理本次容器。Java 编译/宿主归档检查不等于 Android 执行验收。

云端业务验收使用 N01–N19，旧 C 系列与本地测试不替代云端验收。正式产品规则只在 PRODUCT-SPEC.md 更新，其他文件引用或解释实现。先完成邀请登录与云端文件纵向链路，再接隔离执行的 Pi；不把尚未实现的云端模式写成可运行命令。
