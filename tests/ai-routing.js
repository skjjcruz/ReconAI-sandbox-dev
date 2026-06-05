#!/usr/bin/env node
// AI routing and pricing regression tests.
// Guards against stale provider model IDs, stale pricing constants, and route drift.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function findWarRoomRoot() {
  const candidates = [
    process.env.WARROOM_ROOT,
    path.resolve(ROOT, '..', 'warroom'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const edgeFile = path.join(candidate, 'supabase', 'functions', 'ai-analyze', 'index.ts');
    if (fs.existsSync(edgeFile)) return candidate;
  }

  return null;
}

const WARROOM_ROOT = findWarRoomRoot();
const EDGE_SOURCE = WARROOM_ROOT
  ? fs.readFileSync(path.join(WARROOM_ROOT, 'supabase', 'functions', 'ai-analyze', 'index.ts'), 'utf8')
  : '';
const sources = {
  client: fs.readFileSync(path.join(ROOT, 'shared', 'ai-dispatch.js'), 'utf8'),
  edge: EDGE_SOURCE,
  devPreviewConfig: fs.readFileSync(path.join(ROOT, 'shared', 'dev-preview-config.js'), 'utf8'),
  main: fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8'),
  vite: fs.readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8'),
};

const EXPECTED_MODELS = {
  GEMINI_FAST: 'gemini-2.5-flash-lite',
  GEMINI_BALANCED: 'gemini-2.5-flash',
  OPENAI_FAST: 'gpt-5.4-nano',
  OPENAI_STANDARD: 'gpt-5.4-mini',
  OPENAI_PREMIUM: 'gpt-5.5',
  CLAUDE_REASONING: 'claude-sonnet-4-6',
  CLAUDE_DEEP: 'claude-opus-4-7',
};

const EXPECTED_COSTS = {
  'gemini-2.5-flash-lite': { input: 0.10, output: 0.40 },
  'gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'gpt-5.4-nano': { input: 0.20, output: 1.25, cachedInput: 0.02 },
  'gpt-5.4-mini': { input: 0.75, output: 4.50, cachedInput: 0.075 },
  'gpt-5.5': { input: 5.00, output: 30.00, cachedInput: 0.50 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00, cachedInput: 0.30 },
  'claude-opus-4-7': { input: 5.00, output: 25.00, cachedInput: 0.50 },
};

const DEPRECATED_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'claude-sonnet-4-20250514',
  'claude-opus-4-20250514',
  'claude-3-7-sonnet-20250219',
  'claude-3-5-haiku-20241022',
];

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write('.');
  } catch (err) {
    failed++;
    failures.push(`  FAIL: ${name}\n        ${err.message}`);
    process.stdout.write('F');
  }
}

function group(label) {
  process.stdout.write(`\n  ${label}  `);
}

