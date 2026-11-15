# @corilo/learn-anything 变更记录 / Changelog

此文件记录当前可分发代码，不代表已经发布 npm。后续每个版本单独记录变更与兼容边界。

This records currently distributable code, not an npm publication. Maintain changes and compatibility boundaries separately for each future version.

## Unreleased / 未发布

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
