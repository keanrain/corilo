# @corilo/learn-anything 变更记录 / Changelog

此文件记录当前可分发代码，不代表已经发布 npm。后续每个版本单独记录变更与兼容边界。

This records currently distributable code, not an npm publication. Maintain changes and compatibility boundaries separately for each future version.

## Unreleased / 未发布

- 更快入门：目标接入只问学什么、为什么学；大纲先出骨架（章节加前两个知识点），确认一次即开始；联网调研改为可选；第一个知识点用一张理解练习题卡摸底，不计掌握度。写规律首选在「我的理解」卡里点「编辑我的理解」直接写，不再因逐字不符被拒；不代写规则不变。
  Faster start: intake asks only what to learn and why; the outline starts as a skeleton (chapters plus the first two knowledge points) confirmed once; web research is optional; the first knowledge point opens with one ungraded understanding-practice probe card. Writing the rule is editor-first via "Edit my understanding" on the My understanding card, so near-miss wording is no longer rejected; the no-ghostwriting rule is unchanged.

- 更短等待：判题卡片在 `verification_record` 返回后立即显示；`examiner` 与 `verification_record` 可同一步并行，导师在判题的同时预出下一题，答错或难度变化时丢弃。判分证据链不变。
  Shorter waits: the grading card shows as soon as `verification_record` returns; `examiner` and `verification_record` can run in the same step so the next question is pre-generated during grading and discarded after a wrong answer or difficulty change. The grading evidence chain is unchanged.

- 答错更温和：验证中答错先留在验证阶段，用一个反例或追问后降一级继续；同一归因（都没有归因也算）连续两次答错、「稳」却答错，或在验证练习之外答错才回到评估学况。熟练门槛不变。
  Gentler wrong answers: a wrong answer in verification stays there with one counterexample or follow-up at a lower difficulty; only two consecutive wrong answers with the same attribution (including none), a confident wrong answer, or one outside a verification run return to assess. The mastery gate is unchanged.

- 学习概览：右侧「学习」工作区常驻概览（目标与进度、当前知识点与步骤、离下一级还差什么、今日复习一键开始），练习时在题卡上方显示可展开的一行。统计投影新增可选字段，旧会话无需迁移。
  Learning overview: the Learning workspace keeps an overview (goal and progress, current knowledge point and step, what is left, today's reviews with one-click start), shown as an expandable line above exercises. The stats projection gains optional fields; older sessions need no migration.

- 界面改用日常说法：「靶图」改为「我的理解」，「上层/下层」改为「规律/例子」，阶段、错因、题型和难度（「难度 N/5」）同步改写；判题反馈卡补全英文。导师提示词与内部数据不变。客户端体积上限由 200k 调整为 220k 字符。
  Plain-language interface: "target map" becomes "My understanding", upper/lower layer becomes Rule/Example, and phase, cause, question-type and difficulty ("Difficulty N/5") wording is simplified; the grading card is fully localized in English. Tutor prompts and internal data are unchanged. The client bundle size guard rises from 200k to 220k characters.

- 评测脚本：`eval/run.mjs --help` 不再崩溃；`question-latency --prompt baseline` 缺少基线文件时提前给出说明。
  Eval scripts: `eval/run.mjs --help` no longer crashes; `question-latency --prompt baseline` explains early when the baseline file is missing.

- 恢复应用增加跨进程互斥与取得锁后的重验，进程中断后可重试；提醒按工作区真实路径去重，覆盖软链接别名。
  Recovery apply gains cross-process exclusion and locked revalidation with retry after process exit; reminders deduplicate by physical workspace path, including symlink aliases.

- 修复初始化恢复遮蔽后来恢复的 JSON、多导师会话重复创建提醒，以及导出成功前未同步目录的问题；增加恢复文件保留、真实调度去重和目录同步失败回归。
  Reject initialization recovery that would shadow restored JSON, deduplicate reminders across tutor instances in one host, and persist export directories before acknowledging success; add preservation, native-scheduler and directory-sync failure regressions.

- 合并前审查补强出题来源、跨轮教学证据和原话语义保护，修复例子元数据丢失、跨会话编辑与演示切换崩溃；新增真实 DSH Web 模拟模型完整流程回归。
  Pre-merge review strengthens card provenance, earlier teaching evidence and learner-word semantics, fixes example metadata loss, cross-session editing and demo replacement crashes, and adds a native DSH Web full-flow regression with a mock model.

- 靶图和规划路线可直接编辑，保存使用宿主鉴权、版本检查和草稿保护；编辑不授予正式成绩。
  Target maps and planning outlines support direct editing with host authentication, revision checks and draft retention; edits do not grant grades.
- 中文分词及 BM25 检索，带行号的仓库声明索引，无凭据 HTTPS Git 浅克隆与 commit 来源。
  Chinese segmentation/BM25 retrieval, line-linked repository declarations, and credential-free HTTPS Git snapshots with commit provenance.
- 判题上下文按知识点收敛，保留精确重复检查；改善原话校验，新增概念对比卡、旧例复盘和参数化演示。
  Knowledge-point-scoped examiner context retains exact replay checks; improved learner-word validation, concept comparison cards, old-example practice and configurable demos.
- 新空学习工作区使用 Node 内置 SQLite，学习记录、掌握度与复习排期共享事务；教材仍为文件。旧 JSON／JSONL 保持兼容，仅通过显式迁移转换，保留备份和原记录；首次建库与迁移中断均需显式恢复，不自动升级。
  New empty learner workspaces use built-in Node SQLite, with transactions covering learner records, mastery and review scheduling; materials remain files. Legacy JSON/JSONL remains compatible and converts only through explicit migration, preserving backups and original records. Interrupted initialization/migration requires explicit recovery, without automatic schema upgrades.

- 界面控件支持 DSH 中英文热切换，补齐英文安装文档；题目、教学材料、提示词与作答协议不变。
  UI controls follow live DSH Chinese/English switching and installation docs gain English coverage; questions, teaching materials, prompts, and answer protocols remain unchanged.

## 0.1.0

- 作为 Corilo 大仓中的独立学习导师插件维护与分发，保留独立依赖锁。
  Maintained and distributed as an independent learning-tutor plugin in the Corilo monorepo, retaining its own dependency lock.
- 提供课程规划、诊断、互动题卡、考官核验、学习进度和间隔复习。
  Provides course planning, diagnosis, interactive question cards, examiner verification, progress tracking, and spaced review.
- 仅支持安装到已有 DSH；移除独立启动器和专用 profile 初始化，不改变宿主默认预设、日志或工作区。
  Installs only into existing DSH; removes the standalone launcher and dedicated profile initialization without changing host defaults, logs, or workspaces.
- 学习记录继续保存在会话工作区 `.learn/`，不迁移或清理已有数据。
  Learning records remain in the session workspace’s `.learn/` directory; existing data is neither migrated nor deleted.
- 当前构建固定兼容 DSH 0.2.2-rc.3，Node.js ≥24.9.0。尚未发布 npm，市场索引不能代替已发布包；当前使用本地 tgz 安装。
  The current build is pinned to DSH 0.2.2-rc.3 and Node.js ≥24.9.0. Not published to npm; a market index does not substitute for a published package. Install the local tgz for now.
