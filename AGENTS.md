# Corilo 可里开发约束

当前方向 v0.32（2026-11-10）：用户决定以 DeepSeek Harness 为主体，Corilo 提供笔记、待办/日程与后续记忆插件，首期个人自部署。先读 docs/README.md、PRODUCT.md、PRODUCT-SPEC.md、TECHNICAL_DESIGN.md、DESIGN.md，开发命令见 docs/DEVELOPMENT.md。用户新决定优先于旧 Pi/Files.md 云端要求；产品规则只在 PRODUCT-SPEC.md 维护。

视觉采用 Astryx Neutral 0.7.11 静态 token 子集与插件局部 CSS 适配，MIT notice 随包；固定 Harness 实测 React 18.3.1，而 Astryx React 组件要求 >=19，不得擅自升级宿主、另带 React 或声称已接入其组件。

笔记正文复用固定 CodeMirror 6 与 Lezer Markdown，不自行维护富文本数据模型或解析器。编辑仍输出普通 Markdown；即时标记显隐只影响呈现，保存回执保留光标和撤销历史，跨文档隔离撤销，组字期间暂停保存／格式操作。完整预览仍由 markdown-it／DOMPurify 负责，不能因编辑器接入放开 HTML 或主动外部资源。

用户最新收敛：笔记只要新建、查找、编辑、同目录改名和自动保存。明确移除笔记草稿库、恢复草稿、历史、回收站、删除入口、手动保存开关及单独原话捕获流程，不只是隐藏到次级入口。当前输入仅在会话内保留，未保存关闭时提醒；不承诺刷新／崩溃恢复。旧 IndexedDB 与历史目录保留但当前插件不读写，旧恢复代码只用于存量兼容；新启动不要求 stateRoot／Git。不得因旧规格或旧测试重新添加这些功能。待办同样移除草稿库／恢复、手动保存开关、重复新建表单、关联笔记和取消入口；仅保留新增、查找、编辑、完成／撤销及 JSON 导出。页面与工具共用 coreTodos 业务边界，版本检查和 UUID 幂等回执保持内部实现。旧 SQLite 取消记录和关联字段原样保留并包含在导出中，旧 IndexedDB 不读写、不删除；当前输入只在会话内保留。日期、日程、提醒、联动和自动记忆暂缓。

复用 Harness 自带 Web UI、模型设置、会话、默认工具与运行机制，不再新建 Corilo Agent loop、模型管理、权限审批或任务调度底座。模型初期 DeepSeek。优先独立插件和公开扩展点，固定开发者预览的兼容版本；接入文档与真实插件运行证据必须对应同一版本。工具插件不等于笔记编辑页面；代码存在不等于已在 Harness Web/手机验收。不将 Harness 工具中的执行计划 todo 当个人待办/日程，不将内存定时器当可靠提醒。

正文为普通 Markdown 与附件。首期常开电脑/主机本机磁盘作为工作目录，NAS 为独立备份目标；不把未经验证的 SMB/NFS 或双向同步目录宣称为可用工作目录。个人版不依赖 Supabase、Corilo 官方账号或 GitHub 绑定；远程访问鉴权、版本保护、资料导出与备份恢复仍需交付。Tailscale 为建议，尚未部署。用户已选 Linux 小主机/常开电脑为首个部署方向；具体硬件、发行版及远程方式未定，不能宣称所有 NAS 或移动端已兼容。

当前独立包为 plugins/notes（Markdown）与 plugins/todos（个人待办 SQLite）；两者页面/工具共用各自业务服务。待办不含日期/调度/通知，不能当可靠提醒已交付。新代码位于 plugins/；旧 app/host、app/cloud、app/vendor、android、prototype 和既有配置/数据原样保留，作为迁移前实现，不默认删除或转换数据。旧 Pi 会话、PostgreSQL 任务和 Harness 会话不是同一格式，不自动重放历史工具。品牌与兼容标识（.personalos/、personalos 字段、.local/xuye-prototype/、.xuye-local/ 等）保留。旧版本文档标注历史，不继续作为当前路线扩展。

使用现有 checkout，不擅自创建 worktree。保留其他改动；按已授权范围在开发分支提交推送，不 force-push。部署、公开可见性变更及破坏性操作需要对应授权。代码仓库与知识库分开。使用虚构资料和合成凭据测试，不提交或输出真实密钥和用户笔记。

仓库分层：plugins/notes 与 plugins/todos 保持独立 npm 包和锁文件；launcher/ 是源码组合入口及启动测试，不是第三个发行包；deploy/ 是人工审阅的部署示例；scripts/ 放开发工具与历史兼容脚本。scripts/corilo.mjs 保留转发以兼容已有命令和服务。根依赖/锁文件及 npm start/test 服务旧应用，不改作插件安装入口。当前文档留在 docs/，阶段记录及旧路线归 docs/history/；历史实现保留原目录，避免破坏既有路径。不要为此引入 workspace、共享运行包或迁移用户实例。

应用改动运行 npm test；新插件按其实际测试脚本执行，必须验证真实 Cordis/Harness 加载及工具调用，不能只用手写假 ctx 宣称接入通过。修改文件接口或 UI 时，另运行既有 python3 app/tests/browser_smoke.py、browser_review.py、browser_sync.py；它们仅保护旧 app，不替代新 Harness 插件页面的浏览器验收。保留 CSP，不改 vendor 掩盖失败。新插件的文件测试覆盖版本冲突、路径/链接拒绝及实际磁盘持久化。

修改旧云端代码时仍运行 npm run test:cloud，数据库只能是可丢弃 CORILO_TEST_DATABASE_URL；修改旧 worker/控制器另运行真实镜像+可丢弃 PostgreSQL 的 npm run test:worker。旧云端 AI 提交继续关闭，个人插件接入不构成开放该入口的授权。恢复控制器仅清理已有任务，缺失 journal 不代表 worker 已停止，详细边界见 app/cloud/CONTROLLER.md。

只有实际运行后才能记录通过。区分插件函数、真实 Cordis 工具、Harness 启动、浏览器、真实模型、手机及 NAS 证据。真实凭据缺失不阻止独立插件开发，但不能伪造供应商联调成功。提醒渠道、自动记忆策略、数据保留期和付费服务仍待决定，不擅自开通服务或发送邮件。
