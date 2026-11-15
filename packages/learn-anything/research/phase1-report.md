# 阶段一调研报告（2026-10-16）

> 依据：本地安装的 `@deepseek-ai/dsh@0.2.0-rc.2`（全部 288 个 `@deepseek-ai/*` 包的 README、类型声明和编译产物）；参考项目的公开页面。GitHub 在调研环境里无法访问，源码仓库内的 `AGENTS.md` / `docs/` 尚未阅读。文中路径相对于 `node_modules/@deepseek-ai/`。

## 结论
**dsh 能承载这个产品，没有硬性阻碍。** learn-anything 做成一个 dsh 外置 bundle 包（带 host 插件和 client 插件），在 dsh web 中以一个「学习导师」agent 预设的形式出现。

| # | 验证项 | 结论 | 要点 |
|---|---|---|---|
| 1 | 扩展方式 | ✅ 能 | 外置 bundle 包 + 自带 agent 预设（persona、工具、skills） |
| 2 | Web UI 扩展 | ✅ 能（有成本） | 工具结果渲染器、右侧栏标签页、主区整页；**可编辑的界面需要 client↔host 通信，开发文档不在 npm 包里** |
| 3 | 模型与搜索 | ⚠️ 部分 | 走 **Anthropic 兼容的 Messages 接口**，不是 Responses API；`web_search` 可用，带来源 |
| 4 | 状态持久化 | ✅ 能 | 插件可以有自己的存储域（JSON）；也可以自己调 `node:sqlite` |
| 5 | 编排 | ✅ 能 | goal / todo / subagent / workflow / schedule（定时复习） |
| 6 | 文档解析 | ⚠️ 部分 | TXT 和代码仓库原生支持；**PDF、EPUB 需要自己写工具** |
| 7 | 成熟度 | ⚠️ 风险 | 预发布版本，插件按精确版本做兼容校验，每次升级 rc 都可能导致插件失效 |

---

## A. dsh 可行性逐项

