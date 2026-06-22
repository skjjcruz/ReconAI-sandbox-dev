#!/usr/bin/env node
// Vendor the canonical shared browser engine from skjjcruz/DHQ-Shared into ReconAI.
//
// The canonical source of truth is the DHQ-Shared repo. This script copies the
// modules listed in DHQ-Shared/manifest.json into ./shared/ (copy-in-place, so
// Scout-only modules that live in the same dir are left untouched) and the data
// CSVs into ./public/draft-war-room/ so Vite serves them same-origin.
//
// Source resolution order:
//   1. $DHQ_SHARED_SOURCE  (used in CI / deploy)
//   2. ../DHQ-Shared        (skjjcruz canonical, sibling checkout)
//   3. ../dhq-shared        (lowercase sibling fallback)
// If no source is found but vendored copies already exist, the sync no-ops and
// uses what is on disk (so a deploy artifact without the sibling still builds).
// If neither exists, it fails the build.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHARED_TARGET = path.join(ROOT, 'shared');
const PUBLIC_ROOT = path.join(ROOT, 'public');

function findSourceDir() {
  const candidates = [
    process.env.DHQ_SHARED_SOURCE,
    path.resolve(ROOT, '..', 'DHQ-Shared'),
    path.resolve(ROOT, '..', 'dhq-shared'),
  ].filter(Boolean);
  return candidates.find(dir => fs.existsSync(path.join(dir, 'manifest.json'))) || null;
}

function readManifest(sourceDir) {
  const raw = fs.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(raw);
  return {
    modules: Array.isArray(manifest.modules) ? manifest.modules : [],
    data: Array.isArray(manifest.data) ? manifest.data : [],
  };
}

// DHQ-Shared/manifest.json is the single source of truth when a source checkout
// is available. This inline list is only used to confirm the on-disk snapshot is
// complete when no source is present (offline deploy artifact). Keep it in lockstep
// with DHQ-Shared/manifest.json "modules".
const FALLBACK_MODULES = [
  'app-config.js', 'bug-capture.js', 'constants.js', 'utils.js', 'storage.js',
  'event-bus.js', 'platform-provider.js', 'sleeper-api.js', 'espn-api.js',
  'mfl-api.js', 'yahoo-api.js', 'supabase-client.js', 'tier.js',
  'pick-value-model.js', 'dhq-providers.js', 'dhq-core.js', 'intelligence-context.js',
  'dhq-engine.js', 'nfl-fit.js', 'team-assess.js', 'analytics-engine.js',
  'dhq-ai.js', 'assistant-tutorial.js', 'ai-dispatch.js', 'strategy.js',
  'trade-engine.js', 'mock-engine.js', 'gm-engine.js', 'player-modal.js', 'rookie-data.js',
];

const SOURCE = findSourceDir();

if (!SOURCE) {
  const present = FALLBACK_MODULES.every(f => fs.existsSync(path.join(SHARED_TARGET, f)));
  if (present) {
    console.log('[sync-shared] DHQ-Shared source unavailable; using existing vendored copies');
    process.exit(0);
  }
  console.error('[sync-shared] Missing DHQ-Shared source and vendored copies.');
  console.error('[sync-shared] Check out skjjcruz/DHQ-Shared as ../DHQ-Shared or set $DHQ_SHARED_SOURCE.');
  process.exit(1);
}

const { modules, data } = readManifest(SOURCE);

fs.mkdirSync(SHARED_TARGET, { recursive: true });
for (const file of modules) {
  const src = path.join(SOURCE, file);
  if (!fs.existsSync(src)) {
    console.error(`[sync-shared] Missing module in source: ${src}`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(SHARED_TARGET, file));
}

for (const rel of data) {
  const src = path.join(SOURCE, rel);
  if (!fs.existsSync(src)) {
    console.error(`[sync-shared] Missing data file in source: ${src}`);
    process.exit(1);
  }
  const dest = path.join(PUBLIC_ROOT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

console.log(`[sync-shared] Vendored ${modules.length} modules into shared/ and ${data.length} data files into public/ from ${SOURCE}`);
