# Corilo 历史交接记录（截至 2026-11-18）

本档保留各轮实现、回归与早期交付证据。当前版本、操作入口和产品边界见 [现行交接](../HANDOFF.md)。

## 待办 0.6.5 面板恢复与日程关联（2026-11-18）

- 待办面板重挂载后订阅同一资料库状态。保存与回执核对可以跨面板切换完成，保留提交后的新输入。列表刷新等待最多 15 秒，超时后恢复保存和关闭操作。
- 冲突预览只采用最近一次读取结果。日程关联按任务 ID 读取，已完成任务和尚未分页加载的任务仍能显示，采用服务器版本后按实际关联显示。
- 已执行 37 项待办 Node 测试和实际归档校验，真实 DSH planner 三套浏览器、旧版待办四套浏览器、旧 app 三套浏览器、工具链 19 项、启动器 4 项均通过。新回归覆盖普通保存／回执刷新跨宿主面板、冲突响应乱序、采用已完成任务的关联和真实保存结果。测试使用合成数据。
- DSH 继续固定 0.2.2-rc.3，各包独立分发。数据库和实例配置无需迁移。

## 待办 0.6.4 冲突与保存状态修复（2026-11-17）

- 冲突预览列出任务／日程的全部可编辑字段，包括日期／精确截止、所属时区、关联任务、提醒与已清空值。用户文本原样显示；保留输入前说明完整表单替换语义。
- 使用独立冲突状态，继续编辑不隐藏「查看最新记录」；采用服务器内容、保留输入或保存成功后清除。过期的读取结果不能在冲突已解决后重新挂上预览。
- 保存及回执核对的同步提交锁与界面忙碌状态一起释放，覆盖列表刷新；刷新期间输入保留，下一次保存不再被静默忽略。详情关闭也等刷新完成。
- 已执行：todos 37 项 Node（含真实 DSH 工具及包外生产安装）；planner 三套浏览器（原操作、浅深色／多宽度视觉及新冲突回归）；v1 四套浏览器（core／visual／flow／原生语言切换）；旧 app 三套浏览器；tooling 19 项及 launcher 4 项，均通过。新增回归先在旧实现上复现失败，再验证任务／日程完整与清空字段、继续编辑、普通保存和丢响应回执的延迟刷新。
- 测试过程：旧 planner 视觉断言曾在「已保存」后立即 Esc，现等待提交锁释放再检查关闭；旧版 flow 首次在离开宿主面板自动保存处超时，未修改 v1 源码，单独及完整套件复跑通过。
- 0.6.4 实际归档已重新构建，37 项包测试与 20 个分发文件的内容／SHA256 校验通过。独立包／锁为 todos 0.6.4；notes 0.7.0、导师 0.1.0、DSH 0.2.2-rc.3 不变。不自动迁移数据库或配置，测试仅使用合成数据。真实模型、物理手机与目标部署不在本轮证据内；远端 CI 和发布状态另行核对。

## 待办 0.6.3 全界面精修（2026-11-17）

- 基于 main `5c4dfa4`，分支 `feat/todos-ui-details`。planner 改为紧凑顶部导航与按实际容器宽度适配的列表／详情，统一兼容版清单的配色、间距、字体和焦点；日历任务入口、提醒状态、空状态与长文本一并整理。
- 任务可直接完成／恢复；同步提交保护阻止同一渲染周期的重复点击，保留原版本、请求 ID、未知结果核对与冲突后刷新。标题／说明自适应高度；干净关闭不再确认，未保存草稿仍确认；筛选外部点击／Esc 收起，窄屏详情限制键盘焦点，成功保存恢复可用按钮焦点。冲突预览不再输出存储 JSON。
- 已执行：37 项 todos Node 测试；原 planner 操作、冲突、丢响应与超过 100 项分页；真实 DSH 浅深色桌面／中等宽度／390px 检查、快速完成／恢复、丢响应核对、外部写入冲突、草稿关闭保护与英文长文本；v1 core／visual／flow 与原生中英切换；旧 app 三套浏览器；tooling 19 项与 launcher 4 项，均通过。
- 0.6.3 实际归档重新构建、测试并检查内容／SHA256。数据格式、SQLite、用户配置、模型与 DSH 版本不变；测试仅用合成资料，没有真实模型调用或实际用户数据迁移。Chromium 窄屏模拟不代表物理设备验收；远端 CI 和发布另行核对。

## 待办 0.6.2 界面更新（2026-11-17）

- 基于 main `d2e8774`，开发分支 `feat/todos-ui-refresh`。按用户选择的简洁风格重做 planner：安静侧栏、按日期分组的任务列表、可收起筛选、统一日历／提醒及独立详情栏。宽屏分列，窄屏使用横向导航和全宽详情，继承 DSH 主题及语言。
- 包及独立锁升级为 todos **0.6.2**；notes 0.7.0、导师 0.1.0、DSH 0.2.2-rc.3 保持。v1 配置、SQLite、日期／提醒、提交快照、冲突和回执流程不迁移。新建入口仍需先确认有效显示时区。
- 已执行：todos 35 项 Node 测试（包含真实 DSH 工具启动）；planner 原有操作／冲突／丢响应核对／日历／超过 100 项分页流程；新增真实 DSH 浅深色桌面与 390px 视觉、文字对比度、键盘筛选、详情焦点及保存可达性检查；v1 core／visual／flow 与原生中英热切换；旧 app 的 smoke／review／sync 三套浏览器；tooling 19 项及 launcher 4 项，均通过。
- `prepare:release -- todos` 重新构建、测试并验证实际 0.6.2 `.tgz`，20 个内容文件，附 SHA256、发布说明与元数据。浏览器使用合成资料和真实固定 DSH，无模型调用；窄屏 Chromium 不代表物理手机验收。本节不表示新包已发布 GitHub 或 npm。

## 2026-11-16 及更早的交接记录

## Recovery exclusion and canonical workspaces / 恢复互斥与路径别名（2026-11-16）

Base: main `1e73ca8`; branch `fix/tutor-recovery-race`. Fixes the two follow-up review findings:

