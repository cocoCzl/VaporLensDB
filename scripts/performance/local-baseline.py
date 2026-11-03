#!/usr/bin/env python3
"""Local-only fixtures, opt-in native startup sampling and trace summaries.

No database credentials, external writes, screenshots, signing or packaging.
All generated files must live outside the repository. Requires Python 3/macOS.
"""
import argparse
import json
import os
from pathlib import Path
import platform
import signal
import sqlite3
import statistics
import subprocess
import time

REPO = Path(__file__).resolve().parents[2]


def output_directory(value):
    path = Path(value).expanduser().resolve()
    if path == REPO or REPO in path.parents:
        raise ValueError('Measurement output must be outside the repository')
    path.mkdir(parents=True, exist_ok=True)
    return path


def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def processes():
    result = subprocess.check_output(['ps', '-axo', 'pid=,ppid=,rss=,comm='], text=True)
    rows = []
    for line in result.splitlines():
        parts = line.strip().split(None, 3)
        if len(parts) == 4:
            pid, parent, rss, executable = parts
            rows.append(dict(pid=int(pid), parent=int(parent), rssKiB=int(rss), executable=executable))
    return rows


def related(rows, pid, preexisting):
    ids = {pid}
    for _ in range(8):
        ids.update(row['pid'] for row in rows if row['parent'] in ids)
    # macOS reparents WebKit helpers to launchd. Include newly observed helpers
    # as candidates; shared/preexisting helpers cannot be attributed by RSS.
    return [row for row in rows if row['pid'] in ids or (
        row['pid'] not in preexisting and '/WebKit.framework/' in row['executable'])]


def fixtures(out):
    for count in (500, 1000):
        path = out / f'isolated-{count}.sqlite'
        if path.exists():
            raise ValueError(f'Refusing to replace existing fixture: {path}')
        with sqlite3.connect(path) as db:
            for index in range(count - 3):
                db.execute(f'CREATE TABLE table_{index:04d}(id INTEGER PRIMARY KEY, label TEXT)')
            db.execute('CREATE TABLE records(id INTEGER PRIMARY KEY, name TEXT, value INTEGER)')
            db.executemany('INSERT INTO records VALUES(?,?,?)', ((i, f'row {i:05d}', i * 7) for i in range(10000)))
            db.execute('CREATE TABLE wide_result(' + ','.join(f'column_{i:03d} TEXT' for i in range(128)) + ')')
            db.executemany('INSERT INTO wide_result VALUES(' + ','.join('?' for _ in range(128)) + ')',
                           ([f'r{r}c{j}' for j in range(128)] for r in range(1000)))
            db.execute('CREATE TABLE long_result(id INTEGER PRIMARY KEY, body TEXT)')
            db.executemany('INSERT INTO long_result VALUES(?,?)', ((i, '本地测量 Local text. ' * 400) for i in range(1000)))
    write(out / 'fixture-manifest.json', dict(tables=[500, 1000], normal=[10000, 3], wide=[1000, 128], long=[1000, 2],
                                             longCellCharacters=len('本地测量 Local text. ' * 400), driver='SQLite Native/rusqlite'))


