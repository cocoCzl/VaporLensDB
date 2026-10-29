# Testing

Run commands from the repository root. Source checks, behavior tests, real Java
bridge tests, vendor integration and desktop observation establish different
things; skipped/ignored tests are not successes. Keep logs, recordings and
screenshots outside the repository and review them for secrets before sharing.

## Daily checks

`./build.sh check` builds/tests the JDBC bridge and runs the secret scan,
frontend lint/behavior tests/build, workflow checks, packaging tests, bundle
budgets, Rust formatting, warnings-denied clippy and deterministic Rust tests.
It requires the [build tools](INSTALL.md#requirements), but no private endpoint
or vendor JAR. `check`, `current`, `mac`, `windows` and `linux` do not load `.env`
or run external-database tests.

Use focused checks for the affected area; documentation changes do not require
real databases or desktop packaging:

```bash
pnpm test:sensitive-info
pnpm test:smoke                     # Source/contract checks, not desktop tests
pnpm test:packaging
pnpm lint
pnpm test                          # Vitest + Testing Library
pnpm build                         # Includes TypeScript checking
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Individual checks are listed in package.json. CI installs locked dependencies;
see [CI](../.github/workflows/ci.yml) and [security checks](../SECURITY.md#checks).
For registry/resolution changes, focused entries include:

```bash
pnpm exec vitest run src/components/connection/DatabaseDriverWorkflow.test.tsx src/lib/connectionDriverReadiness.test.ts src/lib/databaseDialect.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --lib services::driver_registry
cargo test --manifest-path src-tauri/Cargo.toml --lib migration13
```

## Isolated test environments

### Docker databases

Docker Compose provides MySQL 8.4 (host port 13306) and PostgreSQL 16 (15432)
under project `vaporlensdb-qa`. It uses synthetic local-only credentials and
named volumes; it never reads the repository `.env`.

```bash
./scripts/qa-db.sh up       # Start, wait for health and verify fixtures
./scripts/qa-db.sh status
./scripts/qa-db.sh verify
./scripts/qa-db.sh env > .env.qa
```

For different ports, export `VAPORLENSDB_QA_MYSQL_PORT` and
`VAPORLENSDB_QA_POSTGRES_PORT` **before both `up` and `env`**, using the same values.
`.env.qa` is ignored by Git. The helper prints exports without modifying `.env`.

The normal `vaporlensdb_qa` account can modify only its QA fixture databases
(the MySQL fixture also has `vaporlensdb_qa_alt`); it cannot create/drop databases.
The separate initialization administrator is only for setup and the explicitly
selected database-creation suite. Never reuse these credentials outside this stack.
Fixtures include parent/child tables, keys/indexes, a view, varied nullable
values and a `vaporlensdb_qa_marker` identifying the disposable environment.

```bash
./scripts/qa-db.sh reset           # Delete/recreate only this project's QA volumes
./scripts/qa-db.sh down            # Remove QA containers; keep volumes
./scripts/qa-db.sh down --volumes  # Also delete this project's QA volumes
```

`reset` restores the fixture after writes/DDL. These commands do not prune Docker
or stop unrelated containers. Reset and volume deletion discard QA data.

### SQLite files

```bash
qa_dir="$(./scripts/qa-sqlite-dir.sh create)"
# Use "$qa_dir/space path/qa fixture.sqlite" and "$qa_dir/测试路径/qa-fixture.sqlite".
# After all test connections close:
./scripts/qa-sqlite-dir.sh cleanup "$qa_dir"
```

The helper removes only its own `vaporlensdb-qa.*` temporary-directory prefixes;
never substitute a user database directory.

### Application profiles

```bash
profile_dir="$(./scripts/qa-dev-profile.sh create)"
./scripts/qa-dev-profile.sh run "$profile_dir"
# After the app exits:
./scripts/qa-dev-profile.sh cleanup "$profile_dir"
```

`run` supplies a temporary HOME and explicitly enables the development key,
isolating backend configuration, SQLite config and development-key files.
For macOS credential checks, use `run-keychain "$profile_dir"` instead: it
sets `VAPORLENSDB_CONFIG_DIR` while retaining the logged-in Keychain. Credential
operations can affect shared OS items; use QA-only connections.

For a packaged app, launch the exact build with a scoped config override, e.g.
on macOS arm64, after creating a profile as above:

```bash
VAPORLENSDB_CONFIG_DIR="$profile_dir/config" VAPORLENSDB_USE_DEV_KEY=1 \
  artifacts/macos/aarch64/VaporLensDB.app/Contents/MacOS/vapor-lens-db
```

Omit the development-key override only for intentional system-credential tests.
A temporary HOME or config directory **does not guarantee isolation of Keychain,
DPAPI, Secret Service or WebView localStorage**. On macOS, packaged and dev WebKit
stores may persist outside the override. Inspect/backup before a test, close the
app before restoring, and never delete a user's real WebView profile as cleanup.
The logger writes to process output; capture and redact it rather than assuming
a separate application log directory. Confirm build identity as described in
[CONTRIBUTING](../CONTRIBUTING.md#build-identity).

## Live database tests

Build the bridge first with `./build.sh jdbc-bridge`. Supply vendor JARs locally;
never commit or download them implicitly. The live selectors load
`VAPORLENSDB_LIVE_TEST_ENV_FILE`, defaulting to personal `.env` if omitted.
**Always select the intended environment file explicitly.** Direct `cargo test`
does not load an env file: source your own trusted file in a subshell.

### Disposable MySQL and PostgreSQL

After generating `.env.qa` above, set the two absolute JAR paths in the invoking
shell. JDBC URLs, credentials and database names come from that explicit file.

```bash
export TEST_MYSQL_JDBC_DRIVER_PATH=/absolute/path/to/mysql-connector-j.jar
export TEST_PG_JDBC_DRIVER_PATH=/absolute/path/to/postgresql.jar
VAPORLENSDB_LIVE_TEST_ENV_FILE=.env.qa \
  ./build.sh live-tests --mysql --postgresql
```

The selectors require `TEST_MYSQL_JDBC_URL`, `TEST_MYSQL_USER`,
`TEST_MYSQL_PASSWORD`, `TEST_MYSQL_JDBC_DRIVER_PATH`, or the corresponding
`TEST_PG_JDBC_URL`, `TEST_PG_USER`, `TEST_PG_PASSWORD`, `TEST_PG_JDBC_DRIVER_PATH`.
The generated file also sets `TEST_MYSQL_DATABASE`/`TEST_PG_DATABASE` and
`VAPORLENSDB_QA_ENVIRONMENT=1`. These tests **write fixtures**: each selector runs
JDBC metadata and native parameterized CSV import tests. They require both the
QA flag and the exact database/marker; a hostname alone is not proof of safety.

Full native suites also write/perform transactions. Load the QA file and remove
PostgreSQL's higher-priority URL override so an inherited value cannot select
another server:

```bash
(
  set -e
  . ./.env.qa
  unset TEST_PG_URL
  cargo test --manifest-path src-tauri/Cargo.toml --test postgres_driver -- --ignored
  cargo test --manifest-path src-tauri/Cargo.toml --test mysql_driver -- --ignored
)
```

MySQL trigger fixtures may need privileges unavailable with binary logging
(error 1419). Record that restriction; do not change server settings or grants
just to make a check pass.

CREATE/DROP DATABASE is a separate destructive suite. Only after `qa-db.sh verify`
succeeds, use the local administrator URLs generated in `.env.qa`:

```bash
VAPORLENSDB_LIVE_TEST_ENV_FILE=.env.qa VAPORLENSDB_ALLOW_DESTRUCTIVE_INTEGRATION=1 \
  ./build.sh destructive-live-tests --mysql --postgresql
```

It requires `VAPORLENSDB_TEST_MYSQL_URL` and/or `VAPORLENSDB_TEST_POSTGRES_URL`
with database-creation privileges. Do not run fixture-mutating or destructive
suites against business, production, shared or otherwise non-disposable databases.

### Oracle and read-only endpoints

Create an ignored `.env.oracle-qa` from `.env.example`, edit the Oracle group and
remove unused groups. Use `TEST_ORACLE_JDBC_URL`, `TEST_ORACLE_USER`,
`TEST_ORACLE_PASSWORD`, `TEST_ORACLE_JDBC_DRIVER_PATH`; URLs must name the service
or explicitly intended SID and JAR paths must be absolute.

```bash
VAPORLENSDB_LIVE_TEST_ENV_FILE=.env.oracle-qa ./build.sh live-tests --oracle
```

This selects only `connects_and_queries_oracle_with_jdbc_bridge` and
`reads_oracle_metadata_with_jdbc_bridge`. Do not run the entire ignored Oracle
suite on a read-only endpoint: Explain writes PLAN_TABLE, and other cases may
need custom SQL, LONG columns or additional privileges.

For the dedicated `driver_readonly_live` probe, create a trusted, ignored
`.env.readonly` containing all five exported values:

| Variable | Value |
| --- | --- |
| `TEST_READONLY_JDBC_URL` | Explicit JDBC URL including database/service/SID |
| `TEST_READONLY_USER` | Authorized read-only user |
| `TEST_READONLY_PASSWORD` | Its password |
| `TEST_READONLY_JDBC_DRIVER_PATH` | Absolute vendor JAR path |
| `TEST_READONLY_DRIVER_DEFINITION` | `jdbc-postgresql`, `jdbc-mysql`, or `oracle` |

```bash
(
  set -ea
  . ./.env.readonly
  set +a
  VAPORLENSDB_USE_DEV_KEY=1 cargo test --manifest-path src-tauri/Cargo.toml --test driver_readonly_live -- --ignored
)
```

The probe runs SELECT/schema metadata and, for MySQL/PostgreSQL, concurrent
Native/JDBC reads. It does not create external fixtures. A supplied endpoint
alone does not authorize writes. Keep secrets in the ignored file/environment,
not command arguments, documentation or test logs.

### Local bridge integration

These tests use local in-memory/temporary databases rather than business servers:

```bash
export TEST_CUSTOM_JDBC_DRIVER_PATH=/absolute/path/to/h2.jar
VAPORLENSDB_USE_DEV_KEY=1 cargo test --manifest-path src-tauri/Cargo.toml --test driver_registry_integration --test custom_jdbc_driver -- --include-ignored

export TEST_SQLITE_JDBC_PATH=/absolute/path/to/sqlite-jdbc.jar
export TEST_SQLITE_SLF4J_PATH=/absolute/path/to/slf4j-api.jar
VAPORLENSDB_USE_DEV_KEY=1 cargo test --manifest-path src-tauri/Cargo.toml --lib sqlite_jdbc_application_command_chain_file_and_memory -- --ignored
```

H2 checks product/installation identity, properties and bridge behavior.
SQLite's application-command test covers Test, save, connect/disconnect,
configuration reload/reconnect, metadata, missing files, private/named memory
lifetime and console transaction survival across primary-bridge loss. Direct
`JdbcDriver` success does not replace that command chain or a desktop test.

To check missing Java without changing PATH in parallel tests, compile
`cargo test --manifest-path src-tauri/Cargo.toml --test driver_environment --no-run`,
then run the printed test executable by absolute path with an empty PATH and
`--include-ignored`. It checks Native SQLite and an explicit JDBC Java-missing error.

## Desktop manual checks

Use the exact intended build and isolated configuration. Check normal, narrow
and maximized windows, continuous resizing/sidebar changes, English/Chinese,
long product/driver names, keyboard navigation and reachable dialog bottom actions.
Record logical window/content dimensions; Retina screenshot pixels are not CSS pixels.
If automation cannot drag native edges, resize manually rather than claiming it passed.

- Connections/drivers: two arbitrary products, multiple installations for one
  product, test/save/connect, restart restoration, editing and deletion-reference guards.
- SQL files: native Open/Save/Save As, overwrite/external conflicts and dirty close/Quit.
- Execution: Current/Selection/All, target switching, Manual transaction refusal,
  explicit Commit/Rollback, cancellation/timeouts, partial failures and retained
  results. Perform write/transaction checks only on the disposable QA database.
- CSV: picker, preview/mapping, failure/cancellation and bounded sanitized reports;
  no automatic sidecars or removal of existing user files.
- Metadata: loading, cancel, error/retry, successful empty and unsupported states;
  exact table ownership for triggers; privileges must not be disguised as empty results.
- Credentials/files: save/quit/restore, SQLite space/Unicode paths, disappeared
  saved files, reconnect from an old SQL tab, clipboard and Monaco shortcuts.
- Startup/theme: explicit Light with OS Dark, explicit Dark with OS Light,
  System mode and live changes, theme change then quit/reopen; observe native title
  bar, initial canvas, HTML skeleton and React handoff, not only the final screen.
  Check visible load failures; do not hide waiting with delayed window display.

Unverified combinations require real environments: Oracle SID needs a listener
and valid SID; real SSH needs an endpoint, credentials and known-host policy;
vendor transaction/recovery tests need explicit writable disposable QA access.
Large-result checks need cursor/driver evidence distinguishing protocol chunks
from bounded fetching, plus attributable memory measurements. Do not estimate
WebView RSS from unrelated WebKit XPC processes. Missing environments remain
unverified; mocks and protocol tests do not certify them. See [SUPPORT](SUPPORT.md).

## Startup diagnostics

Set `VAPORLENSDB_STARTUP_TRACE` to a file outside the repository when launching
the intended app; combine it with the isolated profile above. This opt-in trace
records numeric process/configuration/WebView/frontend/IPC/layout stages without
SQL or credentials; disabled launches do not install its observer.
`loading_interface`/`skeleton_layout` and `empty_root_frame` distinguish the
HTML shell from React handoff. `first_interface` is a requestAnimationFrame
observation after Home is available, **not physical screen paint**. Use recording
where possible to locate native-window/WebView blank frames; report uncaptured stages.

Compare the same machine, build mode, consistent config snapshot and logical
window size. Repeat at least five times and report median/range separately for
loading feedback, frontend entry and interactive Home. Do not compare an old
release to a new dev build. Test first upgrades on an isolated pre-upgrade
snapshot and subsequent starts separately; never downgrade active user config.
A constructed schema fixture proves only that fixture's migration path. Restore
any system appearance or WebView changes after testing; retain no evidence logs
or operation histories in these maintained instructions.
