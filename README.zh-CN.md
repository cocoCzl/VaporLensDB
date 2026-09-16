# VaporLensDB

[English](README.md)

VaporLensDB 是一个基于 Tauri 2、Rust 和 React 构建的轻量跨平台数据库 IDE。
它帮助开发者与数据工程师连接数据库、浏览对象、执行 SQL 和查看结果，同时保持
轻量、专注的工作体验。

当前版本：**0.8.5**

## 项目状态

**Pre-1.0 Development。** VaporLensDB 当前以源码开发和验证为主。在 1.0.0 之前，
不会提供 official downloadable binary releases、GitHub Release 或 Pre-release。本地构建的
App 与安装包仅用于 QA，不是公开发布版本。

## 分发方式

**Source Build Only。** 如需体验 VaporLensDB，请 clone 本仓库并在本地运行。请阅读
[安装指南](docs/INSTALL.zh-CN.md)，其中区分当前源码运行、本地 QA 包与未来正式安装包。

## 平台与数据库状态

唯一的当前状态来源是[支持矩阵](docs/SUPPORT.md)。它将“已实现”、自动化证据、各平台运行时
证据和 1.0 支持等级明确分开。

VaporLensDB 是一款跨平台数据库管理工具，面向 macOS、Windows 和 Linux。当前 macOS 已完成核心运行时验证，Windows/Linux 正处于构建与运行时验证阶段。

| 平台 | 构建目标 | 运行时验证 |
| --- | --- | --- |
| macOS | 是 | 已验证 |
| Windows | 是 | **NOT EXECUTED** |
| Linux | 是 | **NOT EXECUTED** |

- macOS 的 MySQL、PostgreSQL、SQLite 已完成 Tier-A runtime 验证。
- Windows 和 Linux 的桌面运行时均为 **NOT EXECUTED**。
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

结果网格有意保持只读。ODBC 和完整可配置的危险 SQL 策略目前不在范围内。

## 源码优先快速开始

前提：Node.js 22、pnpm 10、Rust stable、JDBC 场景所需的 JDK 21，以及当前系统所需的
[Tauri 前提条件](https://v2.tauri.app/start/prerequisites/)。

```bash
git clone https://github.com/cocoCzl/VaporLensDB.git
cd VaporLensDB
pnpm install
pnpm tauri dev
```

如需可复现地校验本地 checkout，请使用 lockfile：

```bash
pnpm install --frozen-lockfile
./build.sh check
```

平台特定的开发与本地 QA 打包前提见[打包指南](docs/PACKAGING.zh-CN.md)。本地打包
不代表已有 official installer 可供下载。

从源码启动应用后：

1. 打开“新建连接”，选择数据库类型并填写连接信息，然后点击“测试”和“保存并连接”。
2. 在数据源浏览器中查看 Schema 和表，或新建 SQL 标签页执行查询。SQL 标签页会保持
   自己的执行数据源，因此浏览其他连接不会改变执行目标；可在“设置”中切换界面语言和主题。

Oracle 和自定义 JDBC 连接需要本地 JDBC 驱动 JAR，创建连接时应用会提示添加。

## 本地校验与 QA 打包

本地打包前运行确定性开发校验：

```bash
./build.sh check
./build.sh live-tests --mysql --oracle  # 显式选择真实数据库集成测试
```

在目标操作系统上构建：

```bash
./build.sh mac       # macOS：.app 和 .dmg
./build.sh windows   # Windows：.msi 和 NSIS .exe
./build.sh linux     # Linux：AppImage、DEB 和 RPM
```

`pnpm build:app` 会为当前平台打包：macOS 生成 App 和 DMG，Windows 生成 MSI 和 NSIS，
Linux 生成 AppImage、DEB 和 RPM。不带参数运行 `./build.sh` 等价于 `./build.sh current`。

PostgreSQL、MySQL、Oracle 与 JDBC 联网测试是独立的显式 opt-in suite。需要运行时，
将 `.env.example` 复制为已被 Git 忽略的 `.env`，再明确选择要执行的数据库集成测试；普通
校验和打包不会加载私密数据库配置。所需权限和安全说明见测试文档。

在 Pre-1.0 阶段，这些输出均为本地 QA artifact。未来正式分发流程保留在
[打包与发布指南](docs/PACKAGING.zh-CN.md)，供 1.0 Release Preparation 使用。

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
