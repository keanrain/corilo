# Corilo 可里技术方案

v0.34 · 2026-11-11。目标是复用 Harness 和现有插件，把独立任务扩展为任务与日程管理。业务语义以 [规格](PRODUCT-SPEC.md) 为准；新增接口、表和组件均为待实现设计。notes 0.7.0、todos 0.5.2 和当前启动命令没有因文档更新而改变。

## 1 架构与选型

```text
浏览器连接同一个 Harness
  原生会话与 Agent       笔记面板                  任务与日历面板
       |                 |                            |
  原生工具管线      Files.md iframe             React 插件页面
       |                 |                            |
       +------ NotesStore / WorkspaceStore      TaskScheduleService
       |                 |                            |
       +------ 个人任务与日程工具 ---------------------+
                         |                            |
                    Markdown 与附件             独立 SQLite 目录
                                                      |
                                        持久提醒记录与有限调度器
                                            阶段 B 才启用
```

Harness 固定 0.2.2-rc.1，Node ≥24.9.0，精确依赖与各包锁文件保留。使用原生认证、Connection Fetch、工具注册和 UI layout，不改宿主 Agent loop。两个业务包继续独立安装；launcher 只组合配置，不成为共享运行包。任务插件保留包名 `@corilo/dsh-todos` 和目录 `plugins/todos`，避免无必要的改名迁移。

| 部分 | 推荐方案 | 理由与限制 |
|---|---|---|
| 笔记 | 固定 Files.md 与现有适配层 | 保留菜单和许可，持续维护保存保护 |
| 任务后端 | 现有 Node SQLite 服务扩展 | 已有事务、版本、幂等和鉴权接入，不再部署第二个服务 |
| 任务 UI | 原插件 React 与 Harness 样式变量 | 与宿主一致，恢复有完整管理能力的独立面板 |
| 日历 UI | 候选 FullCalendar 标准 dayGrid／timeGrid／list／interaction | 只用标准日历视图，不依赖资源排程等付费模块；实现前核对版本、许可、React 18 与 CSP |
| 日期计算 | 候选 @js-temporal/polyfill | 分离 PlainDate、ZonedDateTime 和 Instant，避免 Date 混算日期 |
| 重复展开 | 阶段 B 评估 rrule 与日期层组合 | 只支持规格定义的规则子集，库默认 DST 行为不能替代业务规则 |

