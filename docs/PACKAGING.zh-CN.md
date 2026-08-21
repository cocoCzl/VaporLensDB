# 打包与发布

[English](PACKAGING.md) · [返回 README](../README.zh-CN.md)

VaporLensDB 必须在目标操作系统上构建对应安装包。当前仓库不自动发布，也不包含
代码签名或 macOS 公证流程。

在正式版本获准发布前，所有安装包均仅限本地或私下测试分发；不得将 DMG、MSI、EXE、
App bundle 或校验和上传到 GitHub 仓库、Pull Request 或 GitHub Releases。

## 前提条件

所有构建机器都需要：

- Node.js 22 和 pnpm 10
- Rust stable
- JDK 21（用于 JDBC bridge）

macOS 还需要 Xcode Command Line Tools。Windows 还需要带 MSVC 工具链的 Microsoft
C++ Build Tools，以及 Microsoft Edge WebView2 Runtime。缺少平台依赖时请参阅最新的
[Tauri 前提条件](https://v2.tauri.app/start/prerequisites/)。

首次安装 JavaScript 依赖：

```bash
pnpm install --frozen-lockfile
```

## 打包前校验

每台构建机器生成安装包前均应执行：

```bash
./build.sh check
```

该命令会构建 JDBC bridge，执行前端 lint 与构建，并以禁止警告的方式执行 Rust clippy
和 Rust 测试。

## 构建产物

### macOS

在 macOS 上执行：

```bash
./build.sh mac
```

产物：

```text
src-tauri/target/release/bundle/macos/VaporLensDB.app
src-tauri/target/release/bundle/dmg/VaporLensDB_<版本>_<架构>.dmg
artifacts/macos/<架构>/<版本>/VaporLensDB.app
artifacts/macos/<架构>/<版本>/VaporLensDB_<版本>_<架构>.dmg
artifacts/macos/<架构>/<版本>/SHA256SUMS.txt
```

`dist/` 是 Vite 生成的前端资源，Tauri 会将其打进 App；它不是安装包目录，可删除后由
`pnpm build` 重新生成。`src-tauri/target/` 是 Cargo/Tauri 的原始构建目录；`artifacts/`
则是便于本地取用的版本化汇总目录，已被 Git 忽略。`.app` 可在 macOS 上直接运行，`.dmg`
是包含 App 和“应用程序”快捷方式的安装镜像，私下测试分发应优先使用 DMG。

Apple Silicon 的 `<架构>` 为 `aarch64`，Intel Mac 为 `x86_64`。打包前脚本会校验
`package.json`、`src-tauri/tauri.conf.json` 与 `src-tauri/Cargo.toml` 的版本是否一致。

### Windows

在 Windows 的 Bash 环境（例如 Git Bash）中执行：

```bash
./build.sh windows
```

产物：

```text
src-tauri/target/release/bundle/msi/*.msi
src-tauri/target/release/bundle/nsis/*.exe
```

在 macOS 上，`./build.sh current` 和 `pnpm build:app` 使用 App+DMG 流程；在 Windows 上
使用 MSI+NSIS 流程；其他平台使用 Tauri 的当前平台原生打包流程。

## 正式版本：手动发布 GitHub Release

仅在正式版本获准发布后才能执行本节；测试构建不得执行上传步骤。

1. 确认 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 中的版本号一致。
2. 分别在 macOS 和 Windows 上使用以上命令完成校验与构建。
3. 收集 DMG、MSI 和 NSIS EXE。仅在确实需要独立分发时才上传 macOS App bundle。
4. 将 DMG、MSI 和 EXE 复制到同一个发布暂存目录，再在该目录生成校验和清单：

   ```bash
   # macOS（先将所有发布附件复制到当前目录）
   shasum -a 256 VaporLensDB-*.dmg VaporLensDB-*.msi VaporLensDB-*.exe > SHA256SUMS.txt

   # Windows PowerShell（先将所有发布附件复制到当前目录）
   Get-ChildItem VaporLensDB-*.dmg,VaporLensDB-*.msi,VaporLensDB-*.exe |
     Get-FileHash -Algorithm SHA256 |
     ForEach-Object { '{0}  {1}' -f $_.Hash.ToLower(), $_.Path.Split('\\')[-1] } |
     Set-Content SHA256SUMS.txt
   ```

5. 更新 `CHANGELOG.md`，创建对应 Git tag 和 GitHub Release，上传安装包与
   `SHA256SUMS.txt`，并说明用户可见的变更和已知限制。
6. 在发布前从草稿 Release 下载每个附件并再次校验其 SHA-256。

在真正启用并验证签名或公证前，不要在 Release 中声称安装包已经签名或已公证。