### 1. 扩展方式
- **Bundle 包**：`package.json` 声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`，通过 `dsh plugin --profile web add <pkg>` 或网页的插件面板安装（`dsh-package-manifest/README.md`、`dsh/README.md`）。
- **Agent 预设**：在 `@deepseek-ai/dsh-agent-preset` 中 `insert` 一行，用户在新建会话时选择，或在设置里设为默认（`dsh-agent-preset-registry/README.md`、`dsh-web-app/presets/*.patch.yml`）。内置预设有 standard、ptc、minimal、cordis。
- **Persona**：`dsh-persona` 支持 `prefix` / `suffix`，`complete: true` 可以整段替换默认的「coding agent」人设。
- **System prompt 段落**：`ctx.systemPrompt.section({name, order, text})`。compaction 不会压缩 system prompt，适合放教学方法论。
- **Skills**：`SKILL.md` 格式（frontmatter 包含 name、description），与 Claude Code 兼容。插件可以用 `ctx.skills.register()` 注册，或把 `customSkillDirs` 指向包内目录。
- **自定义工具**：`defineTool` + schemastery 参数定义，可参照 `dsh-tool-todo`（196 行）。
- **方法论放哪一层**：核心原则（第 2 节的术语、主循环、处方）放 persona 和 system prompt section；具体操作流程（如何拆模型、如何出对比例组、如何判题）做成 skills，按需加载，节省上下文。

### 2. Web UI 扩展（最关键）
- 前端是 React 18 + Vite。`dsh-client-ui-*` 本身就是插件，外置包声明 `"dsh": {"client": {...}}` 并导出 `./client` 预构建产物即可加载（`dsh-client-modules/README.md`）。
- **可用的扩展点**：
  - `tool.call.toolview`：给自己的工具注册渲染组件，例如在对话中显示靶图卡片（`dsh-client-ui-tool/README.md`）
  - `sidebarRightTabs`：右侧栏标签页，适合靶图编辑器（`dsh-client-ui-sidebar-right/README.md`）
  - `sidebar.panellist` + `main`：主区整页，适合大纲和进度总览（`dsh-client-ui-sidebar/README.md`）
  - 另有 settings、composer、slash 命令等
- **范例**：官方的 `dsh-experimental-voice-input-bundle`（host 插件 + client 插件），可以照着做。
- **测验**：`ask_user_question` 支持单选、多选和自由文本，可以直接用于测验；没有判分界面，判分由模型完成。
- **兜底方案**：`present` 交付 Markdown 或 HTML 文件，在侧栏预览。Markdown 支持表格和 KaTeX，**不支持 mermaid**；交互式 HTML 需要用户开启「Coding Tools」，而且是只读的。
- **难点**：
  - client 能 import 的共享模块只有 react、cordis、client-store、slots、primitives 等少数几个，其他依赖要打进包里。
  - client 调 host 要用构建时生成的 Typert remote，生成器和开发文档（`AGENTS.md`、`docs/subsystems/client-modules.md`）都在 GitHub 源码中，**需要拿到源码仓库**。

### 3. 模型与搜索
- **协议**：`dsh-llm-deepseek` 固定走 `https://api.deepseek.com/anthropic` 的 Messages 接口，源码里写明「protocol is not configurable」。**这和 PROMPT.md 原来写的 Responses API 冲突**，建议接受 dsh 的协议。
- **模型**：默认 `deepseek-flash`，另有 `deepseek-v4-pro`，上下文 1M。思考模式默认 `reasoningEffort: high`。
- **缓存**：DeepSeek 自动缓存前缀，dsh 刻意保持前缀稳定（system prompt 的更新放在会话历史里，而不是改写开头）。
- **Key 配置**：`DEEPSEEK_API_KEY` 环境变量，或网页的模型设置（写入 `$DSH_HOME/.credentials.yaml`），也支持 `.env` 文件和 DeepSeek 账号登录。BYOK 不需要我们自己做。
- **搜索**：`dsh-web-search-deepseek` 用 Anthropic 格式的内置 `web_search` server tool，每次搜索是一轮完整的模型调用。返回给模型的是 `Sources:` 列表（标题、URL、摘要、日期），并要求模型以 Markdown 链接引用；界面会显示来源卡片。另有 `web_fetch` 用于读取网页。
- **其他厂商**：`dsh-llm-pi-ai` 已内置但默认未启用，支持 openai-completions、openai-responses、anthropic-messages 三种协议，以后扩展成本很低。

### 4. 状态与持久化
- **数据根目录**：`$DSH_HOME`，默认 `~/.dsh`。会话以 JSONL 存储（zstd 压缩），每次模型请求和工具调用前都会做 checkpoint，崩溃后可以恢复。
- **插件存储**：`defineDomain({name, version, tables})` + `ctx.storageDomain.open()`，JSON 后端，存放在 `$DSH_HOME/storages`，跨会话持久化，模型看不到。
- **SQLite**：没有现成的 SQLite 存储后端，可以自己用 `node:sqlite`（需要 Node 22+）。
- **注入学习者状态**：
  - `ctx.systemPrompt.variable()`：每次组装 system prompt 时取值
  - `agent/pre-step` 钩子：参照 `dsh-time-context` 的写法，每步追加一条快照消息
- **长会话**：自动 compaction（约在上下文用到 80% 时触发，保留最新 16% 的原文）。

### 5. 编排
- **`dsh-goal`**：跨轮次、跨重启保持目标（上限 256 轮），适合「学完这一章」这种长目标。
- **`dsh-tool-todo`**：跟踪主循环的五步。
- **`dsh-tool-subagent`**：子 agent 可以有独立的 persona 和工具过滤，可用于「出题 / 判题」与「讲解」分离，或者做材料自检。
- **`dsh-workflow`**：插件可以直接调用 `ctx.workflowEngine.start()`。
- **`dsh-schedule`**：支持 at / daily / weekly / cron，到点后在原会话里追加一条消息，适合**间隔复习提醒**。需要 `dsh-experimental-schedule-bundle`，只能在 web profile 下用。
- **不用**：`plan-mode`（面向写代码的计划审批）、`experimental-agent-team`（没有稳定性承诺）。

### 6. 文档解析
| 格式 | 现状 | 方案 |
|---|---|---|
| TXT | ✅ `read` 原生支持 | — |
| 代码仓库 | ✅ `glob` / `grep` / `read` / bash | 另写一个提取结构的工具：目录树、模块、导出的接口 |
| PDF | ❌ `read` 只支持 UTF-8 文本 | 自写工具（如 `unpdf` 或 `pdfjs-dist` 提取文本，按页切块）；扫描版 PDF 可以用 `libreoffice-kit` 渲染页面图片后交给 `read_image` |
| EPUB | ❌ 不支持 | 自写工具：解压后按目录（nav / ncx）拆章节，HTML 转 Markdown |

上传的附件会原样保存，模型通过只读路径读取。

### 7. 成熟度与版本策略
- **版本**：全部包统一使用精确版本 `0.2.0-rc.2`（2026-09-29），之后 alpha 版持续发布，最近一版是 2026-10-14，迭代很快。
- **兼容校验**：插件声明的 `peerDependencies` 在启动时会严格检查。client UI 包注明「change without notice」，experimental 包「no stability promise」。
- **运行时**：要求 Node ≥ 22.19（`libreoffice-kit` 的要求）。**本机是 22.16，需要升级才能实际运行。**
- **策略**：
  1. 精确锁定一个 dsh 版本，同时在启动器里锁定，例如 `npx @deepseek-ai/dsh@0.2.0-rc.2 web`
  2. 升级单独作为一个任务，过一遍冒烟测试再升
  3. 可调参数放在插件的 `Config` 里，用户的 patch 层不受升级影响
  4. UI 功能分级：核心教学不依赖自定义 UI，没有 UI 也能用

---

## B. 参考项目
| 项目 | 关键点 | 可借鉴 | 不足 |
|---|---|---|---|
| **HKUDS/DeepTutor**（Apache-2.0，v1.6.14，约 3.7 万星） | Python + Next.js；Tools + Capabilities 两层插件；Guided Learning、Mastery Path、题库、Practice；三层记忆和 Memory Graph；RAG 可选 LlamaIndex / LightRAG 等 | 掌握度门槛控制进度；题库和错题回流；记忆可查看可编辑；生成前先确认大纲并预估成本；检索效果评测 | 很重，功能面过广；掌握度和复习算法不透明；没有「例子 vs 规律」「判别训练」这类学习科学建模 |
| **渐构网 modevol**（YJango，闭源） | 认知引擎、学力训练、Evoldown 编辑器（#d / #e / #c 段落类型）；渐构靶图相关内容需付费 | 材料按段落类型打标签；正例、反例、对比例组；先诊断再定策略 | 闭源、要登录、没有 API；AI 功能细节**待确认** |
| **THU-MAIC/OpenMAIC**（MIT，TypeScript） | 主题或 PDF 生成多 agent 互动课堂 | 两阶段生成：先大纲，再逐个场景；测验即时判分并指出薄弱点 | 偏「上课」，不偏长期掌握 |
| **ts-fsrs**（MIT，v5.4.2） | FSRS-6 间隔重复调度库，无依赖 | 直接用于复习队列：验证结果映射到四档评分 | 只负责调度 |
| **pi-tutor**、**pi-learning-tutor**（MIT，pi 扩展） | 学习状态以 markdown 存储（profile / roadmap / progress）；先给提示再给答案；渐进式复查 | 状态透明、用户可改；「进步了什么、下一个缺口是什么」式的反馈 | 很早期，没有掌握度模型 |

**最值得借鉴的 5 点**
1. 掌握度门槛：只有在新情况题上达标才能进入下一个知识点
2. 材料按 #d / #e / #t / #v 打标签，自动生成判别题和对比例组
3. 复习调度用 ts-fsrs：每个模型一张「卡」
4. 学习状态透明可改（靶图就是用户可编辑的状态），结论能追溯到验证记录
5. 两阶段规划：先出大纲和预估成本，用户确认后再展开

来源：pypi.org/pypi/deeptutor/json、githot.dev/en/repo/HKUDS/DeepTutor、arxiv.org/abs/2604.26962、www.modevol.com、learn.modevol.com、githot.dev/en/repo/THU-MAIC/OpenMAIC、registry.npmjs.org/ts-fsrs、registry.npmjs.org/pi-tutor、registry.npmjs.org/@majorgilles%2fpi-learning-tutor

---

## 能力缺口与补齐方案
| 缺口 | 方案 | 成本 |
|---|---|---|
| PDF / EPUB 解析 | 自写 host 工具：`ingest_material`，输出带章节结构的文本块 | 中 |
| 代码仓库结构提取 | 自写工具，组合 glob / grep 并加入 AST 摘要 | 中 |
| 学习者模型存储 | 插件存储域（JSON）起步；需要查询时再换 `node:sqlite` | 低 |
| 靶图、大纲、进度界面 | 分两期：① 只读的工具渲染器 + 通过对话修改；② 右侧栏可编辑的靶图（需要源码仓库里的 remote 生成器） | ① 中 ② 高 |
| 测验界面 | `ask_user_question` 起步，需要判分界面时再自定义 | 低 |
| 复习调度 | ts-fsrs + `dsh-schedule` 提醒 | 低 |
| 版本漂移 | 锁定版本，升级附带冒烟测试 | 持续 |

## 需要确认的决策
1. **接受 dsh 的 Messages 协议，放弃 Responses API？**（建议接受：协议不可配置，而且搜索功能已经可用）
2. **UI 分期**：MVP 只做只读渲染加对话修改，可编辑靶图放到二期？（建议这样做）
3. **能否提供 deepseek-harness 源码**（本地 clone 或可访问 GitHub 的网络）？二期的可编辑界面需要源码里的开发文档和生成器。
4. **Node ≥ 22.19**：开发机需要升级。
