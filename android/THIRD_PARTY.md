# Android 构建来源

- Gradle wrapper：Gradle 项目生成的脚本与 JAR，Apache-2.0。取自 `termux/termux-app` 固定提交 `8629e632fcb95da272221be327db653fb24befe9` 中的 wrapper 文件，脚本版权头保留，JAR SHA-256 记录在 `runtime-source.json`。分发版本固定为 Gradle 8.13，校验值来自官方 `services.gradle.org`。许可：https://github.com/gradle/gradle/blob/v8.13.0/LICENSE 。
- Android Gradle Plugin：`com.android.application:8.13.2`，从 Google Maven 解析，没有把其二进制提交到仓库。
- Android Java 集成代码为 Corilo 新增，未复制 Termux app 的 Activity/Service；运行环境使用 `termux/termux-packages` 的固定构建配方，版本与镜像 digest 见 `runtime-source.json`。
- Files.md 与 Pi 的来源、许可沿用根 README 和依赖目录。应用 payload 不移除依赖的许可证文件。

尚未生成或分发 APK。运行组件包含不同许可证的软件（包括 GPL）；实际分发时需要核对完整依赖清单，提供适用许可证、版权声明及对应版本源码/构建修改，不能用本文件代替这些交付物。不得使用 Termux 公开测试签名作为 Corilo 发布签名。
