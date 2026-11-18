# Corilo 源码入口

**简体中文** | [English](README.en.md)

```sh
npm run setup:corilo
npm run init:corilo -- --directory /absolute/corilo-instance
npm run start:corilo -- --directory /absolute/corilo-instance
```

新实例加载 @corilo/dsh-notes Files.md 工作区与 @corilo/dsh-todos planner v2。setup 安装／构建两包。笔记保存为 Markdown 与附件，任务／日程使用独立 SQLite；两者不自动同步。实例目录包含 notes/、todos/、runtime/、workspace/ 和两份配置；位置必须在仓库外，勿分享鉴权 token。

规范入口是 launcher/corilo.mjs，scripts/corilo.mjs 保留兼容转发。已有单插件和 v1 双插件配置继续按原模式启动；预检不改写配置、迁移数据库或删除原文件。planner 必须使用新的空资料目录，不可直接用于旧 v1 库。可选 SQLite → Markdown 导出仅面向明确选择 Markdown 管理旧任务的用户，不是默认升级路径。

Linux 用户服务示例在 deploy/systemd/，只是人工审阅模板，不自动安装或启用。验证使用 npm run test:startup，覆盖默认 planner 组合与既有配置兼容。根 npm start/test 仍属于旧应用。
