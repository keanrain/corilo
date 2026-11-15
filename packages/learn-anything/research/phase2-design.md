# 阶段二：方案设计（草案 v0.1，2026-10-16）

## 0. 前提假设（来自阶段一的待确认项，按建议默认值处理）
| # | 假设 | 如果不成立的影响 |
|---|---|---|
| A1 | 接受 dsh 的 DeepSeek Messages 协议，不用 Responses API | 设计不受影响（模型调用由 dsh 负责） |
| A2 | UI 分两期：MVP 只做只读渲染 + 对话修改；二期做可编辑靶图 | 若 MVP 就要可编辑，需要先拿到 dsh 源码，工期 +1～2 周 |
| A3 | 锁定 `@deepseek-ai/dsh@0.2.1-rc.2`（2026-10-22 从 0.2.0-rc.2 升级），运行时 Node ≥ 22.19 | — |

下文中 dsh 的 API 名称都来自 rc.2 的 README 和类型声明，实现时要逐一验证（开发期可用 `cordis_inspect_query` 实时检查）。

---

## 1. 架构
```
┌──────────────── dsh web（宿主，不改动）────────────────┐
│  对话 UI · 模型设置（BYOK）· web_search / web_fetch     │
│  goal · todo · subagent · schedule · ask_user · present │
└───────────────▲──────────────────────▲─────────────────┘
                │ host 插件             │ client 插件（React）
┌───────────────┴──────────────────────┴─────────────────┐
│ learn-anything bundle                                   │
│  ├─ preset「学习导师」：persona + 方法论 prompt 段落     │
│  ├─ skills：拆模型 / 出材料 / 出题判题 / 诊断 / 规划     │
│  ├─ tools：材料导入 · 课程与靶图 · 验证记录 · 复习队列   │
│  ├─ context：每步注入「当前知识点快照」                  │
│  └─ client：靶图卡片 / 大纲 / 进度 的工具渲染器（只读）  │
└───────────────┬─────────────────────────────────────────┘
                ▼
   <workspace>/.learn/   学习者数据（JSON，原子写）
```

### 1.1 包结构
```
learn-anything/
├─ package.json            # dsh.bundle + dsh.client 声明；bin: learn-anything
├─ cordis.patch.yml        # 注册 host 插件、导师 / 考官 / 校验员三个 preset、skills 目录
├─ src/host/
│  ├─ index.ts             # apply(ctx)：注册工具、prompt section、pre-step 注入
│  ├─ store/               # .learn/ 读写、schema 校验、迁移
│  ├─ ingest/              # pdf.ts  epub.ts  txt.ts  repo.ts
│  ├─ tools/               # 见第 3 节
│  ├─ mastery.ts           # 掌握度计算（第 5 节）
│  └─ review.ts            # ts-fsrs 封装
├─ src/client/             # React：toolview 渲染器
├─ prompts/                # persona.md、methodology.md（方法论转述）
├─ skills/                 # 见第 2.3 节
├─ bin/learn-anything.mjs  # 启动器（第 8 节）
└─ eval/                   # 教学质量评测（第 7 节）
```

---

## 2. Agent 划分
### 2.1 结论：一个主导师 + 两个专职子 agent
| Agent | 职责 | 为什么单独拆出来 |
|---|---|---|
| **导师（主）** | 目标接入、规划、诊断、制定材料、引导用户写三句表述、反馈 | 需要完整的对话上下文和学习者状态 |
| **考官（subagent）** | 根据靶图出**新情况**验证题、判题、给出错误归因 | ① 题目必须避开已有例子，独立上下文更容易做到；② 防止导师「顺着自己的讲解出题」；③ 判题标准统一。实现：`examiner` 工具经 subagent 服务以 `delivery: 'caller'` 启动 `learn-examiner` 预设的子 agent，并等它的结果（dsh 0.2.1 的通用 `subagent` 工具只在后台启动、下一轮才通知，出题判题会多出两轮） |
| **校验员（subagent）** | 检查 AI 生成的例子和讲解：例子是否真的符合规律、反例是否真的不满足、事实是否有来源 | 对应 PROMPT 4「材料可信度」；用另一个上下文做交叉检查 |