- Initialization and migration recovery apply acquire the same native SQLite OS lease, then repeat validation before identity repair, alias cleanup or marker removal. Stale preflight results cannot execute after another recovery completes. Direct identity repair requires an active lease. Concurrent apply returns 409; process termination releases the lease so a later explicit retry can finish safely.
- `.learn/.recovery-lock.sqlite` is a persistent zero-byte coordinator, not learner data. Its connection uses an in-memory journal and never commits schema/data; it leaves no disk journal on SIGKILL. Do not delete/replace it while recovery runs. Read-only preview does not create it. Nonempty, linked or unexpected-sidecar coordinators fail closed.
- Reminder helpers canonicalize the physical workspace once and use it for both queue identity and binding reads/writes. Real paths and symlink aliases share one host queue; retargeting the caller's alias cannot move an in-flight binding to a different workspace. Missing/non-directory workspaces fail before native task creation. Reminder deduplication remains host-process scoped.

Executed: 312 tutor tests passed. Independent recovery review reran 76 focused tests and separate OS-process/alias/SIGKILL/unsafe-file probes without new blockers. Real pinned DSH mock boot verified physical-path plus symlink-alias native reminder deduplication, pause/delete and timer behavior. Dual-backend Chromium API, shipped Web tutoring flow, and three legacy browser suites passed. Tooling16/DSH pins passed. Fresh 74-file package passed build/test/content checks; its extracted executable recovery CLI completed read-only preview and locked apply with valid identity and zero-byte coordinator. No live-model acceptance, real-data migration/recovery, publication or deployment. Remote PR/CI results are reported separately.


## Storage review fixes / 存储审查修复（2026-11-16）

Base: main `997edba`; branch `fix/tutor-storage-review`. Fixes the three independently reproduced review findings:

- Initialization recovery previews and apply reject newly restored learner JSON/JSONL, including pending, published and owned-alias states. Rechecks before publication/cleanup keep newer files and the interrupted snapshot available rather than silently choosing the old database.
- Reminder helpers now share one host-process queue per resolved workspace, covering separately constructed Agent helpers and scoped service wrappers. Native service calls remain outside learner transactions. This does not add distributed coordination or a cross-service transaction.
- Export syncs `.learn/kp`, `.learn`, the export directory and its parent after syncing records/manifest and before reporting success. Directory-sync errors propagate and preserve the output for inspection. Sync order and failure handling were traced/injected; physical power loss was not simulated.

Executed: 293 tutor Node tests passed; actual pinned DSH mock boot passed, including concurrent-helper native reminder deduplication and existing pause/delete/timer behavior. Dual-backend Chromium API and shipped Web tutoring flow passed; three legacy browser suites passed. Tooling 16 tests/DSH pins passed. Fresh 73-file archive passed build/test/content validation. All data used was disposable synthetic data. No live-model acceptance, real-data migration, npm publication or deployment. Remote PR/CI results are separate from these local checks.


## SQLite learner storage / 学习记录事务存储（2026-11-16）

Implementation base: main `536914b`; development branch `feat/tutor-sqlite`. This section supersedes earlier JSON-only storage status below. Live-model acceptance was explicitly deferred by the user.

- New empty workspaces create `.learn/learner.sqlite` on the first learner write using native Node SQLite. Existing JSON/JSONL stays legacy until an explicit migration. Materials remain files; no automatic user-data migration, schema upgrade, dual writes or default-profile changes.
- Course/KP/target maps, verification/diagnosis history, FSRS state and reminder bindings are in SQLite. Public tools/UI share reentrant write snapshots; verification, mastery and review scheduling commit together. Async model work holds no SQL write lock. Cross-process revision/instance conflicts return 409 without replay; cancelled pre-commit work rolls back. Read tools use coherent nonblocking snapshots.
- `.backend.json` durably selects the database instance. Missing/replaced/corrupt/unsupported databases do not reopen stale JSON or initialize empty state. Pending `.initialization.json` / `.migration.lock` requires explicit recovery. Publication and recovery account for hardlink aliases, directory persistence and interrupted identity-file writes; only proved canonical-prefix repairs are allowed and original bytes are retained.
- `corilo-learn-store` / package `npm run store --` provides migrate (preview by default, `--apply` explicit), export to a new workspace, and recover (preview by default). Migration keeps original bytes and learner-only backups/checksums/counts/digests. Exports preserve current postmigration changes. Backups/exports exclude materials, DSH sessions/credentials and external schedule tasks; keep those separately. Do not delete the DB as a rollback shortcut. See the bilingual tutor README.
- External DSH reminder calls run after the learner commit, outside learner ALS; reminder bindings use separate transactions. They are not a distributed transaction or delivery guarantee. Current storage reads still load full learner snapshots; indexed-query APIs, cross-course analytics and FTS remain future work.

Executed in this checkout: 261 tutor Node tests passed; actual pinned DSH mock boot/native reminders passed; Chromium native API passed both legacy and SQLite, and full Web flow persisted SQL evidence/mastery/FSRS with three independent mock examiner requests and due-review rendering. Component and three legacy browser suites passed. Mock material eval passed 3 scenarios/46 requests using SQL-aware scoring. Tooling 16 tests and DSH pin checks passed. A fresh 73-file package passed build/test/content checks; its extracted executable CLI actually completed preview, explicit import, source preservation and export in a disposable workspace.

Independent probes covered two-process existing/first-create races, kill-before-commit, duplicate evidence, unsafe sidecars, schema/instance rejection, missing authoritative DB, and explicit pending/published/torn-identity recovery. No real learner data, knowledge library, legacy app/Android/P0, stashes, prompts/skills or answer protocols were changed. No npm publication or deployment. Remote PR/CI results are separate from these local checks.


## Pre-merge review / 合并前审查（2026-11-16）

Independent review repaired evidence and editing boundaries on `feat/tutor-learning-improvements`:

- Examiner context keeps earlier visits to the same knowledge point. Only matched successful knowledge-tool calls establish scope; material content cannot spoof it. Formal quiz/flashcard evidence requires the matching successful producer call, not merely a marker in a material or subagent response.
- Learner-word normalization preserves negation, conditions, variable-name case and mathematical/logical operators. Full original summaries and explicit introductory labels remain supported; arbitrary meaning-changing excerpts are rejected.
- Personal-example edits preserve stable IDs and unchanged provenance; changed text drops stale reasoning/citations. Forged IDs cannot replace protected examples. Target/outline saves validate evidence logs before writing.
- Editor drafts and asynchronous save results are scoped to their session and knowledge point. New tool results/replanning replace stale saved-card overlays. Concurrent same-revision writes yield one success and one conflict.
- Configurable demonstrations reset safely when the model changes and recover from invalid configurations without hook-order errors.

