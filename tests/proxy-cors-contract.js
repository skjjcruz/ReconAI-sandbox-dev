#!/usr/bin/env node
// Contract tests for public proxy Edge Function CORS hardening.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const sharedCors = read('supabase/functions/_shared/cors.ts');
const espn = read('supabase/functions/espn-proxy/index.ts');
const mfl = read('supabase/functions/mfl-proxy/index.ts');
const yahoo = read('supabase/functions/yahoo-proxy/index.ts');
const rateLimitHelper = read('supabase/functions/_shared/rate-limit.ts');
const rateLimitMigration = read('supabase/migrations/022_proxy_rate_limits.sql');

let passed = 0;
let failed = 0;
const failures = [];

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

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

function hasEvery(source, fragments, label) {
  for (const fragment of fragments) ok(source.includes(fragment), `${label}: missing ${fragment}`);
}

console.log('\nProxy CORS contract tests');

group('shared helper');

test('shared CORS helper uses an allowlist, not wildcard CORS', () => {
  hasEvery(sharedCors, [
    'APP_ALLOWED_ORIGINS',
    'https://c2-football.github.io',
    'https://warroom.skjjcruz.com',
    'export function corsHeaders',
    'export function isAllowedBrowserUrl',
  ], 'shared CORS helper');
  ok(!sharedCors.includes('"Access-Control-Allow-Origin": "*"'), 'shared helper must not use wildcard CORS');
});

group('proxy functions');

test('ESPN and MFL proxy functions use the shared CORS helper', () => {
  [espn, mfl].forEach((source, idx) => {
    const label = idx === 0 ? 'espn-proxy' : 'mfl-proxy';
    hasEvery(source, [
      'import { corsHeaders } from "../_shared/cors.ts";',
      'const responseHeaders = corsHeaders(req);',
      'headers: responseHeaders',
    ], label);
    ok(!source.includes('"Access-Control-Allow-Origin": "*"'), `${label} must not use wildcard CORS`);
    ok(!source.includes('...corsHeaders'), `${label} must not spread stale static CORS headers`);
  });
});

test('ESPN and MFL proxy functions enforce durable per-IP rate limits', () => {
  [espn, mfl].forEach((source, idx) => {
    const label = idx === 0 ? 'espn-proxy' : 'mfl-proxy';
    hasEvery(source, [
      'import { checkRateLimit, clientIp, rateLimitResponse } from "../_shared/rate-limit.ts";',
      'const RATE_LIMIT_MAX = 60;',
      'await checkRateLimit(',
      'rateLimitResponse(limit, responseHeaders)',
    ], label);
    ok(!source.includes('new Map<string'), `${label} must not rely on an in-memory rate-limit Map`);
  });
});

test('MFL proxy validates exact host boundary', () => {
  hasEvery(mfl, [
    'function isValidMflUrl(url: string): boolean',
    'parsed.protocol === "https:"',
    'parsed.hostname === "myfantasyleague.com"',
    'parsed.hostname.endsWith(".myfantasyleague.com")',
  ], 'mfl host validation');
  ok(!mfl.includes('endsWith("myfantasyleague.com")'), 'MFL host validation must not allow evilmyfantasyleague.com');
});

test('Yahoo proxy uses shared CORS and validates OAuth return URLs', () => {
  hasEvery(yahoo, [
    'import { corsHeaders, isAllowedBrowserUrl } from "../_shared/cors.ts";',
    'const responseHeaders = corsHeaders(req);',
    'return_url is not allowed',
    '!isAllowedBrowserUrl(returnUrl)',
  ], 'yahoo-proxy');
  ok(!yahoo.includes('"Access-Control-Allow-Origin": "*"'), 'yahoo-proxy must not use wildcard CORS');
  ok(!yahoo.includes('...corsHeaders'), 'yahoo-proxy must not spread stale static CORS headers');
});

test('Yahoo proxy binds stored sessions to the authenticated app or Sleeper owner', () => {
  hasEvery(yahoo, [
    'import { jwtVerify } from "https://esm.sh/jose@5";',
    'async function requesterKey(req: Request): Promise<string | null>',
    'const ownerKey = await requesterKey(req);',
    'Valid session token required.',
    'owner_key:',
    '.eq("owner_key", ownerKey)',
    'await getTokenRecord(session_id, ownerKey)',
    'await refreshAccessToken(session_id, ownerKey)',
    'JSON.stringify({ success: true })',
  ], 'yahoo owner-bound proxy');
});

group('durable rate limiting');

test('shared rate-limit helper is Postgres-backed with an in-memory fallback', () => {
  hasEvery(rateLimitHelper, [
    'SUPABASE_SERVICE_ROLE_KEY',
    '.rpc("check_rate_limit"',
    'function fallbackCheck',
    'export async function checkRateLimit',
    'export function rateLimitResponse',
    'export function clientIp',
  ], 'rate-limit helper');
});

test('rate-limit migration defines a durable atomic counter', () => {
  hasEvery(rateLimitMigration, [
    'create table if not exists public.rate_limit_counters',
    'create or replace function public.check_rate_limit',
    "set search_path = ''",
    'on conflict (bucket_key, window_start)',
    'enable row level security',
    'grant execute on function public.check_rate_limit',
  ], 'rate-limit migration');
});

test('Yahoo proxy rate-limits the API proxy action per owner', () => {
  hasEvery(yahoo, [
    'import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";',
    'await checkRateLimit(`yahoo-proxy:${ownerKey}`',
    'rateLimitResponse(rl, responseHeaders)',
  ], 'yahoo-proxy rate limit');
});

console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}
const status = failed > 0 ? 'FAIL' : 'PASS';
console.log(`${status} ${passed + failed} tests - ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
