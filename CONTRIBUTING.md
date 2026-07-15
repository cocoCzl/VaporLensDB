# Contributing

Thanks for taking a look at VaporLensDB. This project is a Tauri 2 + Rust +
React database IDE, so changes usually touch both frontend workflow and backend
command behavior.

## Development Setup

Install the required toolchains:

- Node.js 22
- pnpm 10
- Rust stable
- JDK 21 for the lightweight JDBC bridge

Install dependencies:

```bash
pnpm install
```

Run the frontend:

```bash
pnpm dev
```

Run the desktop app:

```bash
pnpm tauri dev
```

## Verification

Before opening a pull request or publishing a release, run:

```bash
./build.sh check
```

That command builds the JDBC bridge and runs frontend lint, frontend build,
Rust clippy with warnings denied, and Rust tests.

GitHub Actions runs the default clone-safe checks on pushes and pull requests
to `main` and `master`, including the sensitive information scan, frontend
checks, the Object Tree workflow smoke test, Rust formatting, clippy, and Rust
tests.

For focused workflow checks, see `docs/TESTING.md`. A commonly useful smoke
test is:

```bash
pnpm test:object-tree-workflow
```

For platform packaging, artifact locations, checksums, and manual GitHub Release
publishing, see `docs/PACKAGING.md`.

## Live Database Tests

PostgreSQL, MySQL, and Oracle live integration tests are ignored by default.
They require private database endpoints and credentials, and Oracle also
requires a local `ojdbc` JAR.

Use `.env.example` as a template, but keep real values in an untracked `.env`
or your shell session. Do not commit real database addresses, passwords, private
JDBC URLs, or local driver paths.

## Pull Request Expectations

- Keep runtime API and Tauri command contract changes explicit.
- Update documentation when behavior or verification commands change.
- Keep generated build artifacts out of commits.
- Run the sensitive information scan from `docs/TESTING.md` before publishing.
