# 安装与首次使用

[English](INSTALL.md) · [返回 README](../README.zh-CN.md)

## 安全下载

请只从项目的 [GitHub Releases](https://github.com/cocoCzl/VaporLensDB/releases/latest)
页面下载 VaporLensDB。每个 Release 都会提供 `SHA256SUMS.txt`，请在打开安装包前校验：

```bash
# macOS
shasum -a 256 VaporLensDB-*.dmg

# Windows PowerShell
Get-FileHash .\VaporLensDB-* -Algorithm SHA256
```

将输出的哈希值与 `SHA256SUMS.txt` 中对应文件的值进行比对。

## macOS

1. 下载与 Mac 芯片匹配的 DMG（如果同时提供 Apple Silicon 和 Intel 版本）。
2. 打开 DMG，将 **VaporLensDB** 拖到“应用程序”。
3. 从“应用程序”中打开 VaporLensDB。

当前发布包尚未进行代码签名和公证。若 macOS 首次阻止打开，请先确认 SHA-256 和
Release 来源，再在 Finder 中使用“打开”并确认系统提示。不要绕过来源未验证文件的警告。

## Windows

1. 下载 `.msi` 安装包；若所在环境限制 MSI 安装，请使用 NSIS `.exe` 安装器。
2. 运行安装程序并按提示完成安装。
3. 从开始菜单启动 **VaporLensDB**。

当前发布包尚未进行代码签名，Microsoft Defender SmartScreen 可能显示提示。只有在确认
SHA-256 且文件来自项目 GitHub Release 后，才选择继续；若组织统一管理软件安装，请联系
管理员。

## 第一个连接

1. 点击“新建连接”。
2. 选择 PostgreSQL、MySQL、SQLite、SQL Server、Oracle 或自定义 JDBC 驱动。
3. 按所选驱动填写主机、端口、数据库、用户和认证信息。
4. 点击“测试”；成功后点击“保存并连接”。
5. 在对象浏览器中查看 Schema 和对象，或打开 SQL 标签页执行查询。

数据网格保持只读。可复制值、行、选中单元格或列标题；修改数据请通过 SQL 或源系统完成。

## Oracle 与自定义 JDBC

Oracle 和自定义 JDBC 连接使用本地 JDBC 驱动 JAR，VaporLensDB 不会内置专有驱动文件。

- Oracle 用户应通过符合许可要求的官方或组织渠道获取兼容的 `ojdbc` JAR。
- 在连接对话框或“设置 → JDBC 驱动”中添加本地 JAR，确认驱动类和 JDBC URL 后测试连接。
- 不要把驱动 JAR、数据库凭据或真实数据库地址提交到仓库或公开 Issue 中。

## 偏好设置与帮助

- 在“设置”中切换中英文，以及浅色、深色或跟随系统主题。
- macOS 使用 **Command+K**，Windows 使用 **Ctrl+K** 打开命令面板。
- 需要提供支持信息时，可在“设置”的“诊断”中导出诊断包；分享前请先检查内容。