组件候选来源：[FullCalendar](https://github.com/fullcalendar/fullcalendar)、[Temporal polyfill](https://github.com/js-temporal/temporal-polyfill)、[rrule](https://github.com/jkbrzt/rrule)。本轮没有下载或复制这些项目的代码；实现时锁定具体版本、记录许可证并运行真实 Harness 浏览器兼容性检查。若日历组件不能满足 CSP 或移动端要求，先完成议程与表单，日历阶段仍记未验收，不能静默缩减目标。

不嵌入完整 Vikunja 或 Super Productivity 服务：那会引入另一套认证、升级和存储。借鉴它们的交互；CalDAV 留到后续，不在本地插件外再实现一个通用同步平台。

## 2 现有代码与改造点

| 位置 | 已有能力 | 计划改造 |
|---|---|---|
| todos/storage.mjs | v1 SQLite、事务、版本、请求回执、导出、目录检查 | 保留安全检查；新增 v2 打开器、查询、日期／日程及事务 |
| todos/core.mjs | 仅标题、详情与 open/done，隐藏 cancelled/notePath | 扩展业务服务，恢复取消和笔记关联的明确 API |
| todos/api.mjs | 精确鉴权路由、库身份头、参数白名单 | 保留 v1；新增版本化日程 API 和 request 查询 |
| todos/index.mjs | 五个原生个人待办工具 | 保留名称与老字段；新增日程工具，更新“不支持提醒”的阶段说明 |
| todos/client/ | 已有 React 页面和宿主样式 | 任务列表、日期表单、详情抽屉、日历、统一缓存及失效处理 |
| launcher/corilo.mjs | 当前默认 notes；兼容旧双插件 | 阶段 A 验收后，新 init 生成双插件；旧配置只显式升级 |
| notes/client/workspace.jsx 与 workspace/host.js | iframe 持续挂载、来源验证、保存保护 | 增加显式关联任务入口与只含安全来源描述的桥接 |

建议新增 date-values.mjs、schedule-service.mjs、migration.mjs 和聚焦的日历组件；阶段 B 再增加 recurrence.mjs、reminders.mjs。模块仍在 todos 包内，不建立第三个插件或共享业务服务仓库。

## 3 v2 数据模型

沿用每实例独立 SQLite，启用 WAL、foreign_keys、synchronous=FULL、busy_timeout。数据目录与笔记目录不得重叠；文件、inode、schema 和库身份检查不移除。下面是逻辑表设计，不是已经执行的 SQL。

| 表 | 核心字段与约束 |
|---|---|
| metadata | schema_version、identity、新旧库映射、默认时区；唯一实例记录 |
| lists | id、name、sort_order、archived、version；归档清单不删除任务 |
| todos | 原 id/title/body/status/version/created_at/updated_at；增加 list_id、priority、planned_date、due_kind、due_date、due_at_utc、due_tz、completed_at、cancelled_at；note_path 原值保留 |
| calendar_entries | id、kind(event/focus)、task_id、title/body/location、status(active/cancelled)、all_day、start_date/end_date 或 start_at_utc/end_at_utc/tz、version、时间戳 |
| note_links | owner_kind/owner_id、notes_root_id、relative_path、来源文字；应用事务校验所属对象存在，类型与路径白名单 |
| receipts | namespace/request_id 唯一、payload_digest、result；提交写操作与回执同一事务 |
| series（B） | id、kind、模板、当地开始、tz、有限规则结构、revision、结束条件 |
| occurrences（B） | series_id + 原计划发生键唯一、实体 id、例外类型和版本；改期不改变发生键 |
| reminders（B） | owner_id、occurrence_key、offset 或明确时刻、channel、enabled、revision |
| reminder_jobs（B） | reminder_id + occurrence_key + revision + channel 唯一、due_at、状态、lease_until、lease_token、attempts、next_attempt_at |
| inbox_notifications（B） | job_id 唯一、内容快照、created_at/read_at；站内提醒与 job 完成同事务 |

日期字段为 YYYY-MM-DD，精确时间为 UTC ISO 字符串，原始时区另存 IANA 名称；数据库 CHECK 与业务层共同保证日期／精确时间只选一种，不接收含糊的本地时间字符串。全天结束日期排他；客户端负责清楚显示最后一天。

计划日期是用户个人计划的当地日期；due_date 用 due_tz 定义截止边界，due_at_utc 不受显示时区变化影响。事件定时范围存 UTC 与原时区；重复系列保留墙上时间和规则，再派生 occurrence，不能每次简单加 24 小时。

task_id 外键只允许 focus；独立事件无任务外键。任务取消不级联物理删除日历历史，按事务失效未来提醒；所有状态变更检查对象 version。由于旧取消记录没有真实取消时刻，升级时该时刻可为空，不能伪造为升级时间。

索引至少覆盖 status/planned_date、status/due_at_utc、status/due_date、list_id/status、calendar start/end、task_id、jobs state/next_attempt_at；最终索引用固定合成数据和查询计划验证。跨日期与精确截止的列表排序在服务层统一，不能靠字符串混排。

## 4 服务接口与一致性

所有 UI 和 Agent 写入进入 TaskScheduleService，执行规范化校验、库身份检查、请求去重、版本条件及 SQL 事务。客户端不能直接执行 SQL；默认 shell 工具仍不在本服务的安全沙箱内。

新增 `/api/corilo-todos/v2/` 的 identity、tasks/list/read/create/update、calendar/range/create/update、lists/list/create/update、requests/read、export 等精确路由。只注册实际实现的方法，不注册任意路径分发。读范围最多 366 天，单次最多 2000 个日历发生项；超过时返回明确限制及缩小范围提示，不默默截断。列表每页 100，cursor 绑定筛选和排序，筛选变化旧 cursor 拒绝。

写入示例：

```json
{
  "requestId": "客户端生成并保留的 UUID",
  "id": "任务 UUID",
  "expected": 7,
  "patch": {
    "plannedDate": "2026-11-12",
    "due": {"kind": "date", "date": "2026-11-13", "timeZone": "Asia/Taipei"}
  }
}
```

载荷经规范化后连同 API namespace 计算 digest；同 requestId 同载荷返回原结果，同 ID 异载荷冲突。版本陈旧返回 409 及可安全展示的当前版本；客户端保留输入供比较。提交后丢响应，先用原 requestId 查回执；未知时仅允许原 ID 原载荷重试，不生成新 ID。回执无自动 TTL 清理，未来清理必须保留幂等 tombstone 或定义新的会话边界。

旧 v1 路由继续原字段、原 digest 和原 JSON 结果形状，旧回执导入 v1 namespace；不把它的 `corilo-todos-v1` 导出偷偷改成 v2。新的完整导出使用 v2 路由／工具，涵盖日历与关联。新工具可为现有 todos 工具增加兼容的可选字段，同时保留旧调用的含义；不返回未实现字段的成功回执。

更新任务、更新相关提醒版本、写回执同事务。跨 Markdown 与 SQLite 不承诺分布式事务：阶段 A 的“从笔记建任务”只写任务和来源引用，不同时回写笔记，从而避免半成功。来源读取失败不阻止独立任务保存，但不得伪造关联成功。

客户端保存成功后使任务列表、日历与详情缓存失效；面板重新可见时刷新，多个浏览器通过版本条件和有限轮询获得一致视图。轮询不承担提醒调度。失败保留编辑，避免同一对象多处自动保存互相覆盖；日期弹窗和详情采用明确提交，勾选采用单项事务与失败回退。

## 5 UI 与笔记桥接

任务／日历使用 Harness 原生 React 面板与样式变量；布局详见 [交互方案](DESIGN.md)。日历事件点击后打开同一详情抽屉，网格拖动只提出更新，后端确认才标为已保存。文本输入保留 IME 和提交中继续输入保护；按钮、键盘和表单与拖动功能等价。

Files.md 的原始 vendor 不修改。任务入口通过适配层发送经过来源验证的消息；父页面只接受固定 iframe、同源、白名单类型及有界字符串。传递 notes_root_id、相对路径与选中文字，不接收绝对路径、执行代码或外部导航 URL。新的“打开笔记”请求由 notes 插件现有读接口重新校验路径和库身份，再走保存保护和 openFile。

插件之间使用宿主面板与窄化事件接口，不互相直接写数据库或 Files.md 全局状态。notes 单独安装时隐藏需要任务插件的动作并解释未加载；todos 单独安装时仍可管理任务，来源按钮显示未连接。来源改名自动维护延期，首期以明确失联状态与重新关联保护数据。

## 6 Agent 接入

继续注册 corilo_todos_list/read/create/update/export，保留旧用法与个人事项定位。新增 corilo_calendar_list/create/update、corilo_agenda_query、corilo_schedule_export；阶段 B 再提供 series/reminder 工具。工具命名和 schema 在真实 Harness 中核对，不假定宿主支持自定义审批机制。

查询必须有界，agenda 返回显示时区、任务截止、事件与时间块，不能仅把普通文件全文丢给模型。mutation 需要 requestId 和更新版本；只接受结构化日期，模糊自然语言由 Harness 会话澄清。明确操作直接使用现有权限机制，整组操作需包含用户选择的 scope；不让模型直接拼 SQL、创建系统 cron 或调用未配置通知渠道。

页面不调用模型解析日期。可提供“今天／明天／下周”确定性按钮；复杂自然语言由用户主动进入 Agent。模拟工具管线、真实模型和实际副作用分别验收。

## 7 重复与持久提醒

阶段 B 才实现。按用户请求范围及提醒前瞻窗口有界展开系列，预生成未来 90 天；每批最多 2000 项，避免无限规则锁死主线程。过去未完成实例持续保存，未来视图可按需扩展到请求范围；停机跨过的系列先记录待补算范围，分批恢复，不因批量上限漏掉历史发生。

发生键由系列 id 与原定当地日期时间／偏移组成，例外改期不换键；SQLite 唯一约束防多个进程重复物化。整组未来修改先提升 revision，保留历史完成实例和显式例外，再重算受影响范围并失效旧提醒。UI 预览至少三次；短月、DST 和跨时区测试必须使用真实时区数据库。

提醒配置和业务变更在同一事务写入持久 job。宿主插件初始化后查询到期 job，每 30 秒唤醒、启动立即补扫；计时器只负责唤醒，任务事实在 SQLite。查询使用 UTC，检测时钟大幅跳变后重新扫描，不靠进程运行时长计时。

多进程竞争用短 `BEGIN IMMEDIATE` 事务认领、lease 与递增 fencing token；过期租约可重领。发送前再检查当前 revision、对象状态和 token，旧 worker 不得确认新租约的结果。网络调用不占数据库事务。

站内提醒与 job done 在同事务唯一插入，可防重复展示。外部渠道按能力使用稳定幂等键；仅对明确未发送的可重试错误指数退避，遵守 Retry-After，最多 5 次后失败。响应未知且渠道不支持查询／幂等时标 unknown，不能盲目重发并宣称 exactly-once。取消与渠道已接受之间存在不可撤销窗口，界面显示已提交状态，不承诺撤回已发通知。

默认仅站内；未来通知 adapter 与密钥配置单独接入。静默补偿窗口和显示语义以规格为准；导入、恢复和新建系列不得自动补发历史通知。Web Push 还涉及 HTTPS、Service Worker、浏览器权限及移动平台限制，须独立设计和真机验收，不通过放宽整个 Harness CSP 解决。

## 8 显式升级与恢复

现有 v1 打开器校验精确 schema，因此不能直接向原库加列再声称旧包可兼容。设计一个离线升级器，默认 dry-run；使用新目标目录与 v2 schema，旧目录原样保留。

1. 识别源 application_id、user_version、schema、identity 与完整性；要求源／目标服务停写，拒绝路径重叠和链接。使用 SQLite 一致快照读取，不能只复制运行中的主 db 文件而忽略 WAL。
2. 生成映射预览和源快照指纹：保留任务 ID、原字段、状态、时间和 v1 回执；新增字段为空／默认。note_path 保留，无法验证库身份的关联标为待重新绑定。
3. `--apply` 写入新的目标库，生成新库 identity 并保留 source_identity；用迁移日志记录 planned／validated／complete 阶段、版本与指纹。中断只恢复同源同目标，来源改变则停止。
4. 校验条数、逐记录规范化哈希、所有回执、外键、JSON 导出和数据库完整性；fsync 后输出新的 overlay 副本，用户明确切换，旧配置不改。未完成目标不能被服务打开。
5. 在副本中验证启动、旧任务查询、编辑、日历与回退，再执行目标实例操作。旧客户端库身份变化须重新连接，不能继续写旧缓存。

回退旧包时使用旧配置与旧库；切换后在 v2 新增的数据不会自动回到旧库，回退前必须导出并说明差异，不能宣称双向无损降级。恢复数据库后暂停所有提醒，重新绑定笔记目录与时区后由用户启用。数据库、笔记和配置的完整实例备份另行验收，JSON 导出不代替它。

原 SQLite → Markdown 导入器保持只读源与显式 apply，不自动运行。已经迁成 Markdown 的资料不被本方案删改，也不自动从 Markdown 还原 SQLite。

## 9 实施顺序与交付门槛

| 工作包 | 范围 | 进入下一包前的证据 |
|---|---|---|
| A1 数据与兼容 | v2 日期模型、任务服务、显式升级和旧接口适配 | T02/T03/T05/T08 的 SQLite、时区、故障注入测试；真实 Cordis 加载 |
| A2 完整任务页 | 双插件入口、清单、今天／未来、详情与取消恢复 | 桌面／390px 浏览器、键盘、IME、冲突与重连；T01/T09 |
| A3 日历与关联 | 定时／全天、时间块、月周日／议程、笔记来源、日程工具 | T04/T06/T07；完整日常流程，不只截图 |
| A4 独立安装 | 两包生产安装、已有 DSH overlay、升级／回退、导出 | 独立真实宿主、资源更新、旧库保留；阶段 A 验收完才改默认组合 |
| B1 重复 | 系列、实例、例外、有限展开 | T10 短月、DST、系列变更与并发唯一性 |
| B2 提醒中心 | 事务 job、租约、站内展示与恢复补偿 | T11 重启、双进程、时钟跳变、取消竞态 |
| C 互通与设备 | 选定渠道、ICS、实际 Linux 和手机；再评估 CalDAV | T12 真实设备与真实渠道，不能以测试替身代替 |

不在此次方案工作中新增运行依赖、迁移数据、部署服务或宣称上述验收已通过。日历组件性能目标为合成 10000 任务／500 可见日历项时，本机查询 p95 <200ms、桌面首次可操作 <2s；这是目标，实施时记录硬件、冷暖缓存和测量方法，不作为已有成绩。

既有证据与边界见 [交接文档](HANDOFF.md) 和 [v0.33 技术记录](history/TECHNICAL_DESIGN-v0.33.md)。本轮只做文档一致性、链接和路径检查；代码、真实模型、物理手机和目标设备的结果不因设计更新而改变。
