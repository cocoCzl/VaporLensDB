# 打包与发布

[English](PACKAGING.md) · [返回 README](../README.zh-CN.md)

当前开发阶段采用 **source-first**，在目标操作系统上构建供本地使用的安装包。
公开二进制 release、DMG 上传、Developer ID 签名和 notarization 均暂缓。下文的
RC、上传和正式发布章节保留为工程流程，不是当前安装入口，也不构成发布授权。
使用者请从 [INSTALL.zh-CN.md](INSTALL.zh-CN.md) 开始。

不得将安装包或校验和提交到仓库或附加到 Pull Request，也不得把本地 QA artifact 直接
上传到 GitHub Release。手动打包工作流生成的 Actions 产物保留 7 天。

## 常用打包流程

在 macOS 上执行：

```bash
./build.sh current
```

Apple Silicon 的 canonical 本地 QA 产物为：

```text
artifacts/macos/aarch64/
├── VaporLensDB.app
├── VaporLensDB.dmg
└── SHA256SUMS.txt
```

已验收的 fresh clone/打包路径是 Apple Silicon macOS。Intel 目标使用
`artifacts/macos/x86_64/`，但上述证据不代表 Intel runtime/打包已验收。校验本地 DMG：

```bash
cd artifacts/macos/aarch64
shasum -a 256 -c SHA256SUMS.txt
```

预期输出为 `VaporLensDB.dmg: OK`。Windows 和 Linux 的固定名称 QA 产物分别位于
`artifacts/windows/<架构>/` 和 `artifacts/linux/<架构>/`。

日常 QA 和 release staging 应从 `artifacts/` 取用产物，不要从 `target/` 挑选文件发布：
`src-tauri/target/` 是 Cargo/Tauri 构建工作区，`artifacts/` 才是 VaporLensDB 整理后的
canonical staging 目录。

## 本地 QA 打包

开发期间可用本地打包验证目标平台行为。不得将生成的 DMG、MSI、NSIS、AppImage、DEB
或 RPM 直接描述为可公开获取的软件；公开 RC artifact 必须经过下文独立的批准流程。

## Artifact 类型

- **本地 QA artifact：**由 `./build.sh current` 生成，用于本地测试；构建成功本身不使其
  成为公开发布。
- **GitHub Pre-release / RC artifact：**基于获准的 release commit，在 tag 方案、clean
  build、平台证据与 checksum 均通过后生成；GitHub 必须将其标记为 Pre-release。
- **Stable release：**需要独立 stable-release gate；RC 不得描述为 stable 或
  production-ready。

## 前提条件