Executed validation: 215 tutor Node tests passed; a fresh 70-file archive passed build/test/content validation. Chromium target/outline tests cover session switching, in-flight responses and replanning; generic demo tests cover configuration replacement; locale tests passed. Native DSH Web API authentication/persistence and full tutoring-flow browser tests passed. The latter uses the shipped client, native composer/sidebar, real tutor tools and three independent mock-examiner calls: route lock → model/diagnosis → direct target-map save → three formal answers → default proficient gate → FSRS scheduling → due-review display. Only disposable fixture review timestamps were changed to simulate time passing. All tool results were checked for errors. This is real host/browser integration with a deterministic local model, not live-model teaching-quality acceptance.

Real headless DSH boot/mock-provider checks, three legacy browser suites, 16 tooling tests and DSH pin checks also passed. New component/native/full-flow browser regressions are wired into tutor CI. Teaching prompts/skills and answer protocols remain unchanged; no publication, deployment, data migration or stash manipulation. Live-model quality, physical phones and target deployment remain separate verification tasks. Remote CI and PR status are reported separately from local results.


## Tutor learning improvements / 学习导师闭环（2026-11-16）

Implementation base: main `76f5c9e`; development branch `feat/tutor-learning-improvements`. This section records execution in the current checkout, separate from historical results below.

- Target maps: direct learner statements, personal examples and annotations; authenticated, tutor-main-session-only UI actions, revision conflicts and draft retention. Verification logs, verified examples and mastery cannot be edited through the UI.
- Planning outline: direct add/edit/delete, skip, ordering and active lock, with prerequisite/structure validation and version checks. Existing learning records are retained.
- Materials: Chinese Intl.Segmenter + BM25 retrieval; bounded JS/TS/Python/Rust/Go declaration summaries with file/line provenance; HTTPS default-branch shallow Git ingestion records actual commit and cleans temporary storage. No branch/subdirectory selection; heuristics are not full semantic analysis.
- Assessment: current-KP/model context, compact examples and replay checks; relevant history overflow cannot earn independent novelty. Global exact replay remains checked; cross-KP semantic similarity is no longer examiner context. Learner wording accepts colons, parentheses and rhetorical summaries while rejecting help/control messages and invented summaries.
- Methodology: concept-confusion requires a set relation, feature matrix and contrast examples, shown as ConceptCompare; failed scheduled knowledge review exposes evidence-backed old examples for practice/variants, without new mastery credit. TaskDemo supports bounded configurable variables/states/transitions and retains the legacy preset.
- Storage: JSON/JSONL remains authoritative, queued within one host process. SQLite/FTS5 availability exercised on Node 24.19.0; actual learner-store migration is deferred and must be explicit, backed up and reversible. No automatic migration.

本轮已执行 / Executed here:

- Tutor: 204 Node tests passed; real pinned DSH mock-model startup passed (7 requests, 34 tutor tools, 16 examiner tools, native reminders).
- Chromium component suites: target-map edit/save/conflict/drafts, outline operations/lock, two generic demo domains, keyboard/narrow-screen and Chinese/English locale regressions passed. These use synthetic transport.
- Native DSH Web + Chromium API: unauthenticated 401, authenticated actual disk save, stale 409, examiner/subagent 403 and hostile-Origin 403 passed; no model calls. This validates the native API boundary, not a complete tutoring conversation.
- Legacy app: 59 Node tests and browser_smoke.py / browser_review.py / browser_sync.py passed. Tooling: 16 tests, 4 launcher startup tests and DSH pin consistency passed.
- Fresh tutor archive built, tested and content-validated (70 files); no npm publication. Public HTTPS repository ingestion smoke passed against octocat/Hello-World at `7fd1a60b01f91b314f59955a4e4d4e80d8edf11d` using a disposable workspace.

Remote Actions lookup returned Forbidden; status remains unchecked. Live models, a full tutor DSH Web teaching flow, physical phones and target deployment remain unverified. Teaching prompts/skills and answer protocols, notes/todos product code, legacy data and existing stashes were preserved. No deployment or user-data migration.


## Bilingual project documentation and UI / 项目中英支持（2026-11-15）

Current product, specification, architecture, interaction, development, release, plugin, and launcher docs now have Chinese/English navigation. AGENTS.md is maintained in English, with AGENTS.zh-CN.md retaining the Chinese counterpart. Package changelogs are bilingual. Launcher and notes CLI help/errors use English. Historical archives, vendor sources, user data, tutor prompts/skills, host teaching tools, and answer protocol modules were not translated or changed.

All three plugins' owned UI follows DSH locale. Notes shares dictionaries between the client and owned Files.md adapter; language updates preserve its iframe and CodeMirror compartments. Todos keeps state keys and user text unchanged and translates labels/errors when rendering. Tutor translations are confined to the UI shell, preserving pedagogical content and serialized answers. Language dictionaries use own-property lookups so unknown keys cannot resolve inherited Object properties.

Validation: notes existing 59 Node tests yielded 58 passes and 1 restic skip, plus 2 new locale tests passed; todos 35 and tutor 174 Node tests passed. Real DSH boot and native reminder checks passed for the tutor. Notes Files.md/classic plus real DSH locale switching, todos planner plus core/visual/flow/native locale switching, and the legacy app's three browser suites passed. Tutor Chromium tests cover actual cards with simulated host locale/transport, including drafts, flashcards, retry, minimal-change preview, and unchanged Chinese protocols; they are not full DSH Web end-to-end tests. Legacy app 59 Node, developer tooling 16, and launcher 4 tests passed.

Language browser regressions are included in notes/todos test:browser and tutor CI. All three actual tgz inventories passed the release checker and include new language resources and paired package documents (notes 126 files, todos 20, tutor 61). No version bump, npm publication, user-instance migration, or main merge was performed. Release-candidate archives used for validation are under /tmp/corilo-bilingual-packs; live-model, physical-phone, and target-deployment acceptance remain separate.


## 优化改动审查修复（2026-11-15）

审查发现分发内容检查跳过了通配符 exports：导师 `./locale/*.json` 在全部语言文件漏打时仍会通过。现要求每个字符串导出目标（含通配符）至少匹配包内文件，并增加无语言文件及错误扩展名被拒绝的回归用例。其他现有入口、CLI 与 bundle patch 检查保持。

本轮 16 项开发工具测试及 DSH 版本一致性检查通过；从三份实际 tgz 重新读取内容并检查通过（notes 123 文件、todos 19 文件、导师 58 文件）。本次未修改业务源码或重新执行无关浏览器测试；远端 CI 结果尚未核对。

## 兼容版本、独立发版准备与导师工具拆分（2026-11-15）

