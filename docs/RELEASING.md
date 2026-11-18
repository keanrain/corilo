# 子项目分发与发版准备

**简体中文** | [English](RELEASING.en.md)

三个产品独立版本、依赖锁与分发包。根包和 launcher 不作为发行包；准备流程不运行 `npm publish`，不修改 private，不升级版本或迁移实例。

| 产品选择 | 包目录 | 当前版本 | 当前渠道 |
|---|---|---|---|
| `notes` | `plugins/notes` | 0.7.0 | 本地 tgz，private |
| `todos` | `plugins/todos` | 0.6.5 | 本地 tgz，private |
| `learn-anything` | `packages/learn-anything` | 0.1.0 | 本地 tgz，供已有 DSH 用户；未发布 npm |

## 准备一个产品

使用 Node.js ≥24.9.0。在仓库根先按所选包独立锁安装依赖，再执行准备命令，例如：

```sh
npm --prefix plugins/todos ci --ignore-scripts
npm run prepare:release -- todos
```

notes 对应 `npm --prefix plugins/notes ci --ignore-scripts`；导师对应 `npm run setup:learn-anything`。脚本不自动安装依赖。notes 的完整备份测试需要 restic；缺少时包测试可能报告跳过，不能据此宣称备份验收通过。

默认输出到 `dist/releases/<product>/<version>/`，目录已存在时拒绝覆盖。可指定一个新的输出目录：

```sh
npm run prepare:release -- learn-anything --output /absolute/new-release-directory
```

脚本依次验证包和独立锁的名称／版本、该版本的 CHANGELOG 条目、精确 DSH 兼容版本，运行所选包的 build 与 Node 测试，再用 `npm pack` 生成该包。打包阶段禁用 lifecycle，因为构建已显式执行。脚本核对包身份、公开入口文件，以及文件清单中是否包含测试、node_modules、运行资料或常见凭据文件名；这不是任意内容的秘密扫描。

输出包含 `.tgz`、`SHA256SUMS`、`release.json` 和该版本的 `RELEASE_NOTES.md`。元数据记录包版本、DSH／Node 要求、内容文件数、校验和及实际执行的检查；不会标记为已发布。失败时不保留未验证的输出包，既有产物不受影响。

## 每个版本的维护

1. 仅调整目标包版本，并使用 npm 同步它自己的锁文件；三个产品不要求同步升级版本。
2. 在该包 `CHANGELOG.md` 增加 `## <精确版本>`，记录实际变更、数据和兼容边界。已经分发的内容发生变化时采用新版本，避免同版本不同包。
3. DSH 升级同时遵循仓库版本一致性检查；不要依据 npm latest 标签猜版本。
4. 运行准备命令，并根据改动运行真实宿主、浏览器及升级／恢复验收。准备脚本的 Node 测试不替代这些检查。
5. 向接收者提供 tarball、校验和与变更说明，保留上一版本产物供回退。实例升级前保存输入、停服务并备份相应数据。

导师发版还需同步 `market/index.json` 的版本、兼容信息与发布时间；索引指向 npm 时必须先有相应已发布包。当前本地 tgz 可直接安装到已有 DSH，不能将索引存在描述为市场可安装。若以后决定公开 npm 发布，再单独确定发布权限和渠道；本流程不执行该操作。

具体安装和数据边界见 [notes](../plugins/notes/README.md)、[todos](../plugins/todos/README.md)与[导师](../packages/learn-anything/README.md)。当前 CI 检查及运行限制见 [开发指南](DEVELOPMENT.md)。

## GitHub Releases

在获得发布授权后，将 `packages-YYYYMMDD`（同日另一次发布可加 `.1` 等后缀）标签指向已经合入 main 的提交并推送，可触发 `Publish package prerelease`。普通分支推送和 PR 不发布。

流程按三个独立锁安装依赖，重新构建、测试和验证所有包；notes 必须通过真实 restic 恢复测试。所有产品成功后才汇总附件，创建草稿 Release，上传三个 `.tgz`、各包变更记录、安装说明、SHA256 校验和与源码提交清单。下载回读并核对全部附件后才公开为预发布，不设为 latest，不执行 npm 发布或用户实例迁移。

发布作业单独持有 `contents: write`，构建作业只读。已存在的同名 Release 不覆盖；失败留下草稿时先检查原因，不自动删除或替换旧附件。准备元数据中的 `published: false` 表示准备步骤未执行发布；公开附件清单另记渠道为 `github-prerelease`、`npmPublished: false`。
