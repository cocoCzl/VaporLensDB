# 安装与首次使用

[English](INSTALL.md) · [返回 README](../README.zh-CN.md)

## 当前 Pre-1.0 使用方式：源码运行与 RC 测试

VaporLensDB 0.9.1 处于 **Pre-1.0 Development / RC testing**，不是 stable 或
production-ready 软件。开发期间仍可从源码运行；对于已有 runtime evidence 的平台，
明确标记为 GitHub Pre-release 的版本可以提供 RC 测试 artifact。从源码运行：

```bash
pnpm install
pnpm tauri dev
```

如需可复现校验，请先使用 lockfile，再运行确定性 gate：

```bash
pnpm install --frozen-lockfile
./build.sh check
```

源码构建需要 Node.js 22、pnpm 10、Rust stable、JDK 21，以及当前系统的
[Tauri 前提条件](https://v2.tauri.app/start/prerequisites/)。`./build.sh check` 和
`./build.sh current` 始终会构建项目自有的 JDBC bridge，因此即使不配置厂商 JDBC 驱动，
这两个命令也需要 JDK。平台前提与本地 QA 打包请参阅 [PACKAGING.zh-CN.md](PACKAGING.zh-CN.md)。

## 平台构建目标

| 平台 | 构建目标 / 前提 | 运行时验证 |
| --- | --- | --- |
| macOS | `./build.sh mac`；Xcode Command Line Tools | Tier-A 已验证 |
| Windows | 在 Windows/Git Bash 中运行 `./build.sh windows`；MSVC Build Tools 与 WebView2 | **NOT EXECUTED** |
| Linux | 在 Linux 中运行 `./build.sh linux`；WebKitGTK/GTK/Tauri 打包依赖 | **NOT EXECUTED** |

Windows 和 Linux 的构建前提与目标已文档化，但真实桌面运行时验证仍待完成。精确的
native-host 前提请见 [PACKAGING.zh-CN.md](PACKAGING.zh-CN.md)。厂商 JDBC JAR 只在配置
Oracle 或自定义 JDBC 数据源时需要；
Linux 凭据持久化还需要一个活动的 Secret Service 会话。

## 本地 QA、RC 与未来 stable 安装包

`./build.sh current` 生成本地 QA artifact，不等同于公开发布。获准的 RC 会在 release
commit、tag、clean build 和 checksum 验证后，单独发布为 GitHub **Pre-release**；stable
release 仍需独立 release gate。任何公开 package 都只能从项目
[GitHub Releases](https://github.com/cocoCzl/VaporLensDB/releases) 页面获取，并使用同时提供的
`SHA256SUMS.txt` 校验：

```bash
# macOS
shasum -a 256 VaporLensDB.dmg

# Windows PowerShell
Get-FileHash .\VaporLensDB-* -Algorithm SHA256

# Linux
sha256sum VaporLensDB.AppImage VaporLensDB.deb VaporLensDB.rpm
```

将输出的哈希值与 `SHA256SUMS.txt` 中对应文件的值进行比对。

## macOS

1. RC 测试或未来 stable release 只应下载该 Release 明确列出的 CPU 架构对应 DMG。
2. 打开 DMG，将 **VaporLensDB** 拖到“应用程序”。
3. 从“应用程序”中打开 VaporLensDB。

当前 0.9.1 RC 计划只覆盖 macOS arm64。App 使用 ad hoc 签名，且**未经过 Apple
notarization**，因此 Gatekeeper 可能警告或阻止从互联网下载的 DMG/App。这是 RC 测试分发
的已知限制，不代表 Developer ID 正式签名。请先确认 Release 来源并校验 SHA-256；不要关闭
Gatekeeper，也不要使用自动绕过安全机制的脚本。

## Windows

1. 正式发布后，下载 `.msi` 安装包；若所在环境限制 MSI 安装，请使用 NSIS `.exe` 安装器。
2. 运行安装程序并按提示完成安装。
3. 从开始菜单启动 **VaporLensDB**。

只有在确认 SHA-256 且文件来自项目正式 GitHub Release 后，才继续安装；若组织统一管理
软件安装，请联系管理员。

## Linux

- AppImage：执行 `chmod +x VaporLensDB.AppImage`，再运行 `./VaporLensDB.AppImage`。
- Debian/Ubuntu：执行 `sudo apt install ./VaporLensDB.deb`。
- Fedora/RHEL：执行 `sudo dnf install ./VaporLensDB.rpm`。

请选择与发行版和 CPU 架构匹配的包。Linux 包依赖系统的 WebKitGTK 运行时；不适合使用
系统包管理器时，可优先尝试 AppImage。

## 第一个连接

1. 点击“新建连接”。
2. 选择 PostgreSQL、MySQL、SQLite、SQL Server、Oracle 或自定义 JDBC 驱动。
3. 按所选驱动填写主机、端口、数据库、用户和认证信息。
4. 点击“测试”；成功后点击“保存并连接”。
5. 在对象浏览器中查看 Schema 和对象，或打开 SQL 标签页执行查询。

数据网格保持只读。可复制值、行、选中单元格或列标题；修改数据请通过 SQL 或源系统完成。

## Oracle 与自定义 JDBC

Oracle 和自定义 JDBC 连接使用本地 JDBC 驱动 JAR。VaporLensDB 会携带项目自有的开源
bridge，但不会内置任何专有数据库驱动文件。

- Oracle 用户应通过符合许可要求的官方或组织渠道获取兼容的 `ojdbc` JAR。
- 在连接对话框或“设置 → JDBC 驱动”中添加本地 JAR，确认驱动类和 JDBC URL 后测试连接。
- 不要把驱动 JAR、数据库凭据或真实数据库地址提交到仓库或公开 Issue 中。

每个 JDBC 数据源运行在受限 JVM 中，默认最大堆内存为 256 MB。极少数体积较大的
厂商驱动可在启动前设置 `VAPORLENSDB_JDBC_MAX_HEAP_MB`，允许范围为 64–1024。

## 保存的凭据

保存的凭据使用操作系统凭据存储后端。当前验证状态按平台区分：

- macOS 将每个已保存的**数据库密码**直接存入 Keychain，配置数据库只保存不透明的凭据引用。
  读取是非交互的：正常使用绝不应弹出 macOS Keychain 授权框。旧版本保存的数据库凭据不会被
  读取或自动迁移；如不可用，请在连接设置中重新输入数据库密码并保存一次。该行为已在当前 macOS
  release-like QA artifact 上 **PASS / Accepted / Frozen**。
- Windows DPAPI 实现已存在；Windows runtime 为 **NOT EXECUTED**。
- Linux Secret Service / `secret-tool` 实现已存在；Linux runtime 为
  **NOT EXECUTED**。Debian/Ubuntu 需要 `libsecret-tools`；如果当前 Linux 会话没有
  Secret Service，请不要勾选“保存密码”，并在本次会话连接时输入密码。

`VAPORLENSDB_USE_DEV_KEY=1` 只用于开发测试，正常安装不得启用。正常 macOS 使用不会
迁移或探测旧 Keychain 凭据代际。

## 偏好设置与帮助

- 在“设置”中切换中英文，以及浅色、深色或跟随系统主题。
- macOS 使用 **Command+K**，Windows/Linux 使用 **Ctrl+K** 打开命令面板。
- 需要提供支持信息时，可在“设置”的“诊断”中导出诊断包；分享前请先检查内容。