- `npm run check:dsh` 只读检查三包清单、独立锁、已登记 CLI／测试版本与导师当前市场条目；参考导师 `engines.dsh`，不改变安装依赖。新源码固定引用需登记。新增 repository-checks CI。
- `npm run prepare:release -- notes|todos|learn-anything` 先做版本一致性检查，再按目标包构建、测试、打包。产出 tgz、SHA256SUMS、release.json 和 RELEASE_NOTES.md；检查 exports、bin、bundle patch、文件清单及当前 CHANGELOG，不覆盖既有输出、不执行 npm 发布。新增手动 Prepare independent package workflow，各包版本与 private 状态不变。
- 导师 `src/host/tools.js` 从 842 行改为 22 行入口，按 course、knowledge、assessment、review 与 shared 拆分。工具顺序、全部公开导出、描述、schema、execute 函数体及公开辅助函数体均与拆分前比较一致，无业务或数据行为修改。

本轮本地验证：开发工具 15 项测试通过；导师 172 项及真实 DSH mock boot 通过（7 次请求、导师 34 工具、考官 16 工具、原生提醒）。三个包均实际完成构建／测试／打包，notes 59 项中 58 通过、1 项因本机无 restic 跳过，todos 33 项全部通过；更新后的入口检查再次校验三个实际 tgz 通过。重复输出目录实际拒绝并确认旧包哈希不变。新增 workflow YAML／Shell 语法及文档本地链接检查通过，远端 CI 结果另行查看。未验证新部署、真实模型或导师 Web 端到端；未发布 npm，未合入 main。

本轮验证产物分别在 `/tmp/corilo-release-notes-review/`、`/tmp/corilo-release-todos-review/`、`/tmp/corilo-release-tutor-review/`。正式重新准备会使用独立输出目录，分发流程见 [指南](../RELEASING.md)。

## 当前文档与 CI 对齐（2026-11-15）

当前入口文档统一为 notes 0.7.0＋todos 0.6.1 planner 默认组合，学习导师只供已有 DSH 用户独立安装；旧单插件与 v1 模式保留。原 v0.34 产品、规格、技术与交互文档完整存档于 `docs/history/v0.34/`，当前路径改为实际能力与明确未实现范围。未修改业务源码、数据格式或依赖锁。

CI 增加 todos planner 浏览器验收；导师固定 pnpm 10.23.0，从包清单读取精确 DSH 版本并安装到 runner 临时目录，再运行真实宿主与 mock 模型启动检查。

本轮本地验证：planner Chromium 测试通过（保存、取消／恢复、未知回执、全天事件、日历视图、超过 100 项任务及 390px 编辑器）；全新临时 DSH rc.3 和 pnpm 10.23.0 下导师 boot 通过（7 次模拟模型请求、导师 34 个工具、考官 16 个工具与原生提醒）。新增 workflow 步骤已本地执行，远端 GitHub Actions 结果另行查看；不代表真实模型、导师 Web 端到端或物理手机验收。

## 学习导师仅供已有 DSH 用户安装（2026-11-15）

按用户要求收敛为普通 DSH 插件：删除独立 CLI、专用 profile 初始化和启动目录自动注册／导航；包不再提供 bin。保留三个教学预设、工具、互动界面与 `.learn/` 数据格式。bundle 不再覆盖宿主默认预设、会话日志或插件清单设置。用户安装到现有 Web profile 后主动选择「学习导师」。已有用户自行保存的 profile 配置不会被自动清理。

构建与安装见 [学习导师 README](../../packages/learn-anything/README.md)。本地分发包 `corilo-learn-anything-0.1.0.tgz` 已重新生成，检查无启动器；尚未发布 npm。

本轮验证：172 项 Node 测试通过；真实 DSH rc.3 临时 profile 安装与启动通过，mock LLM 的 7 次请求覆盖导师 34 个工具、考官 16 个工具、写保护和原生提醒；旧 app 的 browser_smoke、browser_review、browser_sync 三套浏览器回归通过。未运行真实模型或学习导师 Web 端到端浏览器验收。测试 profile 与评测脚本仍可设置导师为默认，用途仅为隔离验证。


## DSH rc.3 与独立学习导师（2026-11-15）

本地 `work` 从旧基线快进到远端 main 的 `51f2624` 后，整合学习导师迁移、Python 原型删除及 DSH 升级。以下是本次本地执行结果，不表示已推送、部署或发布。整合前的改动另保存在 Git stash 中。

- notes、todos 的直接 DSH 依赖及锁文件统一到 `0.2.2-rc.3`，笔记 CLI 预检、启动器测试、独立分发测试和升级演练同步固定该版本。核对 npm 标签：`latest` 是 rc.1，`next` 是 rc.3；安装使用明确版本，不依赖标签漂移。
- `packages/learn-anything/` 保留独立包名、依赖锁、构建、测试与分发，使用同一 DSH rc.3。根新增 setup/test/build/pack:learn-anything 命令及独立 CI；默认 notes＋todos 组合不加载导师。根旧应用依赖、锁文件及 start/test 命令保留，没有引入 npm workspaces。
- 按用户要求删除 `prototype/`、`scripts/run_local.py` 和专用 CI；本地 `.local/` 数据、旧 app、Android 与 P0 保留。`requirements-dev.txt` 继续供现有插件和旧应用的浏览器测试使用。

本次验证：

| 检查 | 结果 |
|---|---|
| notes Node／真实 Harness 工具管线／包外生产安装启动 | 59 项中 58 通过，1 项 restic 备份演练因缺程序跳过 |
| todos Node／真实 Harness 工具管线／包外生产安装启动 | 33 项通过 |
| 统一启动器与旧入口 | 4 项通过 |
| notes Files.md 与 classic 浏览器 | 两套通过，真实 rc.3 Harness、Chromium、合成资料 |
| todos planner 与旧 core／visual／flow 浏览器 | 四套通过，覆盖任务日历、窄屏和旧待办兼容 |
| 学习导师 | 173 项 Node 通过，独立 tgz 内容核对通过 |
| 旧应用 | 59 项 Node 通过 |

未验证真实模型、物理手机或目标部署；未迁移用户实例。独立导师与双插件组合共用同一宿主的三插件配置尚未验收。下方 rc.1、旧版本和旧默认配置记录仅保留历史语境，不覆盖本节。

## 最新修复：todos 0.6.1（2026-11-15）

在用户要求修复代码审查问题后完成此补丁，基线为 `093cc56`。最新提交以 `git log -1` 为准。

