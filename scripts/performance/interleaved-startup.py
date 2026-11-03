#!/usr/bin/env python3
"""Same-launcher, alternating local release samples. No strict cold-cache claim."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('baseline', Path(__file__).with_name('local-baseline.py'))
baseline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baseline)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--before-app', required=True)
parser.add_argument('--after-app', required=True)
parser.add_argument('--seed-profile', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
out = baseline.output_directory(args.output)
sequence = ['before', 'after', 'after', 'before'] * 3
apps = {'before': args.before_app, 'after': args.after_app}
manifest = {'sequence': sequence, 'runs': [], 'strictColdCache': False,
            'method': 'Identical LaunchServices open -n, separate process, same SQLite backup of 50-connection configuration before every run; OS and WebKit caches not cleared.'}
for label, app in apps.items():
    binary = Path(app) / 'Contents/MacOS/vapor-lens-db.bin'
    manifest[label] = {'app': str(Path(app).resolve()), 'executableSha256': hashlib.sha256(binary.read_bytes()).hexdigest()}
for index, label in enumerate(sequence):
    run = out / f'{index + 1:02d}-{label}'
    run.mkdir()
    profile = run / 'profile'
    profile.mkdir()
    with sqlite3.connect(Path(args.seed_profile) / 'config.db') as source, sqlite3.connect(profile / 'config.db') as target:
        source.backup(target)
    baseline.startup(SimpleNamespace(profile=str(profile), app=apps[label], binary=None, samples=1), run)
    sample = json.loads((run / 'startup-samples.json').read_text())['samples'][0]
    manifest['runs'].append({'index': index + 1, 'revision': label, **sample})
    (out / 'interleaved.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(label, index + 1, sample.get('readyProxyMs', sample.get('error')), flush=True)