**不拆规划 agent**：规划需要对话追问，放在主导师里加一个 skill 即可。拆得太细会增加 token 成本和延迟（每个 subagent 都要重新带上下文）。

### 2.2 Prompt 分层
| 层 | 内容 | 机制 |
|---|---|---|
| Persona | 角色、语气、硬规则（不代写用户表述；验证必须用新情况；先诊断再开方） | `dsh-persona`，`complete: true` 替换默认的 coding agent 人设 |
| 方法论段落 | 2.1 术语、2.2 知识表示、2.3 主循环、2.4 处方表的转述 | `ctx.systemPrompt.section()`，compaction 不会压缩它 |
| 每步快照 | 当前课程 / 知识点 / 模型、阶段（状态机状态）、最近诊断、掌握度 | `agent/pre-step` 追加快照消息（参照 `dsh-time-context`） |
| Skills | 每个环节的具体操作手册，按需加载 | `customSkillDirs` 指向包内 `skills/` |

### 2.3 Skills
| Skill | 对应环节 | 要点 |
|---|---|---|
| `plan-course` | 规划 | 追问基础、时间、目的、偏好 → 搜索 → 两阶段：先出大纲和成本预估，确认后再展开知识点 |
| `describe-knowledge` | ① 描述知识 | 判断是知识还是信息；拆成输入判别 / 输出判别 / 联结三个模型；写清输入、输出和映射规律 |
| `diagnose` | ② 评估学况 | 诊断清单（记言代学 / 三种坍缩 / 前置缺失 / 迁移 / 偏好），每条结论都要引用证据（哪道题、哪句回答） |
| `make-materials` | ③ 制定材料 | 处方表 → 材料类型；#d / #e / #t / #v 格式；规律和例子对齐；生成后交给校验员 |
| `coach-statements` | ④ 继承模型 | 苏格拉底式追问，只提问不代写；用户表述有误时给反例而不是直接给答案 |
| `examine` | ⑤ 验证（给考官用） | 题型选择、新情况的构造方法、判题标准、错误归因到具体模型和坍缩类型 |

---

## 3. 工具（host 插件注册）
| 工具 | 作用 | 备注 |
|---|---|---|
| `ingest_material(path)` | 解析 PDF / EPUB / TXT，生成带章节结构的文本块，写入 `.learn/materials/` | PDF 用 `unpdf`；EPUB 解压后按 nav 拆章节，HTML 转 Markdown；返回目录和块 ID，不返回全文 |
| `repo_outline(path)` | 提取代码仓库结构：目录树、语言、入口、导出的接口 | 正文用 dsh 自带的 glob / grep / read 读取 |
| `material_read(blockIds)` | 按块读取材料 | 控制上下文用量 |
| `course_save(outline)` / `course_get()` | 保存 / 读取课程大纲 | 保存后用 `show_outline` 渲染 |
| `kp_upsert(kp)` | 新增或修改知识点（含三个模型的定义） | |
| `target_map_update(kpId, patch)` | 更新靶图：用户的三句表述、例子、验证题 | 表述字段只能写用户原话（`source: "user"`），工具层校验 |
| `verification_record(r)` | 记录一次验证：题目、用户回答、判定、错误归因 | 触发掌握度重算和复习排期 |
| `diagnosis_record(d)` | 记录诊断和处方 | 每条诊断带证据引用 |
| `review_due()` / `review_grade(id, rating)` | 复习队列，ts-fsrs 调度 | |
| `show_target_map(kpId)` / `show_outline()` / `show_progress()` | 只读展示，由 client 渲染器显示卡片 | 渲染器出问题时，工具结果里带 Markdown 版本作为兜底 |

测验直接用 dsh 自带的 `ask_user_question`（单选、多选、自由文本）。

---

