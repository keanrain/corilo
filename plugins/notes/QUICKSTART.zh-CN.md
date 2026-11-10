# 笔记插件：快速开始

0.6.0 只有新建、查找、编辑／改名和自动保存。文件是主机上的普通 Markdown，不需要模型密钥、Git、Corilo 账号或 stateRoot。

## 从源码运行

准备 Node.js ≥24.9.0 和 npm。在仓库根目录执行：

```sh
npm --prefix plugins/notes ci --ignore-scripts
npm --prefix plugins/notes run build
node plugins/notes/cli.mjs init --directory /absolute/corilo-instance
node plugins/notes/cli.mjs start --config /absolute/corilo-instance/notes.patch.json
```

实际路径请换成自己的绝对路径。初始化不覆盖配置、不迁移资料。沿用 Harness 打印的鉴权访问地址，不分享 token；关闭模型密钥引导后，点“笔记”即可使用。

笔记和待办一起使用，按[仓库入口](../../README.md)的 setup／init／start 命令操作。

## 安装收到的包

在一个新的安装目录执行：

```sh
npm init -y
npm install --ignore-scripts /absolute/corilo-dsh-notes-0.6.0.tgz
npx --no-install corilo-notes init --directory /absolute/corilo-instance
npx --no-install corilo-notes start --config /absolute/corilo-instance/notes.patch.json
```

包内已有客户端构建，不需要下载源码或安装构建工具。npm 仍需下载固定的生产依赖；本包尚未公开发布到 npm。已经有 DSH 的用户，可按 `notes.patch.example.yml` 加载包入口并传入 Markdown root，更新包后重启 DSH。

## 使用

直接输入或点“新笔记”，停止输入后自动保存。只有工具栏显示“已保存”才代表主机文件已确认。Ctrl／⌘S 可立即保存，点击标题可改名；正文支持 Markdown 格式、查找与撤销。

保存失败时输入留在当前页面；冲突可核对文件或保存副本。未知结果不自动重试创建。当前版本没有草稿库、历史或回收站，刷新／崩溃后不承诺找回未保存输入；未保存关闭页面会提醒。

## 从旧版升级

先在旧版保存未保存输入，再停止旧服务。新包装进新安装目录，保留旧安装、旧配置与资料。生成新安装配置：

```sh
npx --no-install corilo-notes rebind --config /absolute/old.patch.json --output /absolute/new.patch.json
npx --no-install corilo-notes check --config /absolute/new.patch.json
npx --no-install corilo-notes start --config /absolute/new.patch.json
```

旧 stateRoot 配置接受，但当前插件不读写旧目录、不再生成 Git 历史。原 Markdown、历史文件和浏览器草稿数据库均保留；旧浏览器数据需使用旧版在原来源读取，升级不自动导入。新旧服务不要同时运行。