请遵循[工具链政策](INSTALL.zh-CN.md#工具链政策)：按锁定测试依赖的要求使用当前
Node 22.x 补丁（至少 22.22.2）或 24.x 补丁（至少 24.15.0）、pnpm 10、
包含 rustfmt/clippy 的当前 stable Rust，以及用于项目自有 JDBC bridge 的 JDK 21。
这些选择不代表承诺已完整测试整个兼容范围，厂商 JDBC JAR 不是构建前提。

已验证的 Apple Silicon 源码构建不需要完整 Xcode、Apple Developer Program 会员、
Developer ID 证书或公证凭据。

macOS 还需要 Xcode Command Line Tools。Windows 还需要带 MSVC 工具链的 Microsoft
C++ Build Tools、Microsoft Edge WebView2 Runtime 和 Git Bash。Linux 还需要 Tauri
要求的 WebKitGTK、GTK 开发包及 `rpm` 打包命令。缺少平台依赖时请参阅最新的
[Tauri 前提条件](https://v2.tauri.app/start/prerequisites/)。

首次安装 JavaScript 依赖：

```bash
pnpm install --frozen-lockfile
```

## build.sh 命令

- `./build.sh` 或 `./build.sh current`：校验并为当前平台打包。
- `./build.sh check`：只运行校验，不生成安装包。
- `./build.sh mac`：校验后替换本地 macOS App 和 DMG 产物。
- `./build.sh windows`：校验后替换 Windows 的 MSI 和 NSIS 本地产物。
- `./build.sh linux`：校验后替换 Linux 的 AppImage、DEB 和 RPM 本地产物。
- `./build.sh live-tests --mysql --oracle`：显式运行选定的 JDBC 真实集成测试。
- `VAPORLENSDB_ALLOW_DESTRUCTIVE_INTEGRATION=1 ./build.sh destructive-live-tests --mysql`：在 disposable 环境中显式运行 CREATE/DROP DATABASE 测试。
- `./build.sh jdbc-bridge`：只构建 Java JDBC bridge。

校验和打包命令具有确定性：不会读取 `.env`，也不会运行外部数据库测试。真实数据库覆盖
必须显式选择，变量和数据库权限说明见[测试文档](TESTING.md)。

每个打包命令都会先构建 VaporLensDB 自有的 JDBC bridge，并将其作为应用资源打入安装包。
Oracle 和自定义 JDBC 的厂商驱动仍由用户从本地选择，绝不会复制进安装包。

## 本地 QA 打包前校验

每台构建机器生成安装包前均应执行：

```bash
./build.sh check
```

该命令会构建 JDBC bridge，执行前端 lint 与构建，并以禁止警告的方式执行 Rust clippy
和确定性 Rust 测试。它不会读取 `.env`，也不会自动运行 PostgreSQL、MySQL、Oracle 等
真实数据库测试或 live integration tests；需要通过 `./build.sh live-tests ...` 或
`./build.sh destructive-live-tests ...` 显式选择相应测试。

## 构建产物

### macOS

在 macOS 上执行：

```bash
./build.sh mac
```

产物：

```text
src-tauri/target/release/bundle/dmg/VaporLensDB.dmg
artifacts/macos/<架构>/VaporLensDB.app
artifacts/macos/<架构>/VaporLensDB.dmg
artifacts/macos/<架构>/SHA256SUMS.txt
```

`dist/` 是 Vite 生成的前端资源，Tauri 会将其打进 App；它不是安装包目录，可删除后由
`pnpm build` 重新生成。`src-tauri/target/` 是 Cargo/Tauri 的原始构建目录。执行
`./build.sh mac` 或 `./build.sh current` 时，Tauri 会先生成
`src-tauri/target/release/bundle/macos/VaporLensDB.app`，但它只是临时打包中间产物。
脚本会先创建 DMG、将 App 和 DMG 复制到 staging，并生成校验和；以上步骤全部成功后才
删除 raw App。若构建中途失败，允许该中间产物暂时残留，之后可由
`./build.sh clean-macos-app-index` 安全清理。
raw DMG 会保留在 `src-tauri/target/release/bundle/dmg/VaporLensDB.dmg`。

`artifacts/` 是便于本地取用的汇总目录，已被 Git 忽略。每次成功构建都会替换当前架构目录，
其中只保留最新的 App、DMG 和校验和。staged App 是 canonical 本地 QA App，也是唯一长期
注册到 LaunchServices 的 `com.vaporlens.db` bundle，从而避免 raw intermediate 与 staged
copy 同时显示为重复应用。已挂载 DMG 只作为临时安装介质，不作为长期本地 identity。
因此重复成功执行 `./build.sh current` 不会累积多个普通 VaporLensDB identity。开发态继续
使用独立的 `src-tauri/target/debug/VaporLensDB-dev.app` identity。
`.app` 可在 macOS 上直接运行，`.dmg` 是包含 App 和“应用程序”快捷方式的安装镜像。
在 Pre-1.0 Development 阶段，两者都只是本地 QA artifact。

Apple Silicon 的 `<架构>` 为 `aarch64`，Intel Mac 为 `x86_64`。打包前脚本会校验
`package.json`、`src-tauri/tauri.conf.json` 与 `src-tauri/Cargo.toml` 的版本是否一致。

### Windows

在 Git Bash 中执行：

```bash
./build.sh windows
```

也可以从 PowerShell 执行 `pnpm build:windows`，但 Git for Windows 的 `bash.exe` 必须
已加入 `PATH`。

产物：

```text
src-tauri/target/release/bundle/msi/*.msi
src-tauri/target/release/bundle/nsis/*.exe
artifacts/windows/<架构>/VaporLensDB.msi
artifacts/windows/<架构>/VaporLensDB-Setup.exe
artifacts/windows/<架构>/SHA256SUMS.txt
```

### Linux

安装 Tauri 所需的 WebKitGTK 4.1、GTK 3、AppIndicator、librsvg、OpenSSL 开发包和
`rpm` 命令后执行：

```bash
./build.sh linux
```

产物：

```text
src-tauri/target/release/bundle/appimage/*.AppImage
src-tauri/target/release/bundle/deb/*.deb
src-tauri/target/release/bundle/rpm/*.rpm
artifacts/linux/<架构>/VaporLensDB.AppImage
artifacts/linux/<架构>/VaporLensDB.deb
artifacts/linux/<架构>/VaporLensDB.rpm
artifacts/linux/<架构>/SHA256SUMS.txt
```

Windows 和 Linux 根据 Rust 原生 host 使用 `x86_64` 或 `aarch64`，脚本不执行跨架构编译。
每次成功构建只替换当前系统、当前架构的目录。Tauri 已忽略的原始输出可以带版本号，供本地
取用的 `artifacts/` 始终使用上述固定名称。

`./build.sh current` 与 `pnpm build:app` 会在 macOS、Windows、Linux 上自动选择对应包型。

## 手动云端打包验证

在 GitHub Actions 页面手动运行 **Package smoke test**，会使用 `macos-latest`、
Ubuntu 22.04 和 `windows-latest` 执行同一套校验与打包。工作流不使用真实数据库凭据，
固定名称的测试产物保留 7 天；它不会创建 tag 或 GitHub Release。原生 `aarch64` 包仍需
对应架构的构建机器。

## Pre-1.0 RC 测试分发

Pre-1.0 RC 只有在获得明确批准后才能发布：

1. 批准 release commit 并确定 RC tag；不能只为加入 RC 后缀而修改应用内部版本。
2. 在 clean workspace 中 checkout tag，安装 lockfile 固定的依赖，运行确定性 gate 并构建
   对应平台安装包。
3. 只发布具备当前 runtime evidence 的平台；每个候选版本的平台和 asset 集合由当次
   release plan 决定。
4. 上传前验证 artifact metadata 与 checksum。不得上传 raw build 目录、secret、
   credential、log、vendor JDBC JAR 或内部 review 文档。
5. 创建明确标记为 **Pre-release** 的 GitHub Release，并写明支持平台、已知限制、签名状态
   与 checksum 验证方式。
6. 在公开 Pre-release 前，将已上传 asset 下载到新目录并重新验证 checksum。

RC 是测试分发，不是 stable 或 production-ready release。历史提案与已有证据保留在
[已暂缓的 0.9.1 RC 1 计划](release/0.9.1-rc.1.md)；后续候选版本应维护各自的
release-specific plan，不应把该文件中的 tag 或平台范围复制为本通用指南的永久规则。

## 手动上传 GitHub Release asset

安装包和 checksum 是 Release asset，不是 Git 源文件。尤其不要执行
`git add VaporLensDB.dmg`，也不要把生成的安装包提交到仓库。

通过 GitHub 网页手动上传时：

1. 打开 **Releases**，选择 **Draft a new release**。
2. 选择已经批准的 tag，填写 release title 和 notes。
3. RC 必须勾选 **Set as a pre-release**，不得标记为 latest stable release。
4. 只上传当次 release plan 指定的 asset；macOS RC 通常为 `VaporLensDB.dmg` 和
   `SHA256SUMS.txt`。
5. 发布前将已上传 asset 下载到新目录，并使用下载的 checksum manifest 重新验证。

已安装且完成认证时，可选择使用 `gh` CLI 完成等价操作；发布流程不依赖 `gh` CLI。

## Stable 分发

仅在版本正式获准 stable 发布后才能执行本节；此前的 RC Pre-release 不能替代
stable-release gate。

1. 确认 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 中的版本号一致。
2. 对当前 stable support matrix 中的每个平台完成校验与构建；每个发布平台都必须有
   当前 runtime evidence。
3. 只收集当次 release plan 与 `SUPPORT.md` 定义的 asset；仅在确实需要独立分发时才
   上传 macOS App bundle。
4. 将获准的安装包复制到同一个发布暂存目录，再只为这些 asset 生成校验和清单。例如，
   macOS-only release 可以使用：

   ```bash
   shasum -a 256 VaporLensDB.dmg > SHA256SUMS.txt
   ```

   其他 asset 集合应使用对应平台的 SHA-256 工具，并确保 manifest 中的文件名与实际上传
   的 asset 文件名完全一致。

5. 更新 `CHANGELOG.md`，创建对应 Git tag 和 GitHub Release，上传安装包与
   `SHA256SUMS.txt`，并说明用户可见的变更和已知限制。
6. 在发布前从草稿 Release 下载每个附件并再次校验其 SHA-256。

在真正启用并验证 Developer ID 签名或公证前，不要在 Release 中声称安装包已经正式签名
或已公证。当前候选版本的具体签名与公证状态应记录在 release-specific plan 中，不能根据
打包成功自行推断。不得添加自动 Gatekeeper bypass。

## 未来签名阶段的 macOS entitlement 审查

release entitlement plist 现在只显式保留
`com.apple.security.app-sandbox=false`。VaporLensDB 面向 Developer ID 直接分发，
并非 Mac App Store sandbox 模式：它需要用户选择数据库文件和 JDBC JAR、连接任意数据库
端点、启动本地 Java 进程及可选 SSH 集成。经过受控 release-mode 构建和启动验证后，
`allow-jit`、`allow-unsigned-executable-memory`、
`disable-library-validation` 三项 exception 已移除。

macOS 打包会通过 `scripts/tauri-release-build.sh`，由当前构建机动态生成 Rust
source-path remapping，避免将本机 workspace、Cargo 或 Rustup 路径留在可分发
executable string 中。只检查本地 `.app` 时使用 `pnpm build:release:macos`；该 focused
命令会有意保留 Tauri raw App，只有 `./build.sh mac` 和 `./build.sh current` 会把它作为
临时打包中间产物消费并删除。

正式流程见[macOS 签名与公证清单](release/macos-signing.md)。本仓库配置仍未实际启用
Developer ID 签名或 notarization。
