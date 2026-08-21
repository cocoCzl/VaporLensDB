# 打包与发布

[English](PACKAGING.md) · [返回 README](../README.zh-CN.md)

VaporLensDB 必须在目标操作系统上构建对应安装包。当前仓库不自动发布，也不包含
代码签名或 macOS 公证流程。

在正式版本获准发布前，所有安装包均为本地或临时测试产物；不得将安装包或校验和提交到
仓库、附加到 Pull Request 或发布为 GitHub Release。手动打包工作流生成的 Actions 产物
保留 7 天。

## 前提条件

所有构建机器都需要：

- Node.js 22 和 pnpm 10
- Rust stable
- JDK 21（用于 JDBC bridge）

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
- `./build.sh live-tests`：只运行已配置的真实数据库集成测试。
- `./build.sh jdbc-bridge`：只构建 Java JDBC bridge。

校验命令会读取可选且已被 Git 忽略的 `.env`。没有数据库配置时，联网测试保持忽略；配置组
完整时会运行对应测试，任何失败都会停止打包。变量和数据库权限说明见[测试文档](TESTING.md)。

每个打包命令都会先构建 VaporLensDB 自有的 JDBC bridge，并将其作为应用资源打入安装包。
Oracle 和自定义 JDBC 的厂商驱动仍由用户从本地选择，绝不会复制进安装包。

## 打包前校验

每台构建机器生成安装包前均应执行：

```bash
./build.sh check
```

该命令会构建 JDBC bridge，执行前端 lint 与构建，并以禁止警告的方式执行 Rust clippy
和 Rust 测试。已配置的真实数据库测试会一并执行，未配置的数据库组会明确显示为跳过。

## 构建产物

### macOS

在 macOS 上执行：

```bash
./build.sh mac
```

产物：

```text
src-tauri/target/release/bundle/macos/VaporLensDB.app
src-tauri/target/release/bundle/dmg/VaporLensDB.dmg
artifacts/macos/<架构>/VaporLensDB.app
artifacts/macos/<架构>/VaporLensDB.dmg
artifacts/macos/<架构>/SHA256SUMS.txt
```

`dist/` 是 Vite 生成的前端资源，Tauri 会将其打进 App；它不是安装包目录，可删除后由
`pnpm build` 重新生成。`src-tauri/target/` 是 Cargo/Tauri 的原始构建目录；`artifacts/`
则是便于本地取用的汇总目录，已被 Git 忽略。每次构建都会替换当前架构目录，其中只保留
最新的 App、DMG 和校验和。`.app` 可在 macOS 上直接运行，`.dmg` 是包含 App 和“应用程序”
快捷方式的安装镜像，私下测试分发应优先使用 DMG。

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

在 GitHub Actions 页面手动运行 **Package smoke test**，会分别使用 Ubuntu 22.04 和
`windows-latest` 执行同一套校验与打包。工作流不使用真实数据库凭据，固定名称的测试产物
保留 7 天；它不会创建 tag 或 GitHub Release。原生 `aarch64` 包仍需对应架构的构建机器。

## 正式版本：手动发布 GitHub Release

仅在正式版本获准发布后才能执行本节；测试构建不得执行上传步骤。

1. 确认 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 中的版本号一致。
2. 分别在 macOS、Windows 和 Linux 上使用以上命令完成校验与构建。
3. 收集 DMG、MSI、NSIS EXE、AppImage、DEB 和 RPM。仅在确实需要独立分发时才上传
   macOS App bundle。
4. 将安装包复制到同一个发布暂存目录，再在该目录生成校验和清单：

   ```bash
   # macOS（先将所有发布附件复制到当前目录）
   shasum -a 256 VaporLensDB.dmg VaporLensDB.msi VaporLensDB-Setup.exe \
     VaporLensDB.AppImage VaporLensDB.deb VaporLensDB.rpm > SHA256SUMS.txt

   # Windows PowerShell（先将所有发布附件复制到当前目录）
   Get-ChildItem VaporLensDB.dmg,VaporLensDB.msi,VaporLensDB-Setup.exe,`
       VaporLensDB.AppImage,VaporLensDB.deb,VaporLensDB.rpm |
     Get-FileHash -Algorithm SHA256 |
     ForEach-Object { '{0}  {1}' -f $_.Hash.ToLower(), $_.Path.Split('\\')[-1] } |
     Set-Content SHA256SUMS.txt
   ```

5. 更新 `CHANGELOG.md`，创建对应 Git tag 和 GitHub Release，上传安装包与
   `SHA256SUMS.txt`，并说明用户可见的变更和已知限制。
6. 在发布前从草稿 Release 下载每个附件并再次校验其 SHA-256。

在真正启用并验证签名或公证前，不要在 Release 中声称安装包已经签名或已公证。
