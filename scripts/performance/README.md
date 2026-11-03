# Local experience baseline

Keep all outputs and isolated profiles outside the repository. Never use a user
workspace, production data generators, credentials in command arguments, or
machine-wide WebKit RSS totals. The scripts do not publish or sign anything.

## Native release

Build with `pnpm tauri build --no-bundle --no-sign`. Record the commit and dirty
diff hash, executable SHA-256, OS/CPU/RAM, window **logical** dimensions, backend,
driver version, database fixture and concurrent machine activity. A local app
shell may be needed for macOS resource lookup; it is not a distribution package.

Generate SQLite fixtures once:

```sh
python3 scripts/performance/local-baseline.py fixtures --output /absolute/external/fixtures
```

Use an isolated profile with exactly 50 saved connections for both revisions.
Copy its SQLite configuration with the backup API, including no passwords.
Measure consecutive processes through LaunchServices on macOS:

```sh
python3 scripts/performance/local-baseline.py startup \
  --app /absolute/external/measurement.app \
  --profile /absolute/external/profile --samples 5 \
  --output /absolute/external/startup
```

The readiness proxy is the later of a rendered shell rAF and the application
close listener installation, measured from Rust process start. It excludes
launcher time and is not physical paint or an automated proof that every action
works. Missing readiness is an **invalid sample**, never zero latency. Report
first process and subsequent processes separately. OS caches are not flushed;
do not call these strict cold-cache results. For cold launch, repeat after a
documented reboot/cache protocol with the same isolated profile.

In a real native session, run connection test/save/connect, expand 500 and 1000
tables, search, preview, execute the same SQL, scroll and switch tabs. Repeat five
times. Record first visible content separately from IPC duration. The opt-in
`VAPORLENSDB_STARTUP_TRACE` accepts only numeric interaction/IPC metrics; it never
records SQL or field values. Summarize with:

```sh
python3 scripts/performance/local-baseline.py summarize \
  --trace /absolute/external/workflow.jsonl --output /absolute/external/summary
```

For memory, sample the main PID and explicitly identified helper PIDs during 30
open/close cycles, then after 30 seconds idle:

```sh
python3 scripts/performance/local-baseline.py resources --pid MAIN_PID \
  --helper WEB_CONTENT_PID --helper GPU_PID --helper NETWORKING_PID \
  --seconds 60 --output /absolute/external/resources
```

RSS is KiB and shared pages may be counted more than once. macOS reparents some
WebKit helpers to launchd, so newly created helpers are **candidates**, not exact
ownership. Include associated JVM processes for JDBC. A stable main-process RSS
alone does not prove resource recovery or compare different architectures.

## Browser renderer isolation

```sh
VAPOR_QA_SOURCE=/absolute/baseline/source \
VAPOR_QA_BEFORE=1 VAPOR_QA_OUTPUT=/absolute/external/before \
node --test scripts/browser/connection-experience.test.mjs

VAPOR_QA_OUTPUT=/absolute/external/after \
node --test scripts/browser/connection-experience.test.mjs
```

Use an archived baseline source with dependencies linked to the same installed
versions. Run revisions sequentially without compilation. Optional
`VAPOR_QA_WORKLOADS_ONLY=1` skips the connection screenshot matrix. Inspect the
images, not only assertions. This checks real React/CSS under Chromium/Vite with
**mock IPC**: it cannot replace native WebKit, database, JNI/JVM, network, saved
credential, physical-paint, or OS-memory acceptance. Automated locator timing
includes test-driver overhead. The renderer fixtures retain existing row/byte
limits; row-byte estimates are not heap size.

## Competitors

Only compare isolated DBX/DBeaver configurations on the same machine, database,
SQL and returned rows, with specific product/driver versions and Native/JDBC
paths recorded. Separate warm database/cache runs and cold ones. Preserve user
instances. If isolation or comparable instrumentation is unavailable, leave the
comparison missing; package size or language choice is not performance evidence.
