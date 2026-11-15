# 持久存储额度：诊断与剩余实施条件

2026-10-21。本文说明存储部署条件，不新增产品额度或用户套餐。容量由运营参数确定，业务边界仍以 [产品规格第 4 节](../../docs/PRODUCT-SPEC.md#4-隔离与额度) 为准。

## 当前可运行的只读诊断

```sh
node app/cloud/storage-preflight.mjs --data-root /absolute/existing/cloud-data
```

程序打开既有目录，用 `/proc/self/fdinfo` 的 mount ID 匹配 `/proc/self/mountinfo`，避免仅按最长路径误选被覆盖的挂载。输出文件系统、项目配额挂载选项是否存在、下级挂载数量与未验证项。不会创建目录、配置项目 ID、挂载磁盘、修改额度或尝试写满磁盘。

退出码 2 表示诊断完成但强制额度仍未验证；退出码 1 表示参数/读取失败。没有表示额度已生效的成功出口；`enforcement` 始终为 `unverified`，不能用于开放 Agent。即便 XFS 显示 `prjquota`，也不能推出某个用户已经有非零硬限制。`pqnoenforce` 不算强制配额选项。

本次实际开发环境 `/workspace` 是 overlay，未观察到强制项目配额选项；当前用户 UID 1000，无有效或可用 capability，环境内也未安装 `xfs_quota` 等工具。本次只读检查未验证任一用户磁盘硬额度，也没有修改宿主或启动特权容器。

## 推荐的实施方向与关键约束

首选评估专用 Linux 持久 XFS 卷及成熟项目配额工具。每个 vault 的 `knowledge`、`state` 与其余用户持久目录归属同一唯一项目；同时设置字节与 inode 硬限制，覆盖所有写入入口及现有数据。控制器 journal、模型 socket 和平台配置放在受控的独立空间。用户文件中的 `.git` 不是独立备份。

**项目配额本身还不够限制能执行 shell 的文件所有者。** 已核对 Linux v6.12 的 [`fs/ioctl.c`](https://github.com/torvalds/linux/blob/v6.12/fs/ioctl.c)：`vfs_fileattr_set` 接受 inode owner；`fileattr_set_prepare` 对项目 ID/PROJINHERIT 的禁止修改专门作用于非初始 user namespace。当前 worker 的非 root UID 和 `CapDrop=ALL` 不能据此证明初始 user namespace 中的文件所有者无法改项目 ID/清除继承。

因此，在把项目配额当强制边界前，必须选择并实测一种阻止 worker 修改配额归属的部署方式。例如明确配置且验证的 user namespace 映射，或能覆盖所有相关调用的系统调用限制；不能只看 Docker 配置中的 `User` 字段。若使用 seccomp，还要核对部署内核的新旧文件属性调用及兼容 ABI，不能仅屏蔽一个命令名称。不要直接把一份简化 seccomp allow-all 配置替换 Docker 默认防护。

如该部署约束不合适，可评估每用户独立、有固定容量且不暴露块设备的持久文件系统。它同样需要管理员准备、inode/空间验证、备份恢复和挂载生命周期管理；目前未实现，不为了本次开发在共享云环境格式化或挂载磁盘。

`du`、`statfs` 剩余量、上传大小限制、Docker 根层 `storage-opt size` 和 tmpfs 大小均不能替代用户 bind mount 的即时持久写入限制。磁盘满后的定时停止也不是硬额度。

## 开放前须获得的证据

1. 在实际部署卷上查询项目 accounting/enforcement、每库项目 ID、继承标记、非零字节/inode hard limit；核对所有现存文件与下级挂载覆盖，不能仅靠根目录标记。
2. 从正式 worker 的身份和隔离配置创建文件及子目录，尝试清除继承、改变项目 ID、移入/链接其他项目、经其他可写挂载绕过限额；都不能逃离本库额度。
3. 使用可丢弃小额度项目，分别实际触发字节和 inode 限制，检查错误、另一用户仍能写入，以及删除数据后恢复。文件编辑和 Pi 会话都须覆盖。
4. 验证 quota 初始化失败、配置缺失、检查失联或重挂载时不启动执行；确认控制器恢复不会把未配额目录当作可运行卷。
5. 在每次部署内核/容器隔离升级后复查边界，备份恢复后重新校验项目归属和限额；不要从历史检查结果推断当前卷已受保护。

现有三个诊断测试验证挂载身份选择、转义路径/边界、只统计不强制的选项、拒绝含糊快照及真实 Linux 只读检查；它们不是 XFS 配额验收。
