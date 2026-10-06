# Contributing

Thanks for taking a look at VaporLensDB. This project is a Tauri 2 + Rust +
React database IDE, so changes usually touch both frontend workflow and backend
command behavior.

## Development Setup

Current distribution is source-first. Follow the [installation guide](docs/INSTALL.md)
for clone instructions, platform prerequisites, and the detailed toolchain policy:

- A current Node 22.x patch (at least 22.22.2) or 24.x patch (at least 24.15.0),
  following the locked test dependencies; CI is configured for Node 22.
- pnpm 10, matching CI; no exact patch pin is adopted.
- Current stable Rust with rustfmt and clippy; no project MSRV is declared.
- JDK 21 for the project-owned JDBC bridge; vendor JDBC JARs are only needed
  when configuring the corresponding runtime data source.
- Host-specific Tauri prerequisites, including Xcode Command Line Tools on macOS.
  The verified Apple Silicon source path does not require full Xcode or Apple
  Developer signing/notarization credentials.

Install dependencies from the repository root:

```bash
pnpm install --frozen-lockfile
```

Run the frontend:

```bash
pnpm dev
```

Run the desktop app:

```bash
pnpm tauri dev
```

For JDBC during desktop development, first run `./build.sh jdbc-bridge`.
Neither development command creates an installer; `pnpm build` builds frontend
assets only.

## Verification

Before opening a pull request, run:

```bash
./build.sh check
```

That command builds and tests the JDBC bridge, runs the sensitive-information
scan, frontend lint/tests/build, packaging tests, workflow smoke checks, bundle
budgets, Rust formatting, clippy with warnings denied, and deterministic Rust
tests. It does not create an installer or need private database configuration.

GitHub Actions runs the default clone-safe checks on pushes and pull requests
to `main` and `master`, including the sensitive information scan, frontend
checks, the Object Tree workflow smoke test, Rust formatting, clippy, and Rust
tests.

For focused workflow checks, see `docs/TESTING.md`. A commonly useful smoke
test is:

```bash
pnpm test:object-tree-workflow
```

For a local packaged app, run `./build.sh current`; it validates again before
packaging. Artifact locations and separately scoped future distribution
procedures are in [PACKAGING.md](docs/PACKAGING.md). Local installers and
checksums are build outputs; the current stage does not publish GitHub binary
Releases or upload DMGs.

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
