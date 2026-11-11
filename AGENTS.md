# Corilo 可里开发约束

当前方向 v0.33（2026-11-11）：用户决定将 files.md 完整前端移植进 Harness，保留其菜单和功能，后续再决定裁剪；笔记、清单、待办、日记收敛为一个工作区插件，机器人能力使用 Harness Agent。先读 docs/README.md、PRODUCT.md、PRODUCT-SPEC.md、TECHNICAL_DESIGN.md、DESIGN.md，命令见 docs/DEVELOPMENT.md。

当前默认前端是 plugins/notes/vendor/filesmd 固定版本的原生 HTML／JS／CSS 与 CodeMirror 5／HyperMD，在独立 iframe 文档中运行，通过 Harness 鉴权路由和 workspace/ 适配主机文件。保留 vendor 原文，安全、宿主生命周期和存储差异通过 workspace-api.mjs 的校验式运行时转换与适配层实现，保留来源和全部第三方许可。不直接接入 Go 同步、Telegram 或旧 Pi，不外联上传资料，不放宽整个宿主的 CSP。

旧 CodeMirror 6／Astryx 笔记页通过 interface: classic 保留兼容；其测试不是当前 Files.md 工作区的验收。之前的极简界面和删减规则已由用户最新决定替代，不再据此裁掉 Files.md 菜单。当前界面和 Agent Markdown 工具共用 NotesStore 及其队列；WorkspaceStore 扩展目录、附件和设置文件操作，浏览器不直接访问磁盘，不建设第二个 Agent loop。

新源码实例只加载 @corilo/dsh-notes 工作区包，plugins/todos 0.5.2 作为存量 SQLite 兼容包保留。旧双插件配置继续可启动，不自动重写配置、迁移或删除数据。corilo-import-todos 默认只预览，--apply 显式导入 Later.md；运行前停止旧服务并备份。原 SQLite 只读，已取消记录、关联及原字段保存在迁移记录里；可恢复的迁移日志防重复追加，原数据库和旧浏览器资料保持。不得自动重放旧任务或通知。

复用 Harness 自带 Web UI、模型设置、会话、默认工具与运行机制，不再新建 Corilo Agent loop、模型管理、权限审批或任务调度底座。模型初期 DeepSeek。优先独立插件和公开扩展点，固定开发者预览的兼容版本；接入文档与真实插件运行证据必须对应同一版本。工具插件不等于笔记编辑页面；代码存在不等于已在 Harness Web/手机验收。不将 Harness 工具中的执行计划 todo 当个人待办/日程，不将内存定时器当可靠提醒。

正文为普通 Markdown 与附件。首期常开电脑/主机本机磁盘作为工作目录，NAS 为独立备份目标；不把未经验证的 SMB/NFS 或双向同步目录宣称为可用工作目录。个人版不依赖 Supabase、Corilo 官方账号或 GitHub 绑定；远程访问鉴权、版本保护、资料导出与备份恢复仍需交付。Tailscale 为建议，尚未部署。用户已选 Linux 小主机/常开电脑为首个部署方向；具体硬件、发行版及远程方式未定，不能宣称所有 NAS 或移动端已兼容。

当前主包是 plugins/notes（Files.md 工作区）；plugins/todos 保留为旧实例兼容。Markdown 勾选清单不是可靠提醒，日期/调度/通知并未因此交付。新代码位于 plugins/；旧 app/host、app/cloud、app/vendor、android、prototype 和既有配置/数据原样保留，作为迁移前实现，不默认删除或转换数据。旧 Pi 会话、PostgreSQL 任务和 Harness 会话不是同一格式，不自动重放历史工具。品牌与兼容标识（.personalos/、personalos 字段、.local/xuye-prototype/、.xuye-local/ 等）保留。旧版本文档标注历史，不继续作为当前路线扩展。

使用现有 checkout，不擅自创建 worktree。保留其他改动；按已授权范围在开发分支提交推送，不 force-push。部署、公开可见性变更及破坏性操作需要对应授权。代码仓库与知识库分开。使用虚构资料和合成凭据测试，不提交或输出真实密钥和用户笔记。

仓库分层：plugins/notes 是当前工作区包，plugins/todos 保留独立锁文件维护旧实例；launcher/ 是源码入口及启动测试，不是第三个发行包；deploy/ 是人工审阅的部署示例；scripts/ 放开发工具与历史兼容脚本。scripts/corilo.mjs 保留转发以兼容已有命令和服务。根依赖/锁文件及 npm start/test 服务旧应用，不改作插件安装入口。当前文档留在 docs/，阶段记录及旧路线归 docs/history/；历史实现保留原目录，避免破坏既有路径。不要为此引入 workspace、共享运行包或迁移用户实例。

应用改动运行 npm test；新插件按其实际测试脚本执行，必须验证真实 Cordis/Harness 加载及工具调用，不能只用手写假 ctx 宣称接入通过。修改文件接口或 UI 时，另运行既有 python3 app/tests/browser_smoke.py、browser_review.py、browser_sync.py；它们仅保护旧 app，不替代新 Harness 插件页面的浏览器验收。保留 CSP，不改 vendor 掩盖失败。新插件的文件测试覆盖版本冲突、路径/链接拒绝及实际磁盘持久化。

修改旧云端代码时仍运行 npm run test:cloud，数据库只能是可丢弃 CORILO_TEST_DATABASE_URL；修改旧 worker/控制器另运行真实镜像+可丢弃 PostgreSQL 的 npm run test:worker。旧云端 AI 提交继续关闭，个人插件接入不构成开放该入口的授权。恢复控制器仅清理已有任务，缺失 journal 不代表 worker 已停止，详细边界见 app/cloud/CONTROLLER.md。

只有实际运行后才能记录通过。区分插件函数、真实 Cordis 工具、Harness 启动、浏览器、真实模型、手机及 NAS 证据。真实凭据缺失不阻止独立插件开发，但不能伪造供应商联调成功。提醒渠道、自动记忆策略、数据保留期和付费服务仍待决定，不擅自开通服务或发送邮件。
