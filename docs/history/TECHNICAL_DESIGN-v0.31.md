# Corilo 可里技术设计

v0.31 · 2026-11-10。当前业务规则见 [PRODUCT-SPEC.md](PRODUCT-SPEC.md)，交互见 [DESIGN.md](DESIGN.md)，旧路线与此前笔记实现见 [v0.30 技术归档](history/TECHNICAL_DESIGN-v0.30.md)。

## 当前架构

```text
浏览器 → DeepSeek Harness Web 0.2.2-rc.1
          ├─ 原生会话、Agent、模型配置、默认工具、认证与权限
          ├─ 笔记页面／工具 → NotesStore → 普通 Markdown
          └─ 待办页面／工具 → TodoStore → Node SQLite
笔记页面 → 当前会话内输入／保存状态，不使用浏览器草稿数据库
待办页面 → 既有 IndexedDB 可靠性机制，独立于笔记
源码 launcher → 固定两包组合配置 → 原生 Harness 启动
```

不重写 Agent loop、模型管理或调度底座。笔记 0.6.0，待办 0.4.1；两包各自依赖／锁文件／构建和分发，根依赖仍用于旧应用，不引入 workspace 或共享运行包。

## 笔记核心

页面仅包含新建、列表／查找、正文、标题改名、自动保存和可选阅读预览。`client/index.jsx` 负责当前文档与导航；`autosave.mjs` 是插件生命周期内唯一保存管线，切换宿主页面仍可完成已有保存。提交快照与后续输入区分，失败／冲突／未知结果暂停，正常导航先保存，未知结果只读核对或明确保存副本。未保存关闭页面使用 beforeunload 提醒，不在卸载时虚构异步写入成功。

不访问笔记 IndexedDB，不提供草稿库／恢复入口／历史／回收站／删除页面／手动保存开关。旧 IndexedDB 数据保持，新版不读取或清除；旧 stateRoot 配置接受但插件不访问其目录、不运行 Git、不注册恢复工具或 HTTP 路由。新配置只含 Markdown root，CLI 的 init／check／start 不要求 Git。

`NotesStore.open(root)` 沿用文件／路径／大小和 SHA-256 版本检查。核心工具为 list／browse／search／read／create／save／rename／capture；capture 仅保留兼容工具接口，页面原话直接通过普通新建保存。列表不读取整库正文，正文搜索使用固定 ripgrep。页面经 Harness 同源 Connection HTTP 访问业务服务，浏览器不直接访问磁盘。

CodeMirror 6 与 Lezer 提供 Markdown 编辑，markdown-it／DOMPurify 提供独立安全预览，禁止 HTML 和主动外部资源。编辑会话用 sessionId 隔离；打开另一篇或保存副本产生新会话，首次创建确认与同篇改名保留会话，从而隔离撤销并保留光标。局部编辑映射回原文本，保留未触及的 BOM／换行／空白。

## 兼容边界

`history.mjs`、存储服务的显式 stateRoot 参数、旧离线维护／恢复辅助与其文件测试仅用于已有资料兼容，不在当前插件默认链路运行。旧笔记恢复用例已退出当前浏览器验收，可从 git 历史查阅；不以“兼容”重新展示这些产品入口。旧数据不迁移、不删除。

新组合配置仅给笔记传 root，已生成的固定旧组合配置仍可使用；预检不改写旧配置或资料。笔记目录与运行 home／SQLite 分开。NAS 暂作备份方向，不把未经验证的 SMB／NFS 或双向同步目录当工作盘。

固定 Harness 和宿主 React 18.3.1；笔记编辑器、待办 Lucide／Autosize 组件均使用宿主 React。Astryx Neutral 0.7.11 静态 token 只作用于插件根，不引入其要求 React 19 的组件。保持 CSP、原生身份与权限机制，不另造逐文件审批或多租户隔离。

## 实际验收

当前笔记浏览器验收以 `test/core_browser.py` 为准，在真实发布版 Harness 覆盖无恢复入口／无笔记 IndexedDB、旧状态目录不变、新建／读写／改名、撤销隔离／改名保留撤销、提交中继续输入、组字暂停、未知结果核对、冲突副本、宿主面板切换保存及桌面／390px 布局。Node 测试分别记录核心与旧存量兼容工具的证据，不把旧功能通过当当前产品能力。

待办保留既有五套检查；笔记共存流程改为直接自动保存，详情打开时列表的 `/` 查找快捷键已修正。源码 launcher 有真实两包加载／401／SIGTERM 检查，旧应用回归仅保护历史链路。

以上均使用合成资料，无真实模型或通知调用。物理手机、原生输入法、WebKit、真实 DeepSeek、远程访问部署、实际 systemd 自启／设备重启、NAS 与完整实例恢复仍未验收。

本轮实测：笔记 51 项 Node 中 50 通过、1 项旧 restic 兼容演练因环境无该程序跳过；当前核心浏览器流程通过。待办 12 项 Node、原有五套浏览器检查（含更新后的共存及详情查找快捷键流程）、源码组合启动 4 项、旧应用 59 项 Node 和三套浏览器回归通过。新版未向旧笔记历史目录写入，也未访问笔记 IndexedDB；旧存量兼容工具的测试不代表这些功能仍在产品中。
