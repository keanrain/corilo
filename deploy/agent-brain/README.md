# 外脑试用：每日节奏配置（第 2 步）

[English](README.en.md)

本指南适用于使用 Corilo 源码启动器的笔记 0.10.1 实例，配置使用 DSH 自带工具。按平时的方式重启实例，例如 `npm run start:corilo -- --directory <实例>`。笔记根目录会出现在 DSH 工作区列表中。请将命令中的 `<实例>` 替换为启动器的实例目录。

## 1. 放入管家守则

把 [`plugins/notes/templates/AGENTS.md`](../../plugins/notes/templates/AGENTS.md) 审阅、按需修改后，复制为 `<实例>/notes/AGENTS.md`。DSH 会在该工作区的会话中加载它。之后想调整 Agent 的行为，直接在笔记里改这个文件。

## 2. 安装 wiki skill

```bash
git clone https://github.com/Astro-Han/karpathy-llm-wiki "<实例>/runtime/harness/skills/karpathy-llm-wiki"
git -C "<实例>/runtime/harness/skills/karpathy-llm-wiki" checkout --detach eafcc77001e496cc43499e4923b663aec722c813
```

启动器把 `DSH_HOME` 设为 `<实例>/runtime/harness`，DSH 会扫描其中的 `skills/`，不必重启。命令固定到采用 MIT 许可的提交。使用或升级前请审阅其中的 `SKILL.md`。它在笔记根目录使用 `raw/`（原文副本，只增不改）和 `wiki/`。

## 3. 创建两个定时任务

在 DSH 网页里选中笔记工作区，开一个新会话，把下面整段发给 Agent。**先把时区改成你所在的 IANA 时区**；目标设为 `new` 时，每次投递都会新建会话，并沿用这个会话的工作目录和 preset，所以必须在笔记工作区里创建。

```text
请用 schedule_create 创建两个定时任务，target 都用 new，时区 Asia/Shanghai：

1. 标题“早间简报”，每天 08:00。指令：
早间简报。按 AGENTS.md 的每日节奏：读最近 3 天的日记、今天的日程与任务、逾期任务和收件箱条数，给我一份能在一分钟内读完的简报。这个对话就是今天的主对话。

2. 标题“晚间回顾”，每天 21:30。指令：
晚间回顾。按 AGENTS.md：先读今天的日记、今天的日程与任务、收件箱，必要时用会话搜索看今天的主对话；然后陪我过一遍：完成了什么、没完成的挪到哪天、收件箱每条怎么处理、今天学到了什么。每项等我确认后再写入，最后把当天记录写进日记。

创建后用 schedule_list 列出来给我核对。
```

也可以在“自动化任务”页面手动创建，但要确认目标是“每次新建会话”、工作目录是笔记根目录。

## 4. 每天怎么用

- 白天：打开当天的“早间简报”会话说话、丢链接。整理长文这类重活让它交给子代理。
- 晚上：打开“晚间回顾”会话，跟着走一遍。
- 手机：直接用浏览器打开 DSH 网页。

## 5. 一到两周后看三件事

1. 是否每天都打开了它？
2. 还需不需要重新交代背景？
3. 有没有漏掉提醒？

据此决定下一步：Ticket 插件、文件监听、代码库、手机推送等都等这时再定。

## 已知限制

- 宿主必须在投递时刻运行；重启后，重复任务只补发最近一次错过的。
- 网页提醒只在页面打开时弹出。
- `AGENTS.md` 指导 Agent 的写入范围。目前 DSH 无法按子目录实施写入权限。笔记工具在保存已有笔记时检查版本。
