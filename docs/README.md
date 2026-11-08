# Corilo 可里设计索引

v0.17 · 2026-11-08。当前方向：DeepSeek Harness 为主体，Corilo 通过笔记、事项和后续记忆插件扩展，优先个人自部署。资料可带走、简单使用的目标延续；旧 Pi/Files.md 云端平台停止作为主路线推进，代码和证据保留。

| 文档 | 唯一职责 |
|---|---|
| [产品](PRODUCT.md) | 定位、范围与取舍 |
| [业务规格](PRODUCT-SPEC.md) | 唯一当前产品规则与 H 系列验收 |
| [技术设计](TECHNICAL_DESIGN.md) | 当前插件架构、实施状态及历史云端证据 |
| [交互设计](DESIGN.md) | Harness 内笔记/事项目标交互 |
| [旧云端规格](history/PRODUCT-SPEC-v0.16.md) | 历史归档，不是当前 PRD |

## 已决定

- 复用 Harness 原生网页、会话、Agent、默认工具和模型配置；初期 DeepSeek。
- Corilo 提供独立插件，先笔记，再个人待办/日程和可靠提醒，记忆后续加入。
- 正文仍为普通 Markdown 与附件，配置和会话不混入笔记。
- 常开电脑/主机保存工作目录，NAS 作为备份方向；硬件、OS 和远程方式尚未确定。
- 不要求 Supabase、Corilo 官方账号、GitHub 绑定或手机运行 Agent。
- 先采用固定预览版本验证，升级需要兼容性检查，不自动追踪上游 master。

## 实施边界

实现位于 plugins/notes：文件服务、模型工具和 Harness 内笔记页面。真实发布版 Harness + Chromium 已验证列表/文件名搜索、读写、直接原话保存、冲突与失败草稿保留；细节见技术设计与插件 README。真实模型、手机、事项/提醒、长期记忆和 NAS 部署仍待验收。插件工具不是默认文件/bash 工具的沙箱，也不保证所有外部写入都受其版本队列协调。

旧 app/、android/、prototype/ 和已有数据保留；此前的本机/云端测试只证明旧链路。旧云端任务提交仍关闭，start:controller 仍只做恢复。当前 H 系列验收不由旧 C/N 系列替代。
