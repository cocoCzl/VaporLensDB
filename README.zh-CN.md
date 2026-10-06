# VaporLensDB

[English](README.md)

VaporLensDB 是一个基于 Tauri 2、Rust 和 React 构建的轻量跨平台数据库 IDE。
它帮助开发者与数据工程师连接数据库、浏览对象、执行 SQL 和查看结果，同时保持
轻量、专注的工作体验。

当前版本：**0.9.1**

## 项目状态

**Pre-1.0 Development。** VaporLensDB 仍处于开发阶段，不是 stable 或
production-ready 软件。

## 当前分发方式：源码构建

当前开发阶段采用 **source-first**：clone 仓库，在自己的机器上构建 VaporLensDB。
本阶段不进行公开二进制发布、DMG 上传、Developer ID 签名或 notarization。未来的
二进制发布流程单独保留在工程文档中，不是使用源码的前置条件。

### 前提、clone 与本地构建

建议使用当前 Node.js 22 补丁版本（22.x 中的 22.22.2 或更新版本）或 Node.js 24
补丁版本（24.x 中的 24.15.0 或更新版本）、pnpm 10、当前 stable Rust/cargo
（包含 rustfmt 和 clippy）以及 JDK 21。Node 补丁建议来自锁定的测试依赖，
不代表项目对整个版本范围的兼容承诺。CI 配置、本地实测版本与最低要求的区别见
[工具链政策](docs/INSTALL.zh-CN.md#工具链政策)。

macOS 需要 Xcode Command Line Tools。已验证的 Apple Silicon 源码构建不需要
完整 Xcode、Apple Developer Program 会员、Developer ID 证书或公证凭据。
其他系统还需安装对应的 [Tauri 前提条件](https://v2.tauri.app/start/prerequisites/)。

```bash
git clone https://github.com/cocoCzl/VaporLensDB.git
cd VaporLensDB
pnpm install --frozen-lockfile
./build.sh current
```

`current` 先执行确定性校验，再为当前平台打包。没有 `node_modules` 时脚本会自动
按 lockfile 安装依赖；保留上面的显式安装步骤，也能让已有 checkout 与 lockfile 同步。
本地构建和 `./build.sh check` 均不需要 `.env`、数据库凭据或厂商 JDBC JAR。

Apple Silicon macOS 的本地产物为：

```text
artifacts/macos/aarch64/VaporLensDB.app
artifacts/macos/aarch64/VaporLensDB.dmg
artifacts/macos/aarch64/SHA256SUMS.txt
```

这些是本地构建产物，不是公开二进制 release。校验和打包会构建项目自有的 JDBC bridge，
因此即使不用 JDBC 数据源也需要 JDK 21。Oracle/自定义厂商 JAR 只在运行时配置对应
数据源时提供。

平台细节见[安装与首次使用](docs/INSTALL.zh-CN.md)。

## 平台与数据库状态

唯一的当前状态来源是[支持矩阵](docs/SUPPORT.md)。它将“已实现”、自动化证据、各平台运行时
证据和 1.0 支持等级明确分开。

已验证的 fresh clone → 校验 → 本地打包路径是 **macOS Apple Silicon / arm64**。
Intel macOS、Windows 和 Linux 有原生源码构建目标，但不属于这份验收证据的覆盖范围。

| 平台 | 构建目标 | 桌面运行时验证 |
| --- | --- | --- |
| macOS Apple Silicon / arm64 | 是 | Tier-A 已验证 |
| macOS Intel / x86_64 | 是 | 当前验收未覆盖 |
| Windows | 是 | **NOT EXECUTED** |
| Linux | 是 | **NOT EXECUTED** |

- macOS arm64 的 MySQL、PostgreSQL、SQLite 已完成 Tier-A runtime 验证。
- Oracle JDBC 与自定义 JDBC 是 Experimental / Best-effort，不是 Tier-A。
- SQL Server 已实现，但不会作为 1.0 Tier-A 宣传目标。

## 支持能力

- PostgreSQL、MySQL、SQLite：Tier-A 原生 Rust 驱动。
- SQL Server：原生 Rust 驱动，但不作 Tier-A 承诺。
- Oracle：使用用户本地提供的 `ojdbc` JAR。
- 自定义 JDBC：使用用户提供的 JAR、驱动类和 JDBC URL。
- 支持按分组搜索的数据源浏览器、明确的连接状态，以及相互独立的 SQL 执行数据源。
- 支持 SQL 草稿和查询历史、命令面板、紧凑的只读结果网格、导入导出任务、SSH 隧道、
  诊断包导出，以及中英文界面切换。

其中参数化 CSV 导入仅属于 Tier-A 原生驱动范围；SQL Server/JDBC 参数化 CSV 导入不受
支持。全量查询导出仅接受一条语句，不支持多语句多结果集脚本。结果网格有意保持只读。
ODBC 和完整可配置的危险 SQL 策略目前不在范围内；完整 1.0 边界见
[支持矩阵](docs/SUPPORT.md)。

## 开发、校验与本地打包

安装依赖后，在仓库根目录按需执行：

| 用途 | 命令 | 结果 |
| --- | --- | --- |
| 前端开发 | `pnpm dev` | Vite 开发服务器；桌面命令需要 Tauri |
| 桌面开发 | `pnpm tauri dev` | Tauri 开发应用，不生成 DMG |
| 校验 | `./build.sh check` | 完整确定性 gate，不生成安装包 |
| 本地打包 | `./build.sh current` | 校验后生成当前平台安装包 |

桌面开发中需要 JDBC 时，先运行 `./build.sh jdbc-bridge`。`pnpm build` 只构建
前端资源；`pnpm build:app` 和不带参数的 `./build.sh` 均等价于 `./build.sh current`。

Windows 和 Linux 的本地产物分别整理到 `artifacts/windows/<architecture>/`
和 `artifacts/linux/<architecture>/`。原生平台前提及包型见
[打包指南](docs/PACKAGING.zh-CN.md)。真实数据库集成测试是独立的 opt-in 工作，
见[测试说明](docs/TESTING.md)，不是 fresh clone 构建的必需步骤。

启动应用后：

1. 打开“新建连接”，选择数据库类型并填写连接信息，然后点击“测试”和“保存并连接”。
2. 在数据源浏览器中查看 Schema 和表，或新建 SQL 标签页执行查询。SQL 标签页会保持
   自己的执行数据源，因此浏览其他连接不会改变执行目标；可在“设置”中切换界面语言和主题。

## Road to 1.0

- 冻结 macOS Tier-A 范围，只修复 release blocker。
- 完成 Windows 和 Linux runtime QA。
- 取得真实跨平台 runtime 证据后，再进入正式签名与发布准备。

## 文档

- **使用者：**[安装与首次使用](docs/INSTALL.zh-CN.md)、
  [变更记录](CHANGELOG.md)、[路线图](ROADMAP.md)和[安全策略](SECURITY.md)。
- **贡献者：**[参与贡献](CONTRIBUTING.md)、[测试说明](docs/TESTING.md)和
  [打包与发布](docs/PACKAGING.zh-CN.md)。
- **技术参考：**[JDBC 元数据 SQL](docs/JDBC_METADATA_SQL.md)、
  [产品与架构设计](docs/VaporLensDB-Design.md)和
  [技术选型](docs/VaporLensDB-Technical-Selection.md)。
- **开发记录：**[0.8.5 验证说明](docs/VALIDATION-NOTES-0.8.5.md)
  （内部 QA 证据，不是 release note）。
- **当前支持状态：**[支持矩阵](docs/SUPPORT.md)。
