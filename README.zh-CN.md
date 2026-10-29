# VaporLensDB

[English](README.md)

VaporLensDB 是面向开发者、以 SQL 为核心的数据库客户端，基于 Tauri 2、Rust 和 React。
**当前版本 0.9.1 正在开发，尚未达到 1.0 稳定版或生产可用状态。** 目前从源码在本机构建。

## 主要功能

- 多标签 SQL、独立执行目标、自动/手动事务、SQL 文件、草稿和查询历史。
- 可搜索、可分组的连接，数据库对象浏览、定义查看、只读结果网格及 Explain 结果查看。
- CSV 导入导出、后台任务、会话管理和诊断包。
- 每条连接独立选择 Native Rust 或 JDBC；支持用户定义数据库产品并固定 JDBC 安装版本。
- 中英文界面、浅色/深色/跟随系统主题和命令面板。

## 支持概览

MySQL、PostgreSQL 和 SQLite 以原生驱动为主要支持路径。SQL Server 原生实现已存在，
运行验证有限。Oracle 和自定义 JDBC 为实验性支持，需要用户提供厂商 JAR。
可选 JDBC 驱动不继承同一产品原生驱动的验证状态。

macOS Apple Silicon 已有构建及桌面验证覆盖。Intel macOS、Windows、Linux 有构建目标，
桌面运行仍待验证。数据库与平台矩阵，以及参数化导入、取消、事务、SSH/TLS 和抓取限制，
统一见[支持范围（英文）](docs/SUPPORT.md)。

## 快速开始

使用 Node.js 22.x 中的 22.22.2+ 或 24.x 中的 24.15.0+、pnpm 10、含 rustfmt/clippy
的 stable Rust、JDK 21，并安装对应系统的
[Tauri 前提条件](https://v2.tauri.app/start/prerequisites/)。

```bash
git clone https://github.com/cocoCzl/VaporLensDB.git
cd VaporLensDB
pnpm install --frozen-lockfile
pnpm tauri dev
```

开发时需要 JDBC，请先运行 `./build.sh jdbc-bridge`。
校验并生成本地安装包使用 `./build.sh current`；只校验使用 `./build.sh check`。
这些命令不需要数据库凭据或厂商 JAR。已打包应用使用原生连接不需要 Java。
平台细节与产物位置见[安装说明（英文）](docs/INSTALL.md)。

## 未来计划

以下是计划，不代表已实现，也不增加 1.0 的功能承诺：

- 1.0 前：解决正确性与隐私问题，验证现有工作流；平台支持扩展以实际运行测试为前提。
- 1.0 后：支持变更审阅及 Apply/Revert 的安全表格数据编辑；改进 Explain、列隐藏/冻结、
  元数据效率及厂商能力；探索结构比较与迁移 SQL、运行监控和明确的扩展模型。
- 正式签名、公证及二进制分发作为独立的后续工作。

## 文档

- [安装与首次使用（英文）](docs/INSTALL.md)
- [驱动管理与元数据 SQL（中文）](docs/DRIVER-MANAGEMENT.md)
- [支持范围与限制（英文）](docs/SUPPORT.md)
- [测试说明（英文）](docs/TESTING.md)、[贡献说明（英文）](CONTRIBUTING.md)
- [变更记录（英文）](CHANGELOG.md)、[安全策略（英文）](SECURITY.md)、[许可证（英文）](LICENSE)
