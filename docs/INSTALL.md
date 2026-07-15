# Install and First Use

[简体中文](INSTALL.zh-CN.md) · [Back to README](../README.md)

## Download safely

Download VaporLensDB only from the project's
[GitHub Releases](https://github.com/cocoCzl/VaporLensDB/releases/latest) page.
Each release provides a `SHA256SUMS.txt` file. Verify the downloaded installer
before opening it:

```bash
# macOS
shasum -a 256 VaporLensDB-*.dmg

# Windows PowerShell
Get-FileHash .\VaporLensDB-* -Algorithm SHA256
```

Compare the resulting hash with the matching entry in `SHA256SUMS.txt`.

## macOS

1. Download the DMG that matches your Mac (Apple Silicon or Intel, when both
   are available).
2. Open the DMG and drag **VaporLensDB** to **Applications**.
3. Open VaporLensDB from Applications.

Releases are not yet code-signed or notarized. If macOS blocks the first open,
verify the SHA-256 and release source first, then use Finder's **Open** action
and confirm the system prompt. Do not bypass a warning for an unverified file.

## Windows

1. Download the `.msi` installer. Use the NSIS `.exe` installer if MSI is
   restricted by your environment.
2. Run the installer and follow its prompts.
3. Start **VaporLensDB** from the Start menu.

Releases are not yet code-signed. Microsoft Defender SmartScreen may show a
warning. Verify the SHA-256 and that the file came from the project's GitHub
Release before choosing any option to continue. Ask your administrator if
software installation is managed by your organization.

## First connection

1. Select **New Connection**.
2. Choose PostgreSQL, MySQL, SQLite, SQL Server, Oracle, or a custom JDBC
   driver.
3. Enter the host, port, database, user, and authentication details requested
   by the selected driver.
4. Select **Test**. After a successful test, select **Save & Connect**.
5. Use the Object Tree to browse schemas and objects, or open a SQL tab to run
   a query.

The data grid is read-only. Copy values, rows, selected cells, or headers as
needed; edits must be made through SQL or your source system.

## Oracle and custom JDBC

Oracle and custom JDBC connections use a local JDBC driver JAR. VaporLensDB
does not bundle proprietary driver files.

- For Oracle, obtain a compatible `ojdbc` JAR from Oracle through your approved
  licensing and distribution channel.
- In the connection dialog or **Settings → JDBC Drivers**, add the local JAR,
  confirm the driver class and JDBC URL, then test the connection.
- Keep driver JARs and database credentials out of this repository and out of
  public issue reports.

## Preferences and help

- Open **Settings** to switch between Chinese and English, and choose light,
  dark, or system theme.
- Use **Command+K** on macOS or **Ctrl+K** on Windows to open the command
  palette.
- Use **Diagnostics** in Settings when preparing support information; review
  the exported package before sharing it.