- 普通任务／事件编辑保留已到期但尚未扫描的 pending 提醒，并更新其版本快照；普通父任务编辑不再重建全部关联日程提醒。完成取消仍停用提醒，恢复仅重建未来提醒。
- 全天／定时跨日时间块按显示时区与当天范围的交集分类；结束排他，未来视图包含持续至明天的安排，覆盖 DST 边界。
- 日历提供超过 100 条任务的续页，轮询保留已展开页数。
- `planner.jsx` 从 998 行收敛到 96 行页面组合；拆出列表、日历、详情、提醒、API、查询与编辑状态模块。保持原生认证、回执核对及草稿保护。
- `schedule-queries.mjs` 将普通列表筛选／计数／keyset 分页和日历范围限制放进 SQL；日期视图仅读取投影元数据，事件一次归组，当前页才读取正文，共用本地日界计算。没有改变 v2 schema、库身份或真实数据，也没有自动加索引。

本轮证据见 [修复验证](../evidence/todos-061-quality-fix.json) 与 [查询基准](../evidence/todos-061-query-benchmark.json)。4 个新增失败场景先在旧实现失败后通过。普通旧配置与 planner v2 路径都继续保留。JSON 记录格式仍是现有实现；若将来需要专门索引或关系表，应通过明确的升级设计处理，不能启动时自动改库。

构建包：`/workspace/exports/corilo-todos-0.6.1/corilo-dsh-todos-0.6.1.tgz`，SHA-256 `6e570c833929485b9f9199424f02d3421341a51a812383d7a22ffa51befcebff`。本轮 todos 33 项 Node、启动器 4 项、新版真实浏览器及旧待办三套浏览器全部通过；旧应用 59 项 Node 与三套浏览器通过。包未发布 npm。

原先尚未交付的重复、CalDAV／ICS、来源关联、外部通知和旧库升级工具不在补丁范围。未部署；目标主机与 DSH 路径仍待提供。下方 0.6.0 为历史恢复记录。

---

## 最新接手状态：todos 0.6.0 重建（2026-11-15）

原功能提交 `36ea6e9`、交接 `d09a00d` 未在本环境及远端找到。此次按用户后来提供的功能清单，以 `74deb0d` 重新实现并生成新提交，不是原提交的逐字恢复。最新 commit 以 `git log -1` 为准；分支仍为 `feat/cloud-notes`。GitHub 操作须使用环境现有代理；沙箱内代理不可达时，获准的沙箱外 Git 请求已验证可用，不应删除代理或泄露令牌。

### 实现与兼容

- `@corilo/dsh-todos` 0.6.0：任务计划／日期或精确截止／优先级／清单／说明／完成取消恢复，六个视图、筛选和分页、今天三类分组及数量。
- FullCalendar 6.1.19 标准月周日议程，Luxon 时区适配，日期跳转、选区新建、拖放／拉伸提出待确认表单、独立／全天事件和任务时间块、独立截止标记。有效开始变更保留时长，30／60 分钟快捷时长。
- Temporal 0.5.1 校验日期／时区／时间边界。精确时刻表单采用带偏移的 ISO 字符串；全天结束排他。
- SQLite 持久站内提醒，启动与周期补扫；未来提醒随完成取消失效，恢复后重建。主动网页授权，数据库原子认领防跨标签重复，超过 100 项继续分批；认领表示尝试，标签崩溃不重发。页面关闭不推送。
- 版本条件与事务回执、未知结果只读核对、冲突保留输入、保存快照与后续输入区分。手机详情页与底部保存、焦点返回、筛选清空。
- 新源码 init 默认 notes＋todos，todos 配置 `planner: true`。已有单插件和旧双插件 overlay 保留。v1 与 v2 打开器严格拒绝不匹配的 schema，旧 v1 无自动迁移；独立启用 planner 必须使用新空目录。

包保留 v1 API 与页面兼容路径；v2 API 位于 `/api/corilo-todos/v2/`，通过相同 Harness 鉴权。任务和日程共享 ScheduleService。v2 schema 为独立 records／receipts／reminders／notifications 表，不声称与失联的原 0.6.0 数据库二进制兼容；若原库后来找回，先只读核对再决定兼容方案。

### 本次证据和交付

[本次证据](../evidence/todos-060-rebuild.json)：todos **24 项 Node**、启动器 **4 项**、新版真实 Harness 浏览器通过；旧版待办三套浏览器、旧应用 59 项 Node 与三套浏览器通过。新版浏览器包含并发冲突、提交后丢响应核对、任务取消恢复、全天事件、四种日历视图及 390px。没有沿用原先“29 项通过”的历史成绩。

构建包：`/workspace/exports/corilo-todos-0.6.0/corilo-dsh-todos-0.6.0.tgz`，SHA-256 `692e85aa260298b9fac0b4d32c15569b60ebec58bb8c1652aadcbca25b1b7a51`。临时文件不可假定跨环境存在；可在 `plugins/todos` 目录运行 npm pack 重建。未发布 npm。

重复、CalDAV／ICS、笔记来源关联、邮件等外部通知和旧库升级工具未实现。真实模型、物理手机、OS 网页通知实际显示、拖动／拉伸的完整浏览器手势回归和完整实例备份恢复未验收。页面手工确认排期入口已经实现并可用于相同操作。

用户已授权正常提交推送及部署；禁止 force-push、npm 发布、自动迁移或删除数据。目标主机和 DSH 安装目录仍缺，不能声称已部署。后续停止扩展功能，先核对远端新提交，再在用户提供的目标实例安装、验收。下方是恢复前的历史交接，不覆盖本节。

---

**最新方向 v0.34：独立任务与日程恢复。** 用户认为纯笔记清单不足以替代日程管理，已要求产品与技术方案。目标为 notes＋todos 两个业务插件，任务／日程以 SQLite 为权威，Files.md 菜单保留；当前代码尚未实现日期和日历。产品规则见最新 PRODUCT-SPEC.md，实施顺序见 TECHNICAL_DESIGN.md 第 9 节。本文件第 1–10 节保留此前运行快照，其中“一个插件／退役 todos／迁移至 Markdown”的目标已被本次方向替代，不应据此自动改配置或迁移。

2026-11-11（Asia/Taipei）快照，供下一位 agent 直接接手。本文件记录交接状态；业务规则仍以 [PRODUCT-SPEC.md](../PRODUCT-SPEC.md) 为唯一来源。先读仓库 [AGENTS.md](../../AGENTS.md) 和 [设计索引](../README.md)，再读当前产品、交互与技术设计。

