# 打包与发布

[English](PACKAGING.md) · [返回 README](../README.zh-CN.md)

VaporLensDB 必须在目标操作系统上构建对应安装包。当前仓库不自动发布，也不包含
代码签名或 macOS 公证流程。

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
src-tauri/target/release/bundle/dmg/*.dmg
```

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

`./build.sh current` 仅用于生成当前平台的通用包；它不固定安装器格式，因此不作为正式
发布命令。

## 手动发布 GitHub Release

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

5. 创建对应 Git tag 和 GitHub Release，上传安装包与 `SHA256SUMS.txt`，并说明用户可见的
   变更和已知限制。
6. 在发布前从草稿 Release 下载每个附件并再次校验其 SHA-256。

在真正启用并验证签名或公证前，不要在 Release 中声称安装包已经签名或已公证。
