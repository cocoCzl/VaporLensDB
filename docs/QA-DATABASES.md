# Disposable Database QA

This is local QA infrastructure for Pre-1.0 source development. It does not
create a release, change the deterministic build gate, or authorize use of any
production, business, customer, or shared development database.

## Local stack

The repository provisions only two Docker services:

- MySQL 8.4 on host port `13306` by default.
- PostgreSQL 16 on host port `15432` by default.

Both services use the `vaporlensdb-qa` Compose project, the
`vaporlensdb_qa` database, synthetic local-only credentials, and named volumes
with the same QA prefix. They never read the repository `.env`.

```bash
./scripts/qa-db.sh up
./scripts/qa-db.sh status
./scripts/qa-db.sh verify
./scripts/qa-db.sh reset
./scripts/qa-db.sh down
./scripts/qa-db.sh down --volumes
```

`down` removes only this project's containers and retains its volumes. `reset`
removes and recreates only this project's QA volumes, then waits for health
checks and restores the fixture. `down --volumes` is the explicit equivalent
when the stack is no longer needed. None of these commands runs Docker-wide
prune commands or stops unrelated containers.

Port overrides are explicit:

```bash
VAPORLENSDB_QA_MYSQL_PORT=23306 \
VAPORLENSDB_QA_POSTGRES_PORT=25432 \
./scripts/qa-db.sh up
```

If ports are overridden, use the same exports when creating the QA env file:

```bash
VAPORLENSDB_QA_MYSQL_PORT=23306 \
VAPORLENSDB_QA_POSTGRES_PORT=25432 \
./scripts/qa-db.sh env > .env.qa
```

`qa-db.sh env` intentionally does not modify `.env`.

## Accounts and mutation boundary

The normal application QA account is `vaporlensdb_qa`. It is restricted to the
`vaporlensdb_qa` database. It can read the fixture and mutate fixture objects
for transaction and metadata checks, but it cannot create or drop databases.

The container-init administrator account is separate. It is only for Compose
initialization and the explicitly opt-in destructive CREATE/DROP DATABASE
suite. Synthetic credentials are embedded in the Compose fixture solely so a
fresh clone can reproduce local QA; they are not production credentials and
must never be reused outside this stack.

Before running a fixture-mutating live test, create a Git-ignored environment
file from the values printed by:

```bash
./scripts/qa-db.sh env > .env.qa
```

Set the two local JDBC JAR paths in the invoking shell, then select `.env.qa`
explicitly rather than allowing the helper to read a personal `.env`:

```bash
export TEST_MYSQL_JDBC_DRIVER_PATH=/absolute/path/to/mysql-connector-j.jar
export TEST_PG_JDBC_DRIVER_PATH=/absolute/path/to/postgresql.jar
VAPORLENSDB_LIVE_TEST_ENV_FILE=.env.qa \
  ./build.sh live-tests --mysql --postgresql
```

The live JDBC metadata tests fail closed unless both
`VAPORLENSDB_QA_ENVIRONMENT=1` and the `vaporlensdb_qa_marker` row are present
in the selected database. The marker also verifies that the current database
is exactly `vaporlensdb_qa`; hostname alone is never treated as a safety proof.

The CREATE/DROP DATABASE tests remain separate:

```bash
VAPORLENSDB_ALLOW_DESTRUCTIVE_INTEGRATION=1 \
./build.sh destructive-live-tests --mysql --postgresql
```

Run that command only after `qa-db.sh verify` succeeds and only with the local
admin URLs printed by `qa-db.sh env`.

## Fixture

Both databases initialize a small, equivalent fixture:

- `parent_items` and `child_items` with a PK, FK, and `idx_child_parent`.
- `child_item_view`.
- nullable text, numeric, text, date/time, and boolean-or-equivalent values.
- `vaporlensdb_qa_marker(environment = disposable_qa, fixture_version = 1)`.

`reset` is the recovery mechanism after commit/rollback or DDL exercises. Do
not point manual QA at a database without this marker.

## SQLite temporary directory

SQLite QA must use a new directory, never a user database:

```bash
qa_dir="$(./scripts/qa-sqlite-dir.sh create)"
printf '%s\n' "$qa_dir"
# Use "$qa_dir/space path/qa fixture.sqlite" and "$qa_dir/测试路径/qa-fixture.sqlite".
./scripts/qa-sqlite-dir.sh cleanup "$qa_dir"
```

The helper only removes directories it created under a `vaporlensdb-qa.*`
temporary-path prefix, and fails closed for every other target.

## Isolated app profile procedure

The Rust backend resolves its config database beneath `$HOME/.vaporlensdb`.
For a local dev-runtime QA profile, create and run a temporary `HOME` with the
provided helper:

```bash
profile_dir="$(./scripts/qa-dev-profile.sh create)"
./scripts/qa-dev-profile.sh run "$profile_dir"
# After the app exits and any evidence is collected:
./scripts/qa-dev-profile.sh cleanup "$profile_dir"
```

This isolates backend config, the config SQLite file, and the development key
file from the normal profile.

For the focused macOS Keychain credential-restore check, keep the logged-in
Keychain while isolating only VaporLensDB's config database:

```bash
profile_dir="$(./scripts/qa-dev-profile.sh create)"
./scripts/qa-dev-profile.sh run-keychain "$profile_dir"
```

`run-keychain` sets the explicit `VAPORLENSDB_CONFIG_DIR` QA override. Normal
launches do not set it and retain the standard platform configuration path.

macOS Keychain is otherwise an OS-wide shared item for VaporLensDB, so a
temporary `HOME` alone does not isolate it. The development-key setting is
appropriate only for this local QA procedure; it is not a normal-installation
setting. WebKit localStorage is also not proven to follow a custom `HOME` on
macOS. Treat WebView storage as potentially shared: inspect it manually and
never delete a real user profile as cleanup.

The native logger uses the process output through `env_logger`; this procedure
does not create or remove a separate persistent log directory. Capture QA logs
from the isolated terminal session and redact them before attaching evidence.

The current UI automation tool cannot reliably dispatch React controlled-input
events for native WebView form fields. SQLite file-picker/path scenarios remain
manual packaged-app QA until an automation path that produces real keyboard
input is available. No QA-only IPC or product backdoor is introduced.
