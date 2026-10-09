# Corilo 可里开发约束

先读 docs/README.md、PRODUCT.md、PRODUCT-SPEC.md、TECHNICAL_DESIGN.md、DESIGN.md。当前依据 v0.12（2026-10-09）：完整 Files.md 页面/编辑器、去掉 Bot/Worker、Pi 默认能力、初始 DeepSeek、GitHub 私有知识库同步。桌面 Windows/macOS Chrome 加自动启动器，Android 集成 APK；iOS 与 Supabase 后置。

用户要求简单、一体化、直接开发正式应用。不新增替代 demo，不为 Pi 另做权限、逐文件审批、事务写入或模型管理框架；不恢复旧 Today/通知/云同步服务范围。系统提示词约束行为，不把 cwd 宣称为沙箱。产品规则仅在 docs/PRODUCT-SPEC.md 维护，其他文档不得创建平行 PRD。

当前可运行的只是 prototype/ Python 本地原型。完整上游页面、Pi、Git 同步与 APK 尚未集成。p0/ 的片段、候选和历史日志不代表正式实现。docs/upstream-baseline.json 是调查基线，不是已安装依赖锁。只有真实运行后才写通过，区分函数、浏览器、模型、桌面及 Android 真机证据。

使用现有 checkout；用户未要求时不创建 worktree。保留现有改动、历史、许可与兼容标识，包括 .personalos/、personalos 字段、.local/xuye-prototype/、.xuye-local/、库识别和会话键，不因品牌替换迁移用户数据。

开发验证使用虚构资料，不硬编码凭据。按已授权范围在开发分支提交推送，不 force-push、不覆盖他人修改。部署、仓库可见性修改及破坏性操作须有对应授权。知识库仓库与代码仓库分开。
