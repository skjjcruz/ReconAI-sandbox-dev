#!/usr/bin/env node
// Supabase schema health checks for shared ReconAI / War Room data contracts.
// Usage: node tests/schema-health.js
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCHEMA_PATH = path.join(__dirname, 'fixtures', 'field-log-schema.json');
const MIGRATION_PATH = path.join(ROOT, 'supabase', 'migrations', '011_field_log_schema_repair.sql');
const PLAYER_TAGS_POLICY_PATH = path.join(ROOT, 'supabase', 'migrations', '013_player_tags_policy_repair.sql');
const CLIENT_PATH = path.join(ROOT, 'shared', 'supabase-client.js');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const migration = fs.readFileSync(MIGRATION_PATH, 'utf8');
const playerTagsPolicy = fs.readFileSync(PLAYER_TAGS_POLICY_PATH, 'utf8');
const clientSrc = fs.readFileSync(CLIENT_PATH, 'utf8');

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

function columnRegex(column, type) {
  const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const typeHead = String(type || '').split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(?:\\badd\\s+column\\s+if\\s+not\\s+exists\\s+${escaped}\\s+${typeHead}\\b|\\b${escaped}\\s+${typeHead}\\b)`,
    'i'
  );
}

function extractCreateTableBlock(source) {
  const match = source.match(/create\s+table\s+if\s+not\s+exists\s+public\.field_log\s*\(([\s\S]*?)\);/i);
  return match ? match[1] : '';
}

function extractUpsertBlock(source) {
  const start = source.indexOf("db.from('field_log').upsert({");
  if (start < 0) return '';
  const end = source.indexOf('}, { onConflict:', start);
  return end > start ? source.slice(start, end) : '';
}

function extractSelectList(source) {
  const start = source.indexOf('window.OD.loadFieldLog = async function');
  const block = start >= 0 ? source.slice(start) : source;
  const match = block.match(/\.select\('([^']+)'\)/);
  return match ? match[1].split(',').map(s => s.trim()) : [];
}

console.log('\nField-log schema health tests');

group('migration snapshot');

test('migration prefixes are unique to avoid Supabase ordering drift', () => {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(file => file.endsWith('.sql'));
  const seen = new Map();
  files.forEach(file => {
    const prefix = file.match(/^(\d+)_/)?.[1];
    if (!prefix) return;
    if (prefix === '004' && file === '004_field_log.sql') return;
    if (seen.has(prefix)) throw new Error(`duplicate migration prefix ${prefix}: ${seen.get(prefix)}, ${file}`);
    seen.set(prefix, file);
  });
});

test('011_field_log_schema_repair.sql exposes every shared field_log column', () => {
  ok(/create\s+table\s+if\s+not\s+exists\s+public\.field_log/i.test(migration), 'field_log create table missing');
  for (const [column, def] of Object.entries(schema.columns)) {
    ok(columnRegex(column, def.type).test(migration), `${column} ${def.type} missing from migration`);
  }
});

test('migration does not recreate the legacy siloed field_log schema', () => {
  const createBlock = extractCreateTableBlock(migration);
  ok(createBlock, 'create table block missing');
  for (const column of schema.deprecatedCreateColumns) {
    ok(!new RegExp(`\\b${column}\\b`, 'i').test(createBlock), `${column} should not be in create table block`);
    ok(!new RegExp(`add\\s+column\\s+if\\s+not\\s+exists\\s+${column}\\b`, 'i').test(migration), `${column} should not be added as an active column`);
  }
});

test('migration keeps shared upsert identity and query indexes', () => {
  ok(/field_log_client_id_key/i.test(migration), 'client_id unique constraint missing');
  for (const indexName of schema.indexes) {
    ok(new RegExp(`create\\s+index\\s+if\\s+not\\s+exists\\s+${indexName}\\b`, 'i').test(migration), `${indexName} missing`);
  }
});

group('shared client contract');

test('Supabase upsert writes exactly the shared field_log columns', () => {
  const upsertBlock = extractUpsertBlock(clientSrc);
  ok(upsertBlock, 'field_log upsert block missing');
  for (const column of schema.writeColumns) {
    // Owner identity is written via the ...ownerCols(owner) spread, which
    // resolves to `username` (legacy Sleeper) or `user_id` (email account).
    const pattern = column === 'username'
      ? /\busername\b|\.\.\.ownerCols\(/
      : new RegExp(`\\b${column}\\s*:`, 'i');
    ok(pattern.test(upsertBlock), `${column} missing from upsert payload`);
  }
  ok(/onConflict:\s*'client_id'/.test(clientSrc), 'field_log upsert must conflict on client_id');
});

test('Supabase load selects every field needed to present synced entries', () => {
  const selected = extractSelectList(clientSrc);
  ok(selected.length > 0, 'field_log select list missing');
  for (const column of schema.readColumns) {
    ok(selected.includes(column), `${column} missing from load select`);
  }
});

test('client maps snake_case rows back into ReconAI field-log entry shape', () => {
  const requiredMappings = [
    'id: row.client_id || row.id',
    'actionType: row.action_type || null',
    'players: row.players || []',
    'context: row.context || null',
    'leagueId: row.league_id || null',
    'syncStatus: \'synced\'',
  ];
  for (const fragment of requiredMappings) {
    ok(clientSrc.includes(fragment), `missing row mapping: ${fragment}`);
  }
});

group('player tags policy');

test('player_tags policy accepts app-issued anon role session JWTs', () => {
  ok(/create\s+policy\s+player_tags_own[\s\S]*?to\s+public/i.test(playerTagsPolicy), 'player_tags policy must be scoped to public, not authenticated-only');
  ok(/app_metadata[\s\S]*sleeper_username/i.test(playerTagsPolicy), 'policy must check app_metadata.sleeper_username');
  ok(/with\s+check[\s\S]*app_metadata[\s\S]*sleeper_username/i.test(playerTagsPolicy), 'policy must enforce write ownership');
});

test('player_tags migration preserves league-scoped upsert identity', () => {
  ok(/unique\s*\(\s*username\s*,\s*league_id\s*\)/i.test(playerTagsPolicy) || /player_tags_username_league_key/i.test(playerTagsPolicy), 'username,league_id uniqueness missing');
  // Client upserts player_tags via ownerConflict(owner, legacy, account), which
  // resolves to 'username,league_id' (legacy) or 'user_id,league_id' (email account).
  ok(/onConflict:\s*(?:'username,league_id'|ownerConflict\(owner,\s*'username,league_id',\s*'user_id,league_id'\))/.test(clientSrc), 'client must upsert player_tags by username,league_id');
});

console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}
const status = failed > 0 ? 'FAIL' : 'PASS';
console.log(`${status} ${passed + failed} tests - ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
