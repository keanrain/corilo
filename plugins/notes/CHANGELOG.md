# @corilo/dsh-notes 变更记录 / Changelog

此文件记录当前可分发代码，不代表已经发布 npm。后续每个版本单独记录变更与兼容边界。

This records currently distributable code, not an npm publication. Maintain changes and compatibility boundaries separately for each future version.

## 0.9.0

- 笔记面板只用于查看和编辑笔记：不再显示收集页和侧栏「收集」入口，去掉工作区顶部的 Agent 按钮。上游打开收集页的各条路径（启动、空闲计时、快捷键、删除当前笔记）改为保持或打开笔记。磁盘上已有的 `Chat.md` 不删除、不改动。
  The notes panel is for reading and editing only: no capture page or capture tree entry, and no Agent button in the workspace. Upstream paths that opened the capture page keep or open a note instead. An existing `Chat.md` is left untouched on disk.
- 工作区打开上次查看的笔记，没有则打开最近修改的笔记；资料为空时显示「新建笔记」。
  The workspace opens the last note read, else the most recently changed one; an empty library offers "New note".
- 配色与待办统一：暖灰侧栏、白色正文、单一蓝色强调，替换原主题的高对比蓝／橙／荧光绿；浅深色均适配。
  Colours match the task planner (warm grey sidebar, white page, one blue accent), replacing the high-contrast blue/orange/lime accents, in light and dark.

## 0.8.0

- 修复 Files.md 图片资源被当作文本转码、浏览器无法解码的问题（如收集页空状态图标）。图片、字体等二进制资源现在原样返回。
  Fix Files.md images being re-encoded as text and failing to decode (for example the capture empty-state icon). Binary assets are now served byte for byte.
- Files.md 界面文案跟随 DSH 语言：工具栏提示、收集输入框与空状态、收集条目操作、右键菜单、原生对话框，以及侧栏的「收集」「日记」系统项。vendor 文件保持原样，笔记名与正文不翻译。收集条目操作按钮补充无障碍名称。
  Files.md interface strings follow the DSH language at runtime; vendor files are unchanged and note names/contents are never translated. Capture actions gain accessible names.
- 工作区默认打开收集页。新笔记按界面语言命名为「未命名」/「Untitled」，并选中占位标题，直接输入即可命名。
  The workspace opens on the capture page. New notes are named 未命名/Untitled with the title selected, so typing names the note.

## 0.7.1

- 将 CodeMirror、Lezer、DOMPurify 与 markdown-it 移为构建依赖，移除未使用的 `uuid`。生产安装继续使用已构建的客户端。
  Move CodeMirror, Lezer, DOMPurify and markdown-it to build dependencies and remove the unused `uuid` dependency. Production installs use the bundled client.
- 整理中英文安装指引，保留 DSH 版本、Files.md 与 classic 兼容性。
  Refresh both installation guides with the same DSH pin and Files.md/classic compatibility.

## 0.7.0

- 自有工作区与 classic 界面跟随 DSH 中英文设置，语言切换保留草稿及编辑器状态；补齐双语安装文档与英文 CLI。
  Owned workspace/classic UI follows DSH Chinese/English settings while preserving drafts and editor state; add bilingual installation docs and English CLI output.

- 提供固定 Files.md 工作区、宿主文件适配、版本冲突保护及原生 Agent 接入。
  Provides the pinned Files.md workspace, host file adaptation, version-conflict protection, and native Agent integration.
- 保留 classic 界面与现有配置兼容，不自动迁移用户数据。
  Retains the classic interface and existing configuration compatibility without automatically migrating user data.
- 当前构建固定兼容 DSH 0.2.2-rc.3，Node.js ≥24.9.0。
  The current build is pinned to DSH 0.2.2-rc.3 and Node.js ≥24.9.0.
- 当前分发渠道为本地 tgz；包保持 private，尚未公开发布 npm。
  Distributed as a local tgz; the package remains private and has not been publicly published to npm.