## 4. 数据模型（`<workspace>/.learn/`，JSON，通过工具原子写入）
**为什么放在 workspace 而不是插件存储域**：
- 透明：用户可以直接查看和备份，这一点借鉴 pi-tutor
- 模型需要时可以用 `read` 读取
- 一个学习目录对应一个课程，和 dsh 的 workspace 概念一致

插件存储域只放跨课程的全局偏好。

```ts
type Course = {
  id; goal: string; learner: LearnerProfile;
  outline: Chapter[]; status: 'planning' | 'active' | 'done';
  createdAt; updatedAt;
}
type LearnerProfile = {
  background: string; timeBudget: string; purpose: string;
  preferOrder: 'example-first' | 'rule-first' | 'unknown';   // 先例子 or 先规律
  knownConcepts: string[];                                    // 用于正迁移 / 适配解释
}
type Chapter = { id; title; kpIds: string[] }
type KnowledgePoint = {
  id; title; kind: 'knowledge' | 'information';
  prerequisites: string[];                // kpId
  models: Model[];                        // knowledge：通常 3 个；information：空
  sources: Source[];                      // 材料块 ID / URL
  phase: Phase;                           // 状态机状态，见第 6 节
  mastery: MasteryLevel;
}
type Model = {
  id; type: 'discriminative' | 'associative';
  concept?: string;                       // 判别模型：概念 A
  input?: string; output?: string;        // 联结模型
  targetMap: TargetMap;
}
type TargetMap = {
  statements: {                           // 只能来自用户
    inputIntension?: Stmt; outputIntension?: Stmt; mapping?: Stmt;
  };
  examples: Example[];                    // 下层：正例 / 反例 / 对比例组
}
type Stmt = { text: string; source: 'user'; history: { text; at }[] }
type Example = {
  id; tag: 'd' | 'e' | 't' | 'v'; polarity?: 'pos' | 'neg';
  input: string; output: string; reasoning: string;
  origin: 'material' | 'ai' | 'user' | 'verification';
  checked: boolean;                       // 是否经过校验员检查
}
type Verification = {
  id; modelId; question; questionType; answer;
  verdict: 'correct' | 'partial' | 'wrong'; hintsUsed: number;
  attribution?: CollapseType | 'memorized-wording' | 'missing-prereq';
  novelty: { similarToExampleIds: string[] };   // 新颖性自检
  at;
}
type Diagnosis = { id; kpId; findings: { type; evidenceIds: string[] }[]; prescription: string[]; at }
type ReviewCard = { id; target: { modelId } | { infoKpId }; fsrs: Card }   // ts-fsrs Card
```

文件布局：`course.json`、`kp/<id>.json`、`verifications.jsonl`、`diagnoses.jsonl`、`reviews.json`、`materials/<id>/`。

---

## 5. 掌握度与复习
**掌握度**（按模型计算，知识点取其所有模型中的最低值；阈值写在 `Config` 里，用户可调）：

| 等级 | 条件 |
|---|---|
| 未入门 | 没有正确的新情况验证 |
| 入门 | 每个模型至少 1 道新情况题答对 |
| 熟练 | 每个模型最近 3 道新情况题都答对，覆盖至少 1 道反例判别和 1 道换说法的题，且不靠提示 |
| 精通 | 在熟练基础上：跨情境或组合题答对，并且用户自己举的正例和反例经过校验员确认 |

**门槛**：知识点达到「熟练」才进入下一个；用户可以手动跳过，但会记录在案。

**复习（ts-fsrs）**：
- 每个模型一张卡；信息类知识点一张闪卡。
- 知识类模型**达标后才建卡**：学习阶段的答题只用于诊断，不排复习，否则答错一题 1 分钟后就会在课中途提示复习。不使用 FSRS 的分钟级学习步（`enable_short_term: false`），间隔最短一天。
- 验证结果映射到 FSRS 评分：答错 → Again；有提示答对或部分正确 → Hard；答对 → Good；答对并且能解释规律 → Easy。
- **复习不复用旧题**：知识类的卡到期时由考官出一道新的情况题；信息类才用原卡复述。
- **提醒**：`dsh-schedule` 每天定时在原会话里追加一条「今日复习 N 项」。每个工作区只有一条：第一次记录验证结果时自动在当前会话创建（默认 20:00，可用 `reminderTime` 配置），绑定记在 `.learn/reminder.json`；`review_reminder` 工具改时间。dsh 0.2.1 的 web profile 自带 Schedule 服务；没有它时不挂这部分。

