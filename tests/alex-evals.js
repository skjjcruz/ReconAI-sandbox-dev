#!/usr/bin/env node
// Offline Alex quality/cost eval harness.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Locate the sibling War Room checkout that owns the ai-analyze edge function.
// Mirrors the candidate-list approach in War Room's sync-reconai-shared.cjs so
// the eval works across clone layouts: explicit env override, the canonical
// `warroom` name, or the default two-repo GitHub repo name.
function findWarroomRoot() {
  const candidates = [
    process.env.WARROOM_ROOT,
    path.resolve(ROOT, '..', 'warroom'),
    path.resolve(ROOT, '..', 'github.com-skjjcruz-owner-dashboard-dev'),
  ].filter(Boolean);
  return candidates.find(candidate =>
    fs.existsSync(path.join(candidate, 'supabase', 'functions', 'ai-analyze', 'index.ts'))
  ) || candidates[1];
}

const WARROOM_ROOT = findWarroomRoot();
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'alex-evals.json'), 'utf8'));
const dispatchSrc = fs.readFileSync(path.join(ROOT, 'shared', 'ai-dispatch.js'), 'utf8');
const edgeSrc = fs.readFileSync(path.join(WARROOM_ROOT, 'supabase', 'functions', 'ai-analyze', 'index.ts'), 'utf8');

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

function routeTierPattern(callType, tier) {
  const key = `['"]${callType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`;
  return new RegExp(`${key}\\s*:\\s*['"]${tier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`);
}

function tierModelPattern(tier, provider, modelConstant) {
  const tierKey = tier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const providerKey = provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${tierKey}\\s*:\\s*\\{[^}]*${providerKey}\\s*:\\s*AI_MODELS\\.${modelConstant}`, 's');
}

console.log('\nAlex offline eval harness');

group('fixture');

test('eval fixture has stable, reviewable cases', () => {
  ok(Array.isArray(fixture.cases), 'cases must be an array');
  ok(fixture.cases.length >= 5, 'expected at least five eval cases');
  const ids = new Set();
  fixture.cases.forEach(testCase => {
    ok(testCase.id && !ids.has(testCase.id), `duplicate/missing id ${testCase.id}`);
    ids.add(testCase.id);
    ok(testCase.callType, `${testCase.id} missing callType`);
    ok(testCase.expectedProvider, `${testCase.id} missing expectedProvider`);
    ok(testCase.expectedModel, `${testCase.id} missing expectedModel`);
    ok(testCase.expectedTier, `${testCase.id} missing expectedTier`);
    ok(testCase.maxCostTier, `${testCase.id} missing maxCostTier`);
    ok(testCase.requiredContext?.length >= 4, `${testCase.id} needs requiredContext signals`);
    ok(testCase.forbidden?.length >= 2, `${testCase.id} needs forbidden behaviors`);
  });
});

group('routing');

test('client routing matches each eval case cost tier', () => {
  fixture.cases.forEach(testCase => {
    ok(routeTierPattern(testCase.callType, testCase.expectedTier).test(dispatchSrc),
      `${testCase.id} route mismatch for ${testCase.callType}`);
    ok(tierModelPattern(testCase.expectedTier, testCase.expectedProvider, testCase.expectedModel).test(dispatchSrc),
      `${testCase.id} default tier model mismatch for ${testCase.expectedTier}`);
  });
});

test('edge routing can execute every eval call type', () => {
  fixture.cases.forEach(testCase => {
    ok(routeTierPattern(testCase.callType, testCase.expectedTier).test(edgeSrc),
      `${testCase.id} edge route mismatch for ${testCase.callType}`);
    ok(tierModelPattern(testCase.expectedTier, testCase.expectedProvider, testCase.expectedModel).test(edgeSrc),
      `${testCase.id} edge tier model mismatch for ${testCase.expectedTier}`);
  });
});

group('analytics');

test('AI eval lifecycle events are instrumented', () => {
  ['alex_prompt_sent', 'alex_response_received', 'alex_response_error'].forEach(eventName => {
    ok(dispatchSrc.includes(eventName), `missing ${eventName}`);
  });
});

console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}
const status = failed > 0 ? 'FAIL' : 'PASS';
console.log(`${status} ${passed + failed} tests - ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