## 1. 仓库与授权

| 项目 | 当前状态 |
|---|---|
| 仓库目录 | `/workspace/corilo` |
| 分支 | `feat/cloud-notes` |
| 远端 | `https://github.com/keanrain/corilo.git` |
| 功能代码基线 | `40b16fb`，已推送；交接文档自身另有后续提交 |
| 当前主包 | `@corilo/dsh-notes` **0.7.0** |
| 旧待办包 | `@corilo/dsh-todos` **0.5.2**，存量兼容 |
| 当前规格 | **v0.33** |
| 工作区 | 开始编写本文前干净；接手时以 `git status`、`git log` 为准 |

用户希望持续推进、少停下来确认；已授权在开发分支提交并推送。继续使用现有 checkout，不擅自创建 worktree，不 force-push。没有授权部署、公开 npm 发布、开通付费／外部服务或发送通知。保留现有资料、凭据、配置及其他人的改动。测试使用合成数据，不能输出真实 token、密钥或笔记。

## 2. 最新产品决定：不要退回旧路线

用户原先要求两个插件只保留核心功能，随后明确改变方向：

> 完整移植 Files.md 前端，先保留它自己的菜单和功能，裁剪后面再说；机器人能力使用 Harness Agent；独立待办插件收敛到统一工作区。

因此当前采用 **DeepSeek Harness 主体＋Files.md 工作区插件**。不要再依据 v0.32 的极简页面规则删除 Files.md 菜单，也不需要重新讨论已经确定的底座。

- 新实例只加载一个工作区插件，笔记、清单、待办、收集、日记统一使用普通文件。
- Harness 提供原生会话、Agent、模型设置、鉴权和权限；不重写 Agent loop，不恢复旧 Pi 主运行链路。
- 普通编辑、勾选、收集、日记不调用模型。Agent 仅在用户明确要求时操作同一份资料。
- 首个部署目标是 Linux 小主机／常开电脑，其他电脑和手机通过浏览器访问同一服务；具体硬件、发行版和远程访问方式尚未确定。
- NAS 先作备份，不把未经验证的 SMB/NFS 或双向同步目录作为工作盘。
- 不要求 Supabase、Corilo 官方账号或 GitHub 绑定。
- 可靠提醒、日期调度、通知渠道及自动记忆并未因为这次移植而交付。

Files.md 的原生 chat 是 `Chat.md` 收集界面；Harness 会话才是模型对话。两者不要混淆。Go 同步、托管 Files.md API、Telegram Bot 和旧 Pi 均未接入当前运行链路；PWA Service Worker／浏览器离线副本也没有接入。这里的“完整移植”指固定版本的前端及菜单和可用主机文件交互，不代表开通原项目全部外部服务或通过全部设备能力验收。

## 3. 当前架构与关键文件

```text
浏览器 → 固定 Harness Web
          ├─ 原生会话／Agent／模型设置／认证／权限
          └─ @corilo/dsh-notes 0.7.0
               ├─ Files.md iframe → 鉴权 Fetch API → WorkspaceStore
               └─ corilo_notes_* 工具 → NotesStore
                                            ↓
                                   同一服务队列／主机目录
```

| 位置 | 职责 |
|---|---|
| [plugins/notes/index.mjs](../../plugins/notes/index.mjs) | 宿主插件配置、八个 Agent 工具、服务及路由注册 |
| [workspace-store.mjs](../../plugins/notes/workspace-store.mjs) | 目录、附件、设置、版本化写入、移动和删除；复用 NotesStore 队列 |
| [storage.mjs](../../plugins/notes/storage.mjs) | 原 Markdown 文件服务；Agent 与工作区共享文件版本 |
| [workspace-api.mjs](../../plugins/notes/workspace-api.mjs) | Harness 精确鉴权路由、静态资源及校验式运行时转换 |
| [workspace/adapter.js](../../plugins/notes/workspace/adapter.js) | 将 Files.md FileSystemHandle 接口适配为主机 HTTP 操作 |
| [workspace/host.js](../../plugins/notes/workspace/host.js) | 保存、导航、组字、冲突／未知结果、原生 Agent 入口 |
| [workspace/host.css](../../plugins/notes/workspace/host.css) | 主机状态／Agent 条及布局空间适配 |
| [client/workspace.jsx](../../plugins/notes/client/workspace.jsx) | 持续挂载 iframe、原生面板导航、来源校验、未保存提醒 |
| [import-todos.mjs](../../plugins/notes/import-todos.mjs) | 只读 SQLite 预览及显式迁移，随独立包提供 CLI |
| [vendor/filesmd/SOURCE.json](../../plugins/notes/vendor/filesmd/SOURCE.json) | 固定来源、逐文件 SHA-256 和集成说明 |
| [launcher/corilo.mjs](../../launcher/corilo.mjs) | 新单插件配置、旧双插件兼容、启动和只读预检 |

Files.md 上游：`https://github.com/zakirullin/files.md`，固定 commit **`9e948ba6071e320c41c866f92817cf96f9bb7ba6`**。`vendor/filesmd/web/` 原文保持不变，含原生 HTML／JS／CSS、CodeMirror 5／HyperMD、资源和许可。不要直接修改 vendor 掩盖回归；适配通过校验式运行时转换完成。`.gitattributes` 保持其原始字节，测试检查哈希。MIT 及各第三方许可随包分发。

iframe 是独立文档，避免全局样式和原生 JS 污染 Harness。它持续挂载，面板切换只显隐，因此返回时保留编辑状态。消息只接受同源且来源为该 iframe 的事件。Agent 入口调用 Harness 的 `layout.selectPanel(null)`，没有第二套聊天、模型配置或 token 系统。

旧 React／CodeMirror 6／Astryx 笔记页仍在同一包内，通过 **`interface: classic`** 显式启用；CLI 检查和 rebind 保留该选项。它只是兼容路径，不能用其截图或浏览器测试代表新工作区。

## 4. 文件、工具与可靠性边界

