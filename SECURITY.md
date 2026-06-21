# Security Policy

## Reporting Security Issues

Please do not file public issues for vulnerabilities or accidental credential
exposure. Contact the maintainers privately first, or use the repository's
private vulnerability reporting feature when it is available.

If no private channel is configured yet, open a minimal public issue that asks
for a private contact path without including exploit details, credentials,
database addresses, logs, or screenshots containing secrets.

## Sensitive Data Rules

Do not commit:

- `.env` files or real environment-specific overrides.
- Real database hosts, private IPs, JDBC URLs, usernames with passwords, or
  copied connection strings.
- Passwords, tokens, SSH private keys, or database dumps.
- Local machine paths to proprietary JDBC drivers, especially `ojdbc` JARs.
- Diagnostics packages that include unreviewed SQL or environment details.

Use `.env.example` for placeholders only. Oracle `ojdbc` artifacts are not part
of this repository and are not required by default CI.

## Pre-Publish Secret Scan

Before pushing a release branch, run the scan documented in `docs/TESTING.md`.
Expected result: no output.

If the scan reports a tracked file, replace the value with a placeholder and
review the full diff before pushing.
