# Corilo 工作区快速开始

0.7.0 将 Files.md 完整前端接入 Harness，一个插件处理笔记、Markdown 待办、收集与日记。先保留原生菜单和功能。资料保存在主机普通目录，不需要 Git、Corilo 账号或模型密钥。

## 源码三步

准备 Node.js ≥24.9.0。在仓库根目录：

```sh
npm run setup:corilo
npm run init:corilo -- --directory /absolute/corilo-instance
npm run start:corilo -- --directory /absolute/corilo-instance
```

目录换成仓库外的绝对路径。初始化只创建配置，不覆盖已有实例。使用 Harness 打印的鉴权地址，不分享 token；关闭模型引导后点击“笔记”。新实例只加载工作区包。

## 收到独立包

在新的安装目录：

```sh
npm init -y
npm install --ignore-scripts /absolute/corilo-dsh-notes-0.7.0.tgz
npx --no-install corilo-notes init --directory /absolute/corilo-instance
npx --no-install corilo-notes start --config /absolute/corilo-instance/notes.patch.json
```

已有 DSH 可按包内 notes.patch.example.yml 加载入口，指定主机 root。包升级后重启服务并刷新浏览器。固定 Harness 0.2.2-rc.1，不独立升级宿主猜兼容。

## 使用与升级

原生文件树、新建、查找、标题改名、分栏和清单按 Files.md 方式操作。顶部保存状态只有主机确认后才显示已保存。Chat 是直接写入 Chat.md 的收集界面；Agent 按钮切到 Harness 原生会话，返回保留工作区。普通记录不调用模型。

冲突和未知保存结果保留输入，先核对文件或明确保存副本，不自动重发。关闭未保存页面时提醒；刷新／崩溃恢复不作承诺。

旧双插件实例不自动改配置或迁移 SQLite。先停止相关服务并备份，再按 [迁移说明](README.md#existing-installations-and-sqlite-todos)预览、显式导入 Later.md，核对成功后移除旧 overlay 中的 corilo-todos 项；原数据库保留。旧笔记页可明确配置 interface: classic。

Linux 常驻参考 [Linux 指南](LINUX.zh-CN.md)。目标设备、远程访问、自启与 NAS 仍需实际验收，示例不会自动安装服务。
