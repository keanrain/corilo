# Corilo 源码启动入口

本目录将 `plugins/notes` 和 `plugins/todos` 组合到同一个 DeepSeek Harness 实例，复用 Harness 的 Web 服务、鉴权、模型配置和工具运行机制。它是源码仓库的启动脚本，不是第三个 npm 插件包。

在仓库根目录运行：

```bash
npm run setup:corilo
npm run init:corilo -- --directory /absolute/corilo-instance
npm run check:corilo -- --directory /absolute/corilo-instance
npm run start:corilo -- --directory /absolute/corilo-instance --port 3000
```

需要插件要求的 Node.js `>=24.9.0`。实例目录必须使用仓库外的绝对路径；配置、笔记、待办数据库和 Harness 运行资料保存在该目录。启动时使用 Harness 输出的私有鉴权地址，勿分享其中的 token。

规范入口为 `launcher/corilo.mjs`。旧 `scripts/corilo.mjs` 保留为兼容转发，已有命令和用户复制的服务仍可使用；已生成的实例配置与资料目录不需要迁移。

Linux 用户服务示例见 [`deploy/systemd/corilo.service.example`](../deploy/systemd/corilo.service.example)。该文件只是模板，需自行审阅并替换绝对路径；仓库不会自动安装或启用服务。

入口验证：`npm run test:startup`。根目录 `npm start`、`npm test` 仍属于旧应用。