def startup(args, out):
    profile = Path(args.profile).resolve()
    if profile == REPO or REPO in profile.parents:
        raise ValueError('Use an isolated profile outside the repository')
    profile.mkdir(parents=True, exist_ok=True)
    samples = []
    for index in range(args.samples):
        trace = out / f'startup-{index + 1}.jsonl'
        if trace.exists():
            raise ValueError(f'Refusing to mix samples: {trace}')
        before = {row['pid'] for row in processes()}
        env = {**os.environ, 'VAPORLENSDB_CONFIG_DIR': str(profile), 'VAPORLENSDB_STARTUP_TRACE': str(trace)}
        memory = []
        started = time.monotonic()
        with (out / f'process-{index + 1}.log').open('w') as log:
            # LaunchServices is needed for foreground WebKit animation frames.
            # --app must be a local measurement application, never a user instance.
            process = None
            pid = None
            if args.app:
                subprocess.run(['open', '-n', str(Path(args.app).resolve()), '--env',
                    f'VAPORLENSDB_CONFIG_DIR={profile}', '--env',
                    f'VAPORLENSDB_STARTUP_TRACE={trace}'], check=True, stdout=log, stderr=log)
            else:
                process = subprocess.Popen([str(Path(args.binary).resolve())], env=env, stdout=log, stderr=log)
                pid = process.pid
            try:
                while time.monotonic() - started < 15 and (process is None or process.poll() is None):
                    records = []
                    if trace.exists():
                        # A concurrently appended final line may be incomplete.
                        for line in trace.read_text().splitlines():
                            try: records.append(json.loads(line))
                            except json.JSONDecodeError: pass
                    if records: pid = records[0]['pid']
                    rows = related(processes(), pid, before) if pid else []
                    memory.append(dict(elapsedMs=(time.monotonic() - started) * 1000, processes=rows,
                                       candidateTotalRssKiB=sum(row['rssKiB'] for row in rows)))
                    stages = {record['stage']: record['elapsedMs'] for record in records}
                    # Restored database workspaces have no home section. These
                    # existing milestones work in both empty and restored shells.
                    ready = 'react_shell_frame' in stages and 'ipc_application_close_listener_ready' in stages
                    if ready:
                        samples.append(dict(sample=index + 1, pid=pid, stages=records,
                                            readyProxyMs=max(stages['react_shell_frame'], stages['ipc_application_close_listener_ready']),
                                            cache='OS/file cache not flushed; separate process; first sample is not a cold-cache claim'))
                        break
                    time.sleep(.1)
                else:
                    samples.append(dict(sample=index + 1, pid=pid, error='No shell/listener readiness within deadline or process exited; invalid timing sample'))
            finally:
                if process is None and pid and pid not in before:
                    try: os.kill(pid, signal.SIGTERM)
                    except ProcessLookupError: pass
                elif process is not None and process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
        write(out / f'resources-{index + 1}.json', memory)
        time.sleep(1)
    write(out / 'startup-samples.json', dict(machine=platform.platform(), samples=samples,
          measurement='Internal process_start to max(react_shell_frame, application_close_listener_ready); DOM/rAF + installed listener proxy; excludes launcher time; no physical paint claim',
          memory='RSS KiB, main plus descendants plus newly created WebKit candidates; shared pages double count; unrelated new WebKit is a possible confound'))


def sample_resources(args, out):
    existing = {row['pid'] for row in processes() if row['pid'] != args.pid}
    # Startup traces name the exact newly created helper PIDs in startup samples.
    for pid in args.helper:
        existing.discard(pid)
    rows = []
    start = time.monotonic()
    while time.monotonic() - start < args.seconds:
        current = related(processes(), args.pid, existing)
        rows.append(dict(elapsedMs=(time.monotonic() - start) * 1000, processes=current,
                         candidateTotalRssKiB=sum(row['rssKiB'] for row in current)))
        write(out / 'resource-series.json', rows)
        time.sleep(.25)


def summarize(args, out):
    records = [json.loads(line) for line in Path(args.trace).read_text().splitlines()]
    ipc, frames = {}, {}
    for record in records:
        stage, metrics = record['stage'], record.get('metrics', {})
        if stage.startswith('ipc_') and 'duration' in metrics:
            ipc.setdefault(stage[4:], []).append(metrics['duration'])
        if stage == 'perf_frame_gap':
            frames.setdefault(metrics['category'], []).append(metrics['duration'])
    def stats(values):
        ordered = sorted(values)
        return dict(n=len(values), medianMs=statistics.median(values), p95Ms=ordered[min(len(ordered)-1, int(len(ordered)*.95))], maxMs=max(values))
    write(out / 'trace-summary.json', dict(ipc={key: stats(values) for key, values in ipc.items()},
         frameGapsByInputCategory={key: stats(values) for key, values in frames.items()},
         bufferedFrameWindows=[record for record in records if record['stage'] == 'perf_frame_gaps'],
         categories={'1':'click','2':'keydown','3':'input','4':'scroll'},
         interactions=[record for record in records if record['stage'] in ['perf_input','perf_frame']]))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['fixtures', 'startup', 'resources', 'summarize'])
    parser.add_argument('--output', required=True)
    parser.add_argument('--binary')
    parser.add_argument('--app', help='Foreground local measurement .app, mutually exclusive with --binary')
    parser.add_argument('--profile')
    parser.add_argument('--trace')
    parser.add_argument('--samples', type=int, default=5)
    parser.add_argument('--pid', type=int)
    parser.add_argument('--helper', type=int, action='append', default=[])
    parser.add_argument('--seconds', type=int, default=300)
    args = parser.parse_args()
    if args.mode == 'startup' and (bool(args.app) == bool(args.binary) or not args.profile):
        parser.error('startup requires --profile and exactly one of --app/--binary')
    out = output_directory(args.output)
    if args.mode == 'fixtures': fixtures(out)
    elif args.mode == 'startup': startup(args, out)
    elif args.mode == 'resources': sample_resources(args, out)
    else: summarize(args, out)
