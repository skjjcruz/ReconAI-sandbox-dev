#!/usr/bin/env python3
"""Fail closed unless the reviewed Scout Yahoo client bytes are actually served.
--write records a locally built, clean client + exact canonical shared revision.
The provider workflow only verifies the committed manifest; it never regenerates it.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import posixpath
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DESTINATION = 'https://skjjcruz.github.io/ReconAI-sandbox-dev/'
FLOW = 'browser-verifier-v2'
SOURCE_PATHS = ['index.html', 'js/app.js', 'main.js', 'package-lock.json', 'vite.config.js',
                '.dhq-shared-revision', '.github/workflows/deploy.yml', 'scripts/sync-shared.cjs']
SHA = re.compile(r'^[a-f0-9]{64}$')
REV = re.compile(r'^[a-f0-9]{40}$')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def build_manifest(root, shared):
    shared = shared.resolve()
    pin = (root / '.dhq-shared-revision').read_text().strip()
    if not REV.fullmatch(pin):
        raise ValueError('Invalid canonical shared revision')
    actual = subprocess.check_output(['git', '-C', str(shared), 'rev-parse', 'HEAD'], text=True).strip()
    if actual != pin:
        raise ValueError('Build shared checkout is not the exact reviewed revision')
    subprocess.run(['git', '-C', str(shared), 'diff', '--quiet', 'HEAD', '--', 'yahoo-api.js'], check=True)
    subprocess.run(['git', '-C', str(root), 'diff', '--quiet', 'HEAD', '--'] + SOURCE_PATHS, check=True)
    yahoo_hash = digest((shared / 'yahoo-api.js').read_bytes())
    if digest((root / 'shared/yahoo-api.js').read_bytes()) != yahoo_hash:
        raise ValueError('Vendored Yahoo source differs from canonical revision')
    built = root / 'dist'
    paths = ['index.html'] + sorted(str(p.relative_to(built)) for p in (built / 'assets').glob('*.js'))
    if len(paths) < 2:
        raise ValueError('Build output missing JavaScript')
    if FLOW.encode() not in b''.join((built / p).read_bytes() for p in paths):
        raise ValueError('Build does not contain the reviewed Yahoo protocol')
    return {
        'schema': 1, 'flow_version': FLOW, 'destination': DESTINATION,
        'consumer_repository': 'skjjcruz/ReconAI-sandbox-dev',
        'consumer_revision': subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip(),
        'shared_revision': pin, 'yahoo_source_sha256': yahoo_hash,
        'sources': {p: digest((root / p).read_bytes()) for p in SOURCE_PATHS},
        'artifacts': {p: digest((built / p).read_bytes()) for p in paths},
    }


def validate_manifest(manifest, root):
    if manifest.get('schema') != 1 or manifest.get('flow_version') != FLOW:
        raise ValueError('Missing reviewed Yahoo client protocol')
    if manifest.get('destination') != DESTINATION or manifest.get('consumer_repository') != 'skjjcruz/ReconAI-sandbox-dev':
        raise ValueError('Unreviewed consumer destination')
    if not REV.fullmatch(manifest.get('consumer_revision', '')) or not REV.fullmatch(manifest.get('shared_revision', '')):
        raise ValueError('Consumer/shared revision must be immutable')
    if (root / '.dhq-shared-revision').read_text().strip() != manifest['shared_revision']:
        raise ValueError('Reviewed shared pin changed; rebuild and review the consumer manifest')
    if not SHA.fullmatch(manifest.get('yahoo_source_sha256', '')):
        raise ValueError('Missing canonical Yahoo source hash')
    sources = manifest.get('sources', {})
    if not isinstance(sources, dict) or set(sources) != set(SOURCE_PATHS):
        raise ValueError('Incomplete consumer source snapshot')
    for name, expected in sources.items():
        if not isinstance(expected, str) or not SHA.fullmatch(expected) or digest((root / name).read_bytes()) != expected:
            raise ValueError('Consumer source changed: ' + name)
    artifacts = manifest.get('artifacts', {})
    if not isinstance(artifacts, dict) or 'index.html' not in artifacts or not 2 <= len(artifacts) <= 100:
        raise ValueError('Incomplete reviewed built assets')
    for name, expected in artifacts.items():
        if not isinstance(name, str) or not (name == 'index.html' or re.fullmatch(r'assets/[a-zA-Z0-9_-]+\.js', name)):
            raise ValueError('Unsafe or unreviewed asset path')
        if not isinstance(expected, str) or not SHA.fullmatch(expected):
            raise ValueError('Invalid built-asset hash')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Consumer release verification cannot follow redirects')


def fetch_bytes(url):
    request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache', 'User-Agent': 'DHQ-reviewed-client-preflight/1'})
    with urllib.request.build_opener(NoRedirect).open(request, timeout=20) as response:
        if response.status != 200:
            raise ValueError('Consumer asset did not return HTTP 200')
        body = response.read(20_000_001)
        if len(body) > 20_000_000:
            raise ValueError('Consumer asset exceeds verification bound')
        return body


def verify(manifest, root, fetch=fetch_bytes):
    validate_manifest(manifest, root)
    served = {}
    for name, expected in manifest['artifacts'].items():
        url = DESTINATION + name + '?dhq-yahoo-release=' + manifest['consumer_revision']
        body = fetch(url)
        if digest(body) != expected:
            raise ValueError('Reviewed Yahoo consumer is not served: ' + name)
        served[name] = body.decode('utf-8')
    # A reviewed manifest cannot silently omit a module referenced by the exact
    # served entry document or static import graph.
    refs = re.findall(r'(?:src|href)=[\"\'](?:\./)?(assets/[a-zA-Z0-9_-]+\.js)[\"\']', served['index.html'])
    if not refs:
        raise ValueError('Reviewed entry has no JavaScript module')
    for name, body in served.items():
        if name == 'index.html':
            continue
        for rel in re.findall(r'(?:from\s*|import\s*\()[\"\']([^\"\']+\.js)[\"\']', body):
            refs.append(posixpath.normpath(posixpath.join(posixpath.dirname(name), rel)))
    if any(ref not in served for ref in refs):
        raise ValueError('Reviewed manifest omits a referenced JavaScript module')
    return len(manifest['artifacts'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=ROOT / 'scripts/yahoo-client-release.json')
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--shared', type=Path)
    args = parser.parse_args()
    if args.write:
        if not args.shared:
            parser.error('--write requires the exact reviewed --shared checkout')
        manifest = build_manifest(ROOT, args.shared)
        validate_manifest(manifest, ROOT)
        args.manifest.write_text(json.dumps(manifest, indent=2) + '\n')
        print('Prepared consumer manifest; independent review and served-asset verification are still required.')
    else:
        manifest = json.loads(args.manifest.read_text())
        count = verify(manifest, ROOT)
        print('PASS reviewed Yahoo consumer served: {} exact assets, shared {}'.format(count, manifest['shared_revision']))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        raise SystemExit('Yahoo provider release blocked: ' + str(error))
