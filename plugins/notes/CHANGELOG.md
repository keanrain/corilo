# @corilo/dsh-notes 变更记录 / Changelog

此文件记录当前可分发代码，不代表已经发布 npm。后续每个版本单独记录变更与兼容边界。

This records currently distributable code, not an npm publication. Maintain changes and compatibility boundaries separately for each future version.

## Unreleased / 未发布

- 自有工作区与 classic 界面跟随 DSH 中英文设置，语言切换保留草稿及编辑器状态；补齐双语安装文档与英文 CLI。
  Owned workspace/classic UI follows DSH Chinese/English settings while preserving drafts and editor state; add bilingual installation docs and English CLI output.

## 0.7.0

- 提供固定 Files.md 工作区、宿主文件适配、版本冲突保护及原生 Agent 接入。
  Provides the pinned Files.md workspace, host file adaptation, version-conflict protection, and native Agent integration.
- 保留 classic 界面与现有配置兼容，不自动迁移用户数据。
  Retains the classic interface and existing configuration compatibility without automatically migrating user data.
- 当前构建固定兼容 DSH 0.2.2-rc.3，Node.js ≥24.9.0。
  The current build is pinned to DSH 0.2.2-rc.3 and Node.js ≥24.9.0.
- 当前分发渠道为本地 tgz；包保持 private，尚未公开发布 npm。
  Distributed as a local tgz; the package remains private and has not been publicly published to npm.
