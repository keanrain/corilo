# 开发工具与兼容入口

**简体中文** | [English](README.en.md)

当前产品源码在 [plugins/](../plugins/README.md)，统一启动实现在 [launcher/](../launcher/README.md)。本目录不再混放主启动实现。

| 文件 | 用途 |
|---|---|
| `check-dsh-versions.mjs` | 只读检查三包清单、锁文件、已登记源码引用及导师市场索引的 DSH 兼容版本 |
| `prepare-release.mjs` | 独立构建、测试并打包指定产品，输出校验和与版本说明；不发布 npm |
| `test/` | 开发检查与发版准备脚本的回归测试，不依赖根运行包 |
| `corilo.mjs` | 旧源码入口的兼容转发；规范入口为 `launcher/corilo.mjs`，两者读取同一实例配置 |
| `vendor-astryx.mjs` | 从固定版本、校验 SHA-256 的 Astryx CSS 选取局部设计 token，无网络/React 安装 |
| `p0.py`、`verify_delete_guard.py`、`verify_pinned.py` | 历史 Files.md P0 取证及回归工具，沿用原有路径 |
| `publish_github.py` | 历史仓库 bootstrap 工具，读取根 `repository-bootstrap.json`；不是 npm 发布工具 |

历史工具原位保留，部分脚本按自身相对位置计算仓库根，并被既有 CI/取证记录引用；本轮不移动或执行它们。旧实现背景见 [历史应用说明](../docs/history/LEGACY-APP.md)。统一 systemd 示例在 [deploy/systemd/](../deploy/systemd/README.md)。

运行 `npm run check:dsh` 和 `npm run test:tooling` 检查开发约束；独立发版准备见 [分发指南](../docs/RELEASING.md)。
