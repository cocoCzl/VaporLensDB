# Security Policy

## Report a vulnerability

Do not disclose vulnerabilities or exposed credentials in public issues. Use
[GitHub private vulnerability reporting](https://github.com/cocoCzl/VaporLensDB/security/advisories/new).
If the form is unavailable, open a minimal public issue requesting a private
contact path, without exploit details or sensitive attachments.

## Before sharing information

Keep passwords, tokens, SSH private keys, database dumps, real endpoints,
connection strings and proprietary JAR paths out of Git and public reports.
Use `.env.example` for placeholders and ignored local files for actual values.
Review SQL, diagnostics, logs and screenshots before sharing; redact secrets
and environment-specific details. Vendor JDBC JARs are not distributed here.

## Checks

Run `pnpm test:sensitive-info` before sharing changes. It reports a success line
or names potential findings; inspect the full diff as well, since a pattern
scan cannot identify every secret. Dependency checks are
`pnpm audit --prod --audit-level high` and `cargo audit` from `src-tauri`
(requires cargo-audit).
See [testing](docs/TESTING.md#daily-checks) and the
[security workflow](.github/workflows/security.yml) for the maintained entries.
