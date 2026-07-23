# VaporLensDB

[English](README.md)

VaporLensDB 是一个基于 Tauri 2、Rust 和 React 构建的轻量跨平台数据库 IDE。
它帮助开发者与数据工程师连接数据库、浏览对象、执行 SQL 和查看结果，同时保持
轻量、专注的工作体验。

当前版本：**0.8.1**

## 下载

请从 [GitHub Releases](https://github.com/cocoCzl/VaporLensDB/releases/latest)
下载对应系统的安装包。

| 系统 | 推荐下载 | 说明 |
| --- | --- | --- |
| macOS | `.dmg` | 发布时会分别提供 Apple Silicon 和 Intel 版本（如可用）。 |
| Windows | `.msi` | 若系统限制 MSI 安装，可使用 NSIS `.exe` 安装器。 |

请阅读[安装与首次使用指南](docs/INSTALL.zh-CN.md)，其中包含系统安装、SHA-256
校验以及 Oracle/JDBC 配置说明。

## 支持能力

- PostgreSQL、MySQL、SQLite、SQL Server：使用原生 Rust 驱动。
- Oracle：使用用户本地提供的 `ojdbc` JAR。
- 自定义 JDBC：使用用户提供的 JAR、驱动类和 JDBC URL。
- 支持按分组搜索的数据源浏览器、明确的连接状态，以及相互独立的 SQL 执行数据源。
- 支持 SQL 草稿和查询历史、命令面板、紧凑的只读结果网格、导入导出任务、SSH 隧道、
  诊断包导出，以及中英文界面切换。

结果网格有意保持只读。ODBC 和完整可配置的危险 SQL 策略目前不在范围内。

## 快速开始

1. 从 [GitHub Releases](https://github.com/cocoCzl/VaporLensDB/releases/latest)
   下载并安装 macOS 或 Windows 版本。
2. 打开“新建连接”，选择数据库类型并填写连接信息，然后点击“测试”和“保存并连接”。
3. 在数据源浏览器中查看 Schema 和表，或新建 SQL 标签页执行查询。SQL 标签页会保持
   自己的执行数据源，因此浏览其他连接不会改变执行目标；可在“设置”中切换界面语言和主题。

Oracle 和自定义 JDBC 连接需要本地 JDBC 驱动 JAR，创建连接时应用会提示添加。

## 从源码构建

源码构建需要 Node.js 22、pnpm 10、Rust stable 和 JDK 21。

```bash
pnpm install
pnpm tauri dev
```

打包前运行发布校验：

```bash
./build.sh check
```

在目标操作系统上构建：

```bash
./build.sh mac       # macOS：.app 和 .dmg
./build.sh windows   # Windows：.msi 和 NSIS .exe
```

工具链前提、产物路径、校验和与手动发布 GitHub Release 的完整流程，请参阅
[打包与发布指南](docs/PACKAGING.zh-CN.md)。

## 文档

- **使用者：**[安装与首次使用](docs/INSTALL.zh-CN.md)、
  [变更记录](CHANGELOG.md)和[安全策略](SECURITY.md)。
- **贡献者：**[参与贡献](CONTRIBUTING.md)、[测试说明](docs/TESTING.md)和
  [打包与发布](docs/PACKAGING.zh-CN.md)。
- **技术参考：**[JDBC 元数据 SQL](docs/JDBC_METADATA_SQL.md)、
  [产品与架构设计](docs/VaporLensDB-Design.md)和
  [技术选型](docs/VaporLensDB-Technical-Selection.md)。