---

## 6. 教学状态机（以模型为单位，知识点的阶段取当前正在学的模型）
```
            ┌──────────────────────────────────────────┐
            ▼                                          │
 [describe] → [assess] → [prescribe] → [build] → [verify] ─┤
   ①描述        ②评估       ③制定材料     ④继承模型    ⑤验证  │
                  ▲                                    │
                  └──────── 验证反馈（未达标）──────────┘
                                        达标 → [mastered] → 下一个模型 / 知识点
 信息类：[describe] → [memorize] → [mastered]（进入闪卡复习）
```
- **状态的作用**：每个状态限定导师此时可用的 skill 和动作，比如在 `build` 阶段禁止直接给出规律总结。状态通过每步快照注入，由工具写入。
- **首次进入**的知识点从 describe 开始；拿到验证反馈后回到 assess；需要拆分知识时回到 describe（与原书一致）。
- **会话级目标**：用 `dsh-goal` 设定「完成第 X 章」，使循环能跨轮次、跨重启持续推进。

---

## 7. 教学质量评测（`eval/`）
| 维度 | 方法 |
|---|---|
| 验证题新颖性 | 题目与已有例子的相似度（字符串 + embedding）+ LLM 判官，「换皮复用」比例要低于阈值 |
| 诊断命中率 | **模拟学习者**：用 LLM 扮演带有特定缺陷的学习者（记言代学 / 上层丢失 / 下层丢失 / 概念混淆 / 前置缺失），检查导师能否诊断出来，并开出对应处方 |
| 不代写 | 检查靶图里的表述是否全部来自用户原话（工具层校验 + 抽查对话） |
| 材料正确性 | 校验员的拒绝率；人工抽查 |
| 成本 | 每个知识点的 token 用量和搜索次数 |

先准备 3 门迷你课程（如：函数概念、牛顿第一定律、Rust 所有权）× 5 种缺陷 = 15 个场景，作为回归测试集。

### 7.1 运行与调试（`eval/run.mjs`）
- **Prompt 缓存**：`--anthropic` 时 eval driver 通过 dsh 的请求扩展注册表（`deepseekLlmApiExtensions`）给导师和子 agent 的请求加顶层 `cache_control: {type: 'ephemeral'}`（自动缓存）；默认关闭，`LA_EVAL_PROMPT_CACHE=1` 打开。结果里的 `avgTokensPerScenario` 含缓存读写，`avgCacheReadTokensPerScenario` / `avgCacheWriteTokensPerScenario` 单列。2026-10-22 实测内部网关：字段被接受并生效（不带该字段时从不缓存），但网关把请求分散到多个上游，缓存只在同一上游命中，命中带随机性：一个场景 6 步里 1 步读到 13.3k，其余 5 步各写 13–16k。按写 1.25×、读 0.1× 计，输入费用反而比不缓存高约 9%，所以默认关闭；直连 Anthropic 时每步都应读到上一步的前缀。
- **抓请求（eval）**：`LEARN_ANYTHING_DSH=… node eval/run.mjs --anthropic --only function/memorized --inspect [--inspect-port 9229]`。每个场景的 dsh 进程以 `--inspect-wait --experimental-network-inspection` 启动并暂停，用 Chrome 打开 `chrome://inspect` 连上后继续运行，Network 面板能看到每个 Messages 请求和响应（含 bearer token，不脱敏）；场景跑完后进程会等调试器断开，关掉 DevTools 窗口它才会退出。配合 `--only` 一次只跑一个场景。dsh 自带的 Developer Tools 包需要 Web 宿主，`dsh x` 用不了。
- **抓请求（Web 启动）**：在 dsh 插件管理器的官方分组里打开 **Developer Tools**，或者在 `profiles/learn-anything/package.json` 的 `dsh.profile.bundles` 末尾加上 `@deepseek-ai/dsh-experimental-inspector-profile`，再运行 `learn-anything`。启动日志会多一行 `dsh inspector: devtools://…`，`Ctrl/Cmd+Shift+.` 打开底部的 NodeJS Inspector，Network 面板里是宿主的全部 fetch，同样不脱敏。只在本机调试时开，用完删掉这一项。

