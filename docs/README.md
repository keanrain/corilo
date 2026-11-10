# Corilo 可里设计索引

v0.30 · 2026-11-10。当前方向是 DeepSeek Harness 为主体，Corilo 提供个人笔记和待办插件；优先 Linux 小主机／常开电脑自部署。当前仅打磨核心记录、查找、编辑、完成与恢复草稿，日期、联动、日程、提醒和自动记忆暂缓。笔记 0.5.0 复用 CodeMirror 6，提供 Markdown 即时样式、格式操作、列表续写、撤销／重做和正文查找，沿用新建即写、标题内改名及自动保存。待办 0.4.0 参考成熟开源清单交互，提供清单内连续录入、伸缩详情、键盘导航与新增后可见性，保留行内完成及详情离开保存；辅助功能退到侧栏／更多，异常保持可见，详见交互设计。

## 当前文档

| 文档 | 唯一职责 |
|---|---|
| [根 README](../README.md) | 新用户三步启动、功能边界与仓库入口 |
| [产品](PRODUCT.md) | 定位、范围与取舍 |
| [业务规格](PRODUCT-SPEC.md) | 唯一当前产品规则与 H 系列验收 |
| [交互设计](DESIGN.md) | Harness 内核心笔记／待办交互 |
| [技术设计](TECHNICAL_DESIGN.md) | 当前架构、模块职责、稳定边界与证据摘要 |
| [开发指南](DEVELOPMENT.md) | 目录职责、运行时／锁文件、命令、测试与分发 |
| [插件导航](../plugins/README.md) | 两个独立包的安装／分发边界及包内指南 |
| [开发脚本](../scripts/README.md) | 当前开发工具与历史工具导航 |

业务规则只改业务规格，架构只在技术设计维护，包级配置与操作细节归各插件指南。新手使用不需要阅读历史档案。

## 当前实现边界

笔记 `plugins/notes` 提供普通 Markdown、列表与正文搜索、读写、直接原话保存、版本冲突保护与浏览器持久草稿；本机 Git 历史／回收站、restic 笔记恢复为次级能力。待办 `plugins/todos` 提供 Node SQLite 个人事项、快速新增、完成／撤销、编辑／取消、幂等与版本保护、草稿和 JSON 导出。页面与工具共用各包业务服务，独立于 Agent 执行计划。

统一源码 launcher 组合现有两包，复用固定 Harness 的原生网页、模型设置、会话、默认工具、认证与权限，不新建 Agent loop 或模型配置。插件视觉采用 Astryx Neutral 0.7.11 静态 token，固定宿主 React 18 不满足其 React 组件 >=19 要求，未做组件级集成。

已有真实 Harness／Chromium、工具管线、独立包生产安装与进程重启证据；物理手机／原生输入法／WebKit、真实 DeepSeek、实际 systemd 用户服务与开机自启、远程部署、NAS 及完整实例备份尚未验收。NAS 先作备份方向，不宣称未经验证的网络文件系统为工作目录；个人路线不要求 Supabase、Corilo 账号或 GitHub 绑定。

## 历史档案

| 档案 | 内容与使用方式 |
|---|---|
| [Harness 实施 v0.17–v0.24](history/HARNESS-IMPLEMENTATION-v0.17-v0.24.md) | 完整保留逐轮实现、修复、性能与验收记录；后轮可能替代前轮限制，不作为当前待办清单 |
| [旧应用运行记录](history/LEGACY-APP.md) | 原根 README 的本机／云端启动、同步、原型与历史证据 |
| [v0.16 技术记录](history/TECHNICAL-DESIGN-v0.16.md) | Pi／Files.md 云端历史架构、1–17 章及当时验收 |
| [v0.16 业务规格](history/PRODUCT-SPEC-v0.16.md) | 旧云端规则，不是当前 PRD |

旧 `app/`、`android/`、`prototype/` 与数据保留，旧云端提交继续关闭，`start:controller` 仅恢复已有任务。旧 C／N 系列测试不替代当前 H 系列验收，不依据历史章节继续扩展旧平台。
