# 开发工具与兼容入口

当前产品源码在 [plugins/](../plugins/README.md)，统一启动实现在 [launcher/](../launcher/README.md)。本目录不再混放主启动实现。

| 文件 | 用途 |
|---|---|
| `corilo.mjs` | 旧源码入口的兼容转发；规范入口为 `launcher/corilo.mjs`，两者读取同一实例配置 |
| `vendor-astryx.mjs` | 从固定版本、校验 SHA-256 的 Astryx CSS 选取局部设计 token，无网络/React 安装 |
| `p0.py`、`verify_delete_guard.py`、`verify_pinned.py` | 历史 Files.md P0 取证及回归工具，沿用原有路径 |
| `run_local.py` | 历史原型运行辅助，不启动当前 Harness 插件 |
| `publish_github.py` | 历史仓库 bootstrap 工具，读取根 `repository-bootstrap.json`；不是 npm 发布工具 |

历史工具原位保留，部分脚本按自身相对位置计算仓库根，并被既有 CI/取证记录引用；本轮不移动或执行它们。旧实现背景见 [历史应用说明](../docs/history/LEGACY-APP.md)。统一 systemd 示例在 [deploy/systemd/](../deploy/systemd/README.md)。
