# 安装与首次使用

[English](INSTALL.md) · [返回 README](../README.zh-CN.md)

## 当前分发方式：源码构建

VaporLensDB 0.9.1 处于 **Pre-1.0 Development**，不是 stable 或 production-ready
软件。当前采用 **source-first**：clone 后在本机构建。公开二进制发布、DMG 上传、
Developer ID 签名和 notarization 均暂缓。历史 RC 计划与未来正式发布流程是工程参考，
不是当前安装入口。

## 工具链政策

构建前安装 Git 及以下工具。版本说明区分仓库政策、依赖约束和实际测试结果，
不代表承诺兼容某工具的所有版本。

| 工具 | 当前政策与证据 |
| --- | --- |
| Node.js | CI 配置为 Node 22。新环境建议使用当前 22.x 补丁（至少 22.22.2）或 24.x 补丁（至少 24.15.0），满足锁定测试依赖的声明；项目未承诺完整支持范围。 |
| pnpm | 使用 pnpm 10，与所有当前 CI 安装任务一致。lockfile 格式为 `9.0`，仅凭格式不能选择具体 pnpm patch，也不能认定最低版本。 |
| Rust/cargo | 使用当前 stable Rust，包含 rustfmt 和 clippy，与 CI 一致。crate 为 edition 2021，但未声明 `rust-version`/MSRV；edition 本身不能证明整个依赖图的最低编译器版本。 |
| JDK | 使用 JDK 21 构建项目自有 JDBC bridge，与 CI 和现有构建政策一致。确保 `java`、`javac`、`jar` 均指向该 JDK。 |

本轮审计记录的本地工具为 Node **24.11.1**、pnpm **10.33.0**、Rust **1.94.1**
和 JDK **21.0.9**。这些是观察到的版本，不是精确版本 pin。该 Node 版本通过了
前端测试与构建，但低于 jsdom 声明的 24.x 范围，不能据此推荐新环境使用旧补丁。
fresh clone 到本地安装包的路径已在 Apple Silicon macOS 验收；CI 配置不能证明
桌面 runtime 已通过。

锁定的 Vite 8.2.2 声明 Node `^20.19.0 || >=22.12.0`，测试使用的 jsdom 30.0.1
声明 `^22.22.2 || ^24.15.0 || >=26.0.0`。因此不限定补丁的“Node 22”不足以说明
完整 gate 的要求。上述建议来自依赖声明；其他 Node major 没有项目兼容承诺。

本阶段保持现有政策，不新增 `packageManager`、`engines` 或 `rust-toolchain.toml`。
CI 显式选择 pnpm major，尚未确立统一的精确 pnpm patch；也没有已验证的项目级
Node/pnpm 最低版本或编译器不兼容证据支持新增强制限制。按
[pnpm 安装说明](https://pnpm.io/installation)安装 pnpm 10；本流程不假定 Node
附带 Corepack，也不要求执行 `corepack enable`。`build.sh` 保留现有命令存在性
检查及版本处理行为。

bridge 脚本调用 `javac` 时未指定 `--release`、`-source` 或 `-target`，生成的
字节码版本跟随所选 JDK。JDK 21 保持为构建政策，不是本轮证明的 Java 语言最低
版本。更低 JDK 的兼容性未确立，本阶段不修改 Java target。使用 JDBC 数据源时，
运行环境也应保留兼容的 Java runtime。

## 平台前提与验证范围

| 平台 | 原生构建机前提 | 验证状态 |
| --- | --- | --- |
| macOS Apple Silicon / arm64 | Xcode Command Line Tools | fresh clone 校验和本地 App/DMG 构建通过；Tier-A runtime 已验证 |
| macOS Intel / x86_64 | Xcode Command Line Tools | 构建目标存在；当前源码打包/runtime 验收未覆盖 Intel |
| Windows | Git Bash、MSVC C++ Build Tools、WebView2 | 构建目标存在；桌面 runtime **NOT EXECUTED** |
| Linux | Tauri WebKitGTK/GTK 开发依赖及 `rpm` 打包工具 | 构建目标存在；桌面 runtime **NOT EXECUTED** |

按当前系统安装 [Tauri 前提条件](https://v2.tauri.app/start/prerequisites/)，
详见[打包指南](PACKAGING.zh-CN.md)。必须在目标 OS 构建，脚本不做安装包跨平台
编译。[支持矩阵](SUPPORT.md)是 runtime 状态的唯一来源；Linux 凭据持久化还需
活动的 Secret Service 会话。

已验证的 macOS 源码路径需要 **Xcode Command Line Tools**，不要求完整 Xcode，
也不需要 Apple Developer Program 会员、Developer ID 证书、公证凭据或正式发布
签名环境。本地 macOS 构建使用 ad hoc 签名，不代表 Developer ID 签名或 Apple 公证。

## Clone、校验与本地构建

在终端中执行（Windows 使用 Git Bash）：

```bash
git clone https://github.com/cocoCzl/VaporLensDB.git
cd VaporLensDB
pnpm install --frozen-lockfile
./build.sh check
./build.sh current
```

`check` 只校验，不生成安装包。`current` 会再次执行确定性校验，然后为当前 OS 打包；
只需要通过校验的本地包时，可以省略单独的 `check`。两者都构建项目 JDBC bridge，
因此即使不用 JDBC 数据源也需要 JDK；均不读取 `.env`，不要求数据库凭据或厂商 JDBC JAR。

没有 `node_modules` 时，`build.sh` 会自动执行 `pnpm install --frozen-lockfile`。
已有 checkout 仍值得显式安装，因为脚本不会同步已经存在的依赖目录。

## 本地产物与启动

Apple Silicon macOS：

```text
artifacts/macos/aarch64/VaporLensDB.app
artifacts/macos/aarch64/VaporLensDB.dmg
artifacts/macos/aarch64/SHA256SUMS.txt
```

可直接打开 staged `.app`，也可打开自己构建的 DMG，将 **VaporLensDB** 拖到
“应用程序”。从仓库根目录校验本地 DMG：

```bash
(cd artifacts/macos/aarch64 && shasum -a 256 -c SHA256SUMS.txt)
```

Intel macOS 使用 `artifacts/macos/x86_64/`。Windows 的 MSI/NSIS 安装器位于
`artifacts/windows/<architecture>/`，Linux 的 AppImage、DEB、RPM 位于
`artifacts/linux/<architecture>/`，均附带 `SHA256SUMS.txt`。这些是**本地构建产物**，
不是当前官方公开下载的二进制 release。`dist/` 是前端资源目录，不是应用安装包目录。
产物细节与独立的未来发布流程见 [PACKAGING.zh-CN.md](PACKAGING.zh-CN.md)。

## 不打包的开发方式

安装依赖后按需使用：

```bash
pnpm dev        # 前端开发服务器；桌面命令需要 Tauri
pnpm tauri dev  # 桌面开发应用，不生成 DMG
```

桌面开发中需要 JDBC 时先执行 `./build.sh jdbc-bridge`。`pnpm build` 只生成前端资源。
日常开发不必运行 `./build.sh current`；验证改动时运行 `./build.sh check`。

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