---

## 8. 交付与安装
**推荐启动方式 ③**：一个很薄的启动器 `npx @corilo/learn-anything`，用户只需要记一条命令。它依次执行：
1. 检查 Node 版本（≥ 22.19），不满足时给出升级提示
2. 首次运行时，用 `dsh --profile learn --from-default-profile web` 创建 profile
3. `dsh plugin --profile learn add @corilo/learn-anything@<当前版本>` 安装插件，并把「学习导师」设为默认预设
4. `dsh --profile learn`，调用的是锁定版本 `@deepseek-ai/dsh@0.2.1-rc.2`

**高级用户**也可以直接在自己的 dsh web 里安装插件，即方式 ①。

**首次启动引导**：网页里没有 Key 时，引导用户到「设置 → 模型」填写 DeepSeek Key；之后导师主动问「你想学什么？有材料吗？」。

---

## 9. MVP 范围
**包含**
- 学习导师预设：persona + 方法论 + 6 个 skill
- 考官、校验员两个 subagent
- 材料导入：PDF、EPUB、TXT、代码仓库结构
- 规划：两阶段确认、联网搜索、来源引用
- 五步状态机、掌握度门槛、诊断记录
- 测验：`ask_user_question` + 自由文本
- 只读界面：靶图卡片、大纲、进度（工具渲染器 + Markdown 兜底）
- 复习：ts-fsrs + 每日提醒
- 启动器 `npx @corilo/learn-anything`
- 评测集：15 个场景

**二期**
- 右侧栏可编辑靶图（需要 dsh 源码里的 client↔host remote）
- 主区进度页
- 自定义判题界面
- Markdown 和网页链接材料
- 扫描版 PDF 的 OCR
- 跨课程的知识迁移（复用已掌握的模型）
- 用 dsh-pi-ai 接入其他模型厂商

### 里程碑（粗估，单人）
| 周 | 内容 |
|---|---|
| W1 | 插件骨架、启动器、`.learn/` 存储、材料导入（PDF / EPUB / TXT / 仓库） |
| W2 | persona、方法论、skills、状态机、课程和靶图工具 |
| W3 | 考官、校验员、验证记录、掌握度、ts-fsrs、复习提醒 |
| W4 | client 只读渲染器、评测集和模拟学习者、修 bug |

---

## 10. 风险
| 风险 | 应对 |
|---|---|
| dsh rc 升级导致插件失效 | 锁定版本；升级前跑评测集；client 依赖保持最少 |
| client 开发文档缺失 | MVP 只做 toolview（有 README 和语音输入范例）；遇到困难时退回 Markdown 兜底 |
| 模型在 build 阶段忍不住代写或直接给答案 | persona 硬规则 + 工具层校验 `source: "user"` + 评测中的「不代写」检查 |
| 新情况题实际是换皮复用 | 考官 subagent 只能看到例子列表，并且要求它主动避开 + 新颖性自检 |
| subagent 和搜索的 token 成本 | 规划前预估并告知用户；校验员只检查新生成的材料 |
| 方法论转述与原书有偏差 | 方法论段落单独存放，便于审阅修改；评测场景直接取自书中的例子（函数、牛顿第一定律） |

## 11. 进入阶段三前需要确认
1. 第 0 节的三个假设
2. Agent 划分：一个主导师 + 考官 + 校验员
3. 数据放在 workspace 的 `.learn/` 目录
4. 掌握度阈值与「熟练」门槛
5. MVP 范围和 4 周里程碑
