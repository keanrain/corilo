# Corilo 源码入口

```sh
npm run setup:corilo
npm run init:corilo -- --directory /absolute/corilo-instance
npm run start:corilo -- --directory /absolute/corilo-instance
```

新实例仅加载 @corilo/dsh-notes Files.md 工作区，个人待办使用普通 Markdown 清单，不新建 SQLite。setup 只安装／构建工作区包。统一目录包含 notes/、runtime/、workspace/ 和两份配置；位置必须在仓库外，勿分享鉴权 token。

规范入口是 launcher/corilo.mjs，scripts/corilo.mjs 保留兼容转发。旧双插件配置继续支持，需保留 plugins/todos 的安装依赖；预检不改写配置、迁移数据库或删除原文件。先停服务并按工作区指南迁移待办，核对后可从旧组合配置移除 corilo-todos 项。不能让旧服务继续维护另一份当前待办。

Linux 用户服务示例在 deploy/systemd/，只是人工审阅模板，不自动安装或启用。验证使用 npm run test:startup，同时覆盖单工作区启动及旧双插件启动。根 npm start/test 仍属于旧应用。
