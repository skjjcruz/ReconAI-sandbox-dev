import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest
spec = importlib.util.spec_from_file_location('guard', Path(__file__).parents[1] / 'scripts/verify-yahoo-client-release.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

class ReleaseGuard(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for path in guard.SOURCE_PATHS:
            p = self.root / path
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text('fixture:' + path)
        (self.root / '.dhq-shared-revision').write_text('a' * 40)
        self.manifest = {'schema': 1, 'flow_version': guard.FLOW, 'destination': guard.DESTINATION,
                         'consumer_repository': 'skjjcruz/ReconAI-sandbox-dev', 'consumer_revision': 'b' * 40,
                         'shared_revision': 'a' * 40, 'yahoo_source_sha256': 'c' * 64,
                         'sources': {p: guard.digest((self.root / p).read_bytes()) for p in guard.SOURCE_PATHS},
                         'artifacts': {'index.html': guard.digest(b'<script src="./assets/client-123.js"></script>'), 'assets/client-123.js': guard.digest(b'js')}}
    def test_exact_reviewed_assets_pass(self):
        calls = []
        def fetch(url):
            calls.append(url)
            return b'<script src="./assets/client-123.js"></script>' if '/index.html?' in url else b'js'
        self.assertEqual(guard.verify(self.manifest, self.root, fetch), 2)
        self.assertEqual(len(calls), 2)
        self.assertTrue(all(u.startswith(guard.DESTINATION) and '?dhq-yahoo-release=' in u for u in calls))
    def test_old_or_error_asset_never_passes(self):
        for body in [b'old client', b'<html>Not Found</html>', b'']:
            with self.assertRaisesRegex(ValueError, 'not served'):
                guard.verify(self.manifest, self.root, lambda _: body)
    def test_missing_or_floating_revision_fails(self):
        for key, value in [('schema', 0), ('flow_version', 'old'), ('shared_revision', 'main'), ('consumer_revision', ''), ('yahoo_source_sha256', '')]:
            m = copy.deepcopy(self.manifest); m[key] = value
            with self.assertRaises(ValueError): guard.validate_manifest(m, self.root)
    def test_destination_and_path_cannot_redirect_scope(self):
        for destination in ['http://localhost/', 'https://evil.invalid/', guard.DESTINATION + '../']:
            m = copy.deepcopy(self.manifest); m['destination'] = destination
            with self.assertRaises(ValueError): guard.validate_manifest(m, self.root)
        for path in ['../secret', 'assets/../../index.html', 'https://evil.invalid/a.js', 'assets/a.js?x']:
            m = copy.deepcopy(self.manifest); m['artifacts'][path] = 'd' * 64
            with self.assertRaises(ValueError): guard.validate_manifest(m, self.root)
    def test_incomplete_snapshot_or_source_change_blocks(self):
        m = copy.deepcopy(self.manifest); del m['sources']['js/app.js']
        with self.assertRaises(ValueError): guard.validate_manifest(m, self.root)
        (self.root / 'js/app.js').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'source changed'): guard.validate_manifest(self.manifest, self.root)
    def test_pin_change_blocks(self):
        (self.root / '.dhq-shared-revision').write_text('d' * 40)
        with self.assertRaisesRegex(ValueError, 'pin changed'): guard.validate_manifest(self.manifest, self.root)
    def test_missing_entry_or_js_is_not_release(self):
        for artifacts in [{}, {'index.html': 'd' * 64}, {'assets/a.js': 'd' * 64, 'assets/b.js': 'e' * 64}]:
            m = copy.deepcopy(self.manifest); m['artifacts'] = artifacts
            with self.assertRaises(ValueError): guard.validate_manifest(m, self.root)
    def test_workflow_guards_every_provider_deploy(self):
        workflow = (Path(__file__).parents[1] / '.github/workflows/deploy-functions.yml').read_text()
        gate = workflow.index('      - name: Require reviewed Yahoo consumer bytes already served')
        self.assertIn('run: python3 scripts/verify-yahoo-client-release.py', workflow[gate:])
        section = workflow[gate:workflow.index('      - name: Deploy espn-proxy function')]
        self.assertIn("if: ${{ env.SUPABASE_ACCESS_TOKEN != '' }}", section)
        self.assertNotIn('continue-on-error', section)
        self.assertNotIn('env:', section)
        for name in ['espn-proxy', 'mfl-proxy', 'yahoo-proxy']:
            self.assertLess(gate, workflow.index('run: supabase functions deploy ' + name))

    def test_manifest_cannot_omit_referenced_module(self):
        index = b'<script src="./assets/missing.js"></script>'
        self.manifest['artifacts']['index.html'] = guard.digest(index)
        with self.assertRaisesRegex(ValueError, 'omits a referenced'):
            guard.verify(self.manifest, self.root, lambda url: index if '/index.html?' in url else b'js')

    def test_redirect_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'cannot follow'):
            guard.NoRedirect().redirect_request(None, None, 302, None, None, 'https://evil.invalid')

if __name__ == '__main__': unittest.main()