- `Chat.md`：直接收集；`Later.md`：Markdown 待办；`journal/`：日记；`media/`：附件；`config.json`：Files.md 设置。
- 仍有八个工具：`corilo_notes_list/browse/search/read/create/save/rename/capture`。工具名称稳定，保存描述说明个人待办和日记的 Markdown 约定。
- 页面与工具共用 NotesStore 及队列。内容 SHA-256 来自实际读取，陈旧写入拒绝；目录移动／删除也校验后代版本。
- 保存失败不标记干净、不自动覆盖；冲突核对、明确采用文件或保存副本。未知写入先只读核对，不盲目重发。收集丢响应也阻止重复发送，改名丢响应可核对新路径。
- 组字时不提交当前编辑器；提交回执只确认快照；保存副本检查提交期间的新输入。关闭未保存页面会提醒，不承诺刷新／崩溃恢复。
- 正文／设置 1 MiB，附件 16 MiB；单目录累计文件读取 64 MiB；扫描／目录版本最多 20000 项、20 层、10 秒预算。
- 拒绝路径穿越、隐藏路径、软／硬链接及特殊文件；移动目标存在时不覆盖；不安全目录操作拒绝。
- 外部图片／音视频不自动请求，本地附件正常使用；已有组合 Unicode 文件名按主机原形读写，不静默正规化为另一个文件。
- 队列只协调本服务。默认 shell／文件工具和任意外部编辑器不在其跨进程事务范围内；root 不是整个 Harness 的安全沙箱。

## 5. 安装与运行

固定 **Node.js >=24.9.0**、**Harness 0.2.2-rc.1**。Harness 是开发者预览版，不能单独升级后猜插件兼容性；不要使用 npm latest 推断版本。

仓库根目录的新实例三步：

```sh
npm run setup:corilo
npm run init:corilo -- --directory /absolute/corilo-instance
npm run start:corilo -- --directory /absolute/corilo-instance
```

`setup` 现在只安装／构建 notes 工作区包；新 init 只加载工作区，不创建待办 SQLite。初始化独占创建配置，不覆盖旧实例。使用 Harness 打印的鉴权地址，关闭模型引导后点侧栏“笔记”。默认回环端口 3000；Ctrl+C 停止。

```sh
npm run check:corilo -- --directory /absolute/corilo-instance
# 独立源码插件入口
node plugins/notes/cli.mjs init --directory /absolute/standalone-instance
node plugins/notes/cli.mjs start --config /absolute/standalone-instance/notes.patch.json
```

已有 DSH 使用 [notes.patch.example.yml](../../plugins/notes/notes.patch.example.yml) 加载绝对包入口和主机 root。另一套安装好的 DSH 不会因仓库推送自动更新；须安装新包、核对 overlay、重启并刷新页面。

根 `npm start` **仍是旧 app 入口**。旧 `scripts/corilo.mjs` 只是 launcher 的兼容转发。不要误启动旧 Pi／云端链路来证明新插件可用。

## 6. 旧待办迁移与退役

旧 `plugins/todos` 0.5.2 和已生成双插件 overlay 保留。新实例不加载它，旧实例不会自动迁移或删除资料。继续启动旧双插件实例时仍需旧包依赖：

```sh
npm --prefix plugins/todos ci --ignore-scripts
npm --prefix plugins/todos run build
```

迁移前停止源、目标服务，备份 SQLite 整个目录和目标 notes。以下示例只说明命令，**本轮未迁移任何真实用户数据库**：

```sh
# 默认仅预览，不创建目标目录
node plugins/notes/import-todos.mjs --source /absolute/old/todos/todos.sqlite --root /absolute/notes
# 核对后显式导入
node plugins/notes/import-todos.mjs --source /absolute/old/todos/todos.sqlite --root /absolute/notes --apply
```

独立安装包提供 `corilo-import-todos` 命令。导入逻辑：

1. 源数据库只读，校验格式、身份、文件和 sidecar；原数据库与请求回执保留。
2. 保留现有 Later.md，追加未完成／已完成复选框；取消记录不重新打开。
3. 详情和原关联保留可读内容，全部原业务字段在 `archive/Todo import <identity>.md` 的公开 JSON 中完整保存。
4. 先写 planned 迁移日志，再写目标，最后标记 complete。源／目标 SHA 校验和完整日志用于中断恢复、防重复追加及损坏检查。
5. 同源再次执行不重复导入；源后来改变、未完成阶段目标竞争或日志损坏时拒绝继续，不能手删日志后强行重跑。
6. 目标和日志分别最多 1 MiB，超限在写入前失败；不要宣称任意规模资料都可直接迁完。

核对成功后，用户可从旧组合 overlay 移除 `corilo-todos` 项，保留旧配置备份和原 SQLite。launcher 接受固定单插件及旧双插件配置。不要同时维护 SQLite 和 Markdown 两套“当前待办”，也不要以删源码或隐藏入口代替迁移验收。

## 7. 测试命令与已通过证据

```sh
# 主包：Node／真实管线／启动／独立安装／迁移／源哈希
npm run test:notes
# 新工作区 + 可选 classic 页面，两个都在真实 Harness 中运行
npm --prefix plugins/notes run test:browser
# 新单插件和旧双插件启动
npm run test:startup
# 旧待办兼容
npm run test:todos
npm --prefix plugins/todos run test:browser
# 旧应用回归
npm test
python3 app/tests/browser_smoke.py
python3 app/tests/browser_review.py
python3 app/tests/browser_sync.py
```

Python 依赖见 requirements-dev.txt，需 Playwright Chromium。npm 缓存若默认 HOME 不可写，可设置 `npm_config_cache=/workspace/work/npm-cache`。不要通过修改真实 HOME／凭据解决测试隔离问题。

本轮实际证据：

| 检查 | 结果 |
|---|---|
| 工作区包 Node | 59 项，58 通过、1 项旧 restic 演练因缺程序跳过 |
| 新 Files.md 浏览器 | 原生菜单、新建目录／文件、编辑／改名、分栏、实际复选框、键盘查找、收集／日记、媒体、Agent 往返、桌面／390px 文件入口通过 |
| 异常浏览器 | 冲突保留输入、写入／收集／改名丢响应核对、日记读失败不覆盖、保存副本、外部媒体不请求、Unicode 原文件名编辑通过 |
| 旧 classic 笔记页 | 核心浏览器通过，仅作兼容证据 |
| 源码启动 | 4 项通过，含新单插件、旧双插件、401、固定路径及 SIGTERM |
| 旧待办 | 14 项 Node、三套浏览器通过 |
| 旧应用 | 59 项 Node、三套浏览器通过 |
| 独立生产安装 | 离开仓库安装生产依赖，真实 Harness 加载静态资源、读取原有文件及正常退出通过 |
| SQLite 迁移 | 合成数据库映射、源文件不变、防重复、竞争及中断恢复通过；末次校验增强另补跑通过 |

