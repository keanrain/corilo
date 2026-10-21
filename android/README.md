# Android 开发构建

> 2026-10-21：主路线已切到云端笔记，本工程暂停。以下为保留的历史构建说明；当前分支仅支持手动 CI，不再自动构建 APK。此修改不会取消旧分支正在运行的任务。

当前为 **Android 集成工程，尚无可用 APK**。Activity、WebView、前台服务、校验解包和 Node 宿主入口已实现；Corilo 前缀的 ARM64 Node/Git/Bash 尚未构建成功，未做手机运行验收。业务范围和实现边界以 [v0.12 技术设计第 13 节](https://github.com/keanrain/corilo/blob/e25edb9/docs/TECHNICAL_DESIGN.md#13-android-集成工程2026-10-09) 为准。

## 工具与空间

- Linux x86_64，Docker，可用空间预留至少 **80 GiB**（保守构建预算，不是测得的最小值）；当前 32 GB 云环境在容器准备阶段两次耗尽磁盘。
- JDK 17 或 21、Android SDK Platform 36 / Build Tools 36.0.0、Python 3.12、Node 24 / npm 11。
- 固定的 Termux packages commit、构建镜像 digest、包名和 prefix 见 [runtime-source.json](runtime-source.json)。不可换用官方 `com.termux` bootstrap，也不可通过修改二进制字符串更换前缀。

配置 SDK 的 `ANDROID_HOME` 或本机 `android/local.properties`。只读 HOME 环境可设置 `ANDROID_USER_HOME` 和 `GRADLE_USER_HOME` 指向可写的工具缓存目录。Gradle 不自动沿用 shell HTTP 代理；需要时使用它支持的 proxyHost/proxyPort 配置及组织提供的受信任证书，不关闭 TLS 校验。

## GitHub Actions 完整构建

新增 `.github/workflows/android-apk.yml`：当前云端分支已移除 push 触发；工作流合入默认分支后可通过 Actions → Android APK → Run workflow 手动运行。现有 Android source checks 仍独立运行。

运行时和 APK 分成两个 Ubuntu 24.04 runner。运行时任务只清理该临时 runner 不需要的预装工具，继续执行 80 GiB 空间检查；空间不足会明确失败，不降低检查或上传空壳。首次构建最多 350 分钟，能否在普通 GitHub runner 的空间/时间配额内完成仍待实测；私有仓库消耗账户的 Actions 分钟与存储额度。

成功的 ARM64 runtime 按构建脚本和来源锁的哈希缓存；恢复时重新检查 SHA-256、Corilo 前缀和必需 ELF，不使用其他版本或 `com.termux` 缓存。APK 任务重新按 npm 锁文件准备应用资产，运行 Node/Python/安装器检查并由 Gradle 打包。失败时保留 runtime 编译日志。

成功后在该次 Actions 页的 Artifacts 下载 `corilo-arm64-debug`，内含 APK、SHA-256、源码提交号和载荷来源清单；保留 14 天。这是调试构建，不是正式发布。每个新 runner 的调试签名可能不同，因此不能据此保证覆盖升级；不要为安装另一个调试包而卸载存有唯一笔记的版本。稳定签名和对应源码交付仍是正式分发前的工作。

工作流存在不代表首次构建已成功；设备运行验收、Pi 原生配置入口和 Git 凭据接入仍未完成。

## 编译实际运行组件

在仓库根目录执行：

```bash
android/scripts/build-runtime.sh
```

脚本只修改忽略目录中的固定版本 Termux 源码，将应用包名改为 `io.corilo.app`，独立构建 aarch64 bootstrap，加入 Node、npm、Git、Bash、搜索工具及证书。输出为 `.local/termux-packages/bootstrap-aarch64.zip`，并打印 SHA-256。不要复用其他包名前缀的编译缓存。

构建链的源码/镜像站需可访问。组织代理环境应先在专用 builder 内配置环境提供的可信 CA；此前实测容器缺少该 CA 时 TLS 校验失败，未通过关闭校验绕过。

构建成功后，把实际摘要传给打包器：

```bash
python3 android/scripts/prepare-payload.py --bootstrap .local/termux-packages/bootstrap-aarch64.zip --sha256 <实际校验值>
```

打包器检查目标前缀、ARM64 ELF、必需文件及链接路径；按根锁文件执行 Android/ARM64 的 `npm ci --ignore-scripts`。模型配置、知识库及凭据不参与构建。运行组件与应用代码作为独立归档附带 SHA-256，保留依赖许可。所有生成资产均被 Git 忽略。

## Java 检查与 APK

不需要运行组件即可执行源码级检查：

```bash
python3 -m unittest discover -s android/tests -p 'test_*.py' -v
./android/gradlew -p android :app:compileDebugJavaWithJavac
mkdir -p .local/android-java-tests
android_classes=android/app/build/intermediates/javac/debug/compileDebugJavaWithJavac/classes
javac -source 17 -target 17 -cp "$android_classes:$ANDROID_HOME/platforms/android-36/android.jar" -d .local/android-java-tests android/tests/InstallerChecks.java
java -cp ".local/android-java-tests:$android_classes:$ANDROID_HOME/platforms/android-36/android.jar" io.corilo.app.InstallerChecks
```

已在当前环境通过实际 Gradle Java 编译（17 个任务链），并用其产出的类执行安装器检查；不要用单独 javac 加 android.jar 冒充 Android API 编译，JDK 类库可能掩盖 API 差异。这仍是宿主 JVM 的归档检查，不是 Android 设备测试。完整资产准备好后：

```bash
cd android
./gradlew :app:assembleDebug
```

缺失或摘要不匹配时 `verifyRuntimePayload` 阻止资产合并，不能打出缺少运行环境的 APK。Debug 使用本机生成的调试签名，未使用 Termux 公开测试密钥；发布签名、公证/商店分发、升级验收均未完成。当前 target SDK 28 是私有可写目录执行程序的侧载路线，不是 Google Play 方案。入口仅接受 Android 15+ ARM64，但 15/16/17 实际安装与执行仍须验证。

## 来源与未完成项

Gradle wrapper 来自固定 Termux app checkout 中的 Gradle 生成文件，保留 Apache-2.0 头；Gradle 分发锁为 8.13 和官方 SHA-256。Android Java 文件是本项目的新代码，未复制 Termux Activity/Service。运行组件使用 Termux packages 构建配方，必须随分发履行各运行组件（包括 GPL）的许可和对应源码交付要求；目前未分发 APK。

仍须完成：自定义 runtime 构建；Pi 原生配置在设备上的操作入口（不做另一套模型表单）；Android Git 凭据接入；真机 Pi/DeepSeek 与 Git 同步；后台回收、服务停止/重启、键盘/中文输入、升级保留数据；签名与源代码交付。当前代码不得当作这些能力已经通过验收。
