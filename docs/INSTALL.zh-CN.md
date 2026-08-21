# 安装与首次使用

[English](INSTALL.md) · [返回 README](../README.zh-CN.md)

## 正式发布后的安全下载

当前尚未发布正式安装包。正式版本发布后，请只从项目的
[GitHub Releases](https://github.com/cocoCzl/VaporLensDB/releases/latest) 页面下载 VaporLensDB。
开发和测试阶段生成的安装包不会发布到 GitHub Releases；手动打包验证可临时保留 7 天的
GitHub Actions 产物。每个正式 Release 都会提供 `SHA256SUMS.txt`，请在打开安装包前校验：

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

1. 正式发布后，下载与 Mac 芯片匹配的 DMG（如果同时提供 Apple Silicon 和 Intel 版本）。
2. 打开 DMG，将 **VaporLensDB** 拖到“应用程序”。
3. 从“应用程序”中打开 VaporLensDB。

仅在确认下载自正式 Release、且 SHA-256 校验通过后再打开安装包。若 macOS 显示安全提示，
请不要绕过来源未验证文件的警告。

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

## 偏好设置与帮助

- 在“设置”中切换中英文，以及浅色、深色或跟随系统主题。
- macOS 使用 **Command+K**，Windows/Linux 使用 **Ctrl+K** 打开命令面板。
- 需要提供支持信息时，可在“设置”的“诊断”中导出诊断包；分享前请先检查内容。