function ok(value, label) {
  if (!value) throw new Error(label || 'expected truthy value');
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function numberPattern(value) {
  const [whole, decimals = ''] = String(value.toFixed(2)).split('.');
  return `${whole}(?:\\.${decimals.replace(/0+$/, '')}\\d*)?`;
}

function assertNoDeprecatedModels(source, sourceName) {
  for (const model of DEPRECATED_MODELS) {
    ok(!source.includes(model), `${sourceName} still references deprecated model ${model}`);
  }
}

function assertModelConstant(source, name, value, sourceName) {
  const pattern = new RegExp(`${name}\\s*:\\s*['"]${escapeRegex(value)}['"]`);
  ok(pattern.test(source), `${sourceName} missing ${name}: ${value}`);
}

function assertCost(source, model, expected, sourceName) {
  const input = numberPattern(expected.input);
  const output = numberPattern(expected.output);
  let pattern = `['"]${escapeRegex(model)}['"]\\s*:\\s*\\{[^}]*input\\s*:\\s*${input}[^}]*output\\s*:\\s*${output}`;
  if (expected.cachedInput != null) {
    pattern += `[^}]*cachedInput\\s*:\\s*${numberPattern(expected.cachedInput)}`;
  }
  ok(new RegExp(pattern, 's').test(source), `${sourceName} has stale/missing cost constants for ${model}`);
}

function assertRoute(source, callType, provider, modelConstant, sourceName) {
  const key = `(?:['"]${escapeRegex(callType)}['"]|${escapeRegex(callType)})`;
  const pattern = new RegExp(
    `${key}\\s*:\\s*\\{[^}]*provider\\s*:\\s*['"]${provider}['"][^}]*model\\s*:\\s*AI_MODELS\\.${modelConstant}`,
    's'
  );
  ok(pattern.test(source), `${sourceName} route ${callType} should use ${provider}/${modelConstant}`);
}

function assertRouteTier(source, callType, tier, sourceName) {
  const key = `(?:['"]${escapeRegex(callType)}['"]|${escapeRegex(callType)})`;
  const pattern = new RegExp(`${key}\\s*:\\s*['"]${escapeRegex(tier)}['"]`);
  ok(pattern.test(source), `${sourceName} route ${callType} should use ${tier} tier`);
}

function testIfEdgeAvailable(name, fn) {
  test(name, () => {
    if (!sources.edge) return;
    fn();
  });
}

console.log('\nAI routing regression tests');

group('model IDs');

testIfEdgeAvailable('client and edge do not reference deprecated models', () => {
  assertNoDeprecatedModels(sources.client, 'client dispatcher');
  assertNoDeprecatedModels(sources.edge, 'edge function');
});

test('client exposes current routing model IDs', () => {
  assertModelConstant(sources.client, 'GEMINI_FAST', EXPECTED_MODELS.GEMINI_FAST, 'client dispatcher');
  assertModelConstant(sources.client, 'GEMINI_BALANCED', EXPECTED_MODELS.GEMINI_BALANCED, 'client dispatcher');
  assertModelConstant(sources.client, 'OPENAI_FAST', EXPECTED_MODELS.OPENAI_FAST, 'client dispatcher');
  assertModelConstant(sources.client, 'OPENAI_STANDARD', EXPECTED_MODELS.OPENAI_STANDARD, 'client dispatcher');
  assertModelConstant(sources.client, 'OPENAI_PREMIUM', EXPECTED_MODELS.OPENAI_PREMIUM, 'client dispatcher');
  assertModelConstant(sources.client, 'CLAUDE_REASONING', EXPECTED_MODELS.CLAUDE_REASONING, 'client dispatcher');
  assertModelConstant(sources.client, 'CLAUDE_DEEP', EXPECTED_MODELS.CLAUDE_DEEP, 'client dispatcher');
  ok(sources.client.includes('AI_POLICY_VERSION'), 'client dispatcher missing versioned AI policy');
});

testIfEdgeAvailable('edge exposes current routing model IDs', () => {
  for (const [name, value] of Object.entries(EXPECTED_MODELS)) {
    assertModelConstant(sources.edge, name, value, 'edge function');
  }
});

group('pricing');

testIfEdgeAvailable('edge pricing constants match verified provider rates', () => {
  for (const [model, expected] of Object.entries(EXPECTED_COSTS)) {
    assertCost(sources.edge, model, expected, 'edge function');
  }
});

group('client routing');

test('simple Alex/recon tasks route to fast tier', () => {
  ['memory-summary', 'power-posts', 'recon-chat'].forEach(type => {
    assertRouteTier(sources.client, type, 'fast', 'client dispatcher');
  });
  // home-chat runs on the standard tier: it's Alex's flagship conversational
  // surface and needs a model that can hold the persona's voice.
  assertRouteTier(sources.client, 'home-chat', 'standard', 'client dispatcher');
});

test('medium analysis tasks route to standard tier', () => {
  ['waiver-chat', 'waiver-agent', 'draft-chat', 'strategy-analysis'].forEach(type => {
    assertRouteTier(sources.client, type, 'standard', 'client dispatcher');
  });
});

test('complex reasoning tasks route to premium tier', () => {
  ['trade-chat', 'trade-scout', 'draft-scout', 'pick-analysis', 'player-scout'].forEach(type => {
    assertRouteTier(sources.client, type, 'premium', 'client dispatcher');
  });
});

test('client tier policy preserves low-cost defaults and explicit deep routes', () => {
  ok(sources.client.includes('DEFAULT_PROVIDER_BY_TIER'), 'client dispatcher missing default provider policy');
  ok(sources.client.includes("fast: 'gemini'"), 'fast tier should default to Gemini');
  ok(sources.client.includes("standard: 'gemini'"), 'standard tier should default to Gemini');
  ok(sources.client.includes("premium: 'anthropic'"), 'premium tier should default to Anthropic');
  ok(sources.client.includes("routeForTier(tier"), 'client dispatcher missing tier route resolver');
  ['deep-analysis', 'league-report', 'rule-simulator', 'trade-audit'].forEach(type => {
    assertRouteTier(sources.client, type, 'deep', 'client dispatcher');
  });
});

test('client exposes OpenAI as BYO provider without making it default', () => {
  ok(sources.client.includes("openai: {"), 'client dispatcher missing OpenAI provider');
  ok(sources.client.includes("https://api.openai.com/v1/responses"), 'client dispatcher missing OpenAI direct adapter');
  ok(sources.client.includes("byok: true"), 'BYO calls should be tagged in analytics');
  ok(sources.client.includes("defaultModel: AI_MODELS.GEMINI_FAST"), 'Gemini should remain fast default');
});

group('local preview wiring');

test('Scout local preview uses the same dev AI bridge contract as War Room', () => {
  const devConfigImport = sources.main.indexOf("import './shared/dev-preview-config.js';");
  const appConfigImport = sources.main.indexOf("import './shared/app-config.js';");
  ok(devConfigImport >= 0, 'main.js should load dev-preview-config');
  ok(appConfigImport >= 0, 'main.js should load app-config');
  ok(devConfigImport < appConfigImport, 'dev-preview-config must load before app-config');
  ok(sources.devPreviewConfig.includes('devPreviewAI: true'), 'dev config should enable local preview AI');
  ok(sources.devPreviewConfig.includes('/api/dev-ai-analyze'), 'dev config should route AI calls to the local bridge');
  ok(sources.devPreviewConfig.includes("startsWith('/ReconAI/')"), 'dev config should honor the Vite /ReconAI base path');
  ok(sources.vite.includes("name: 'scout-dev-ai-bridge'"), 'Vite dev bridge should be registered as a plugin');
  ok(sources.vite.includes('configureServer(server)'), 'Vite dev bridge should use the configureServer plugin hook');
  ok(sources.vite.includes("pathname === '/api/dev-ai-analyze'"), 'Vite dev server should expose /api/dev-ai-analyze');
  ok(sources.vite.includes("pathname === '/ReconAI/api/dev-ai-analyze'"), 'Vite dev server should expose /ReconAI/api/dev-ai-analyze');
  ['OPENAI_API_KEY', 'GOOGLE_AI_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY'].forEach(key => {
    ok(sources.vite.includes(key), `Vite dev bridge should support ${key}`);
  });
  ok(sources.vite.includes('Local AI preview bridge is not configured'), 'missing clear local preview setup error');
});

group('edge routing');

testIfEdgeAvailable('server simple/medium routes match cost strategy', () => {
  ['home-chat', 'memory-summary', 'power-posts', 'recon-chat'].forEach(type => {
    assertRouteTier(sources.edge, type, 'fast', 'edge function');
  });
  ['waiver-chat', 'waiver-agent', 'draft-chat', 'strategy-analysis'].forEach(type => {
    assertRouteTier(sources.edge, type, 'standard', 'edge function');
  });
});

testIfEdgeAvailable('server complex routes use premium tier, commissioner deep routes use deep tier', () => {
  ['trade-chat', 'trade-scout', 'draft-scout', 'pick-analysis', 'player-scout'].forEach(type => {
    assertRouteTier(sources.edge, type, 'premium', 'edge function');
  });
  ['deep-analysis', 'league-report', 'rule-simulator', 'trade-audit'].forEach(type => {
    assertRouteTier(sources.edge, type, 'deep', 'edge function');
  });
  ok(sources.edge.includes("routeForTier('deep')"), 'commissioner routes should use deep tier');
});

console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}
const status = failed > 0 ? 'FAIL' : 'PASS';
console.log(`${status} ${passed + failed} tests - ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