`plugins/notes/test/workspace_browser.py` 才是当前 UI 验收；`core_browser.py` 明确配置 classic。无需真实模型即可继续开发与验证，不应停下来索要密钥。CI 本地配置存在及本地通过不代表远端 Actions 已通过。

**尚未验收**：真实 DeepSeek、物理手机／原生输入法、WebKit、麦克风、目标 Linux systemd／开机自启、远程访问部署、NAS、完整实例备份恢复。不能把普通 Markdown 清单称为可靠提醒。

## 8. 本地可交付物与日志

以下是当前执行环境的临时产物，**不在 Git 中，也不能假定跨环境仍存在**；缺失时按源码重建：

| 产物 | 路径 |
|---|---|
| 独立包 | `/workspace/work/corilo-workspace-v0.7/corilo-dsh-notes-0.7.0.tgz` |
| 包 SHA-256 | `a92113622daa6570b5d7162a4208de5df7f71e189b0b76b8dd4e52685eca6f98` |
| 桌面截图 | `/workspace/work/workspace-review/workspace-desktop.png` |
| 手机模拟截图 | `/workspace/work/workspace-review/workspace-mobile.png` |
| 工作区浏览器日志 | `/workspace/work/workspace-browser.log` |
| 主包 Node 日志 | `/workspace/work/workspace-notes-node.log` |
| 源码入口日志 | `/workspace/work/workspace-startup.log` |
| 最后存储／迁移补跑 | `/workspace/work/workspace-final-storage.log`、`/workspace/work/workspace-migration.log` |

重新打包必须进入包目录，输出目录先创建，不能在仓库根误打包旧应用：

```sh
cd plugins/notes
npm pack --pack-destination /absolute/existing/output-directory
```

包版本仍 private，未执行 npm publish。归档原文及字体等资源随包，约 6.9 MiB；不要为消除上游空白或换行而重写 vendor。

## 9. 接下来优先做什么

1. **对新整合做一次集中 review**：iframe 生命周期、双编辑器版本归属、未知写入／收集／改名、文件／目录删除移动、迁移日志完整性和可用性。这里是建议检查范围，不是已经确认的缺陷列表。
2. **让另一套实际 DSH 安装跑新版**：验证确实安装 0.7.0、加载正确 overlay、重启后资产更新；不要再用仓库内 classic 界面冒充其效果。
3. **用真实设备走完整日常流程**：手机查找／新建／编辑、切 Agent 返回、断线／重连、重启；原生输入法和 WebKit 分别记录。没有目标设备时继续做不依赖设备的改进和回归。
4. **仅在有真实旧库路径后执行迁移**：先停写备份、预览、导入、比对，确认后再移除旧插件入口；本轮只有合成演练。
5. 随后再推进目标 Linux 常驻／远程鉴权和实例级备份。未经用户新要求，不扩展提醒、自动记忆、外部通知服务，也不重新裁剪 Files.md 菜单。

当前文档导航：[产品](../PRODUCT.md)、[规格](../PRODUCT-SPEC.md)、[交互](../DESIGN.md)、[架构](../TECHNICAL_DESIGN.md)、[开发](../DEVELOPMENT.md)、[插件指南](../../plugins/notes/README.md)。历史 v0.32 与更早 Pi／Files.md 云端路线均不作为当前需求。

## 10. 接手续查（2026-11-11）

从远端 `6d33cbc` 接手并检查工作区／Agent 共用存储、iframe 生命周期、双编辑器保存、移动删除、未知回执和迁移日志。确认并修复一个可复现的数据丢失窗口：打开另一文件等待保存回执期间继续输入，旧实现会用新文件覆盖这些尚未提交的输入。现在正文严格来自提交快照，保存结束及加入既有保存的调用都检查剩余脏状态；有新输入时拒绝继续导航并保留编辑器，下一次保存再提交新输入。没有改 vendor、菜单、模型链路或真实用户资料。

真实 Harness／Chromium 的新增用例先在旧实现失败，再在修复后通过，覆盖打开文件与同时打开收集界面等待同一次保存的情形。完整 Files.md 工作区和 classic 浏览器、旧应用三套浏览器均重新通过；主包 Node 59 项中 58 通过，1 项 restic 因缺程序跳过。历史记录不替代这些本轮执行结果。真实模型、物理手机、WebKit 和目标设备部署仍未验收。

另在可丢弃、仓库外的独立 DSH 0.2.2-rc.1 实跑安装与升级：先启动无 Corilo 的宿主，再安装从 `6d33cbc` 重建的 0.7.0 包，其 SHA-256 与第 8 节交接包完全一致；写入合成资料后停止服务，安装本轮修复构建并重启。overlay 原字节、既有资料及旧包写入的资料保留；新服务 host.js 与新安装文件逐字一致且哈希已改变，401 与正常退出检查通过。两包均为本地 0.7.0 构建，不代表发布新 npm 版本；包哈希及检查结果见 [本轮证据](../evidence/workspace-upgrade-review.json)。新演练脚本 `plugins/notes/test/upgrade.mjs` 的命令见开发指南。

演练直接调用固定 DSH 原生入口，`--patch` 必须先于 `--no-open`／`--port` 等应用参数。宿主依赖用 --save-exact 固定，并在每次安装后核对实际版本。该演练验证另一套真实安装的 DSH，不代表已修改用户既有实例，也不以 HTTP 静态资源核对替代该实例的浏览器验收。仍需用户目标 DSH 的实际路径与环境才能继续其就地升级；未部署、未发布 npm、未迁移真实数据库。

## 11 任务与日程方案

本次仅更新 v0.34 正式产品、规格、交互与技术文档，并同步开发约束和导航；没有修改运行代码、依赖、包版本或真实资料。旧 v0.33 正式文档已归档。

方案选择继续扩展现有 todos 服务：复用 SQLite 事务、版本、幂等与 Harness 工具注册，区分任务、独立事件和任务时间块。阶段 A 完成完整任务页、日期、日历、关联、显式 v1→新 v2 库升级和独立安装；阶段 B 再交付重复与持久站内提醒，阶段 C 才接经选择的外部通知和日历互通。FullCalendar 等组件是候选，尚未安装锁版。

接下来按技术方案 A1 验证日期模型与新库升级，保留旧包和旧库；不要在原 v1 数据库直接加列，也不要自动把 Later.md 回迁或删除。阶段 A 完成前，当前源码命令仍默认只加载 notes。若用户先需要旧待办界面，可按既有双插件配置单独恢复，但这不代表新日程能力已完成。本轮只做文档、链接与一致性检查，不复用旧测试成绩宣称 v0.34 通过。
