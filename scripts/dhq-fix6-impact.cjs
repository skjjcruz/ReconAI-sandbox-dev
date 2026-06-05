#!/usr/bin/env node
// Scopes FIX #6 (deviation-aware FC-blend escalation) impact: joins the
// baseline vs #6 per-player CSVs and breaks down who moves and by how much.
'use strict';
const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
function readCsv(f) {
  const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').trim().split('\n');
  const head = lines[0].split(',');
  return lines.slice(1).map(l => {
    // simple split (names have no commas in this dataset; quoted fallback)
    const parts = l.match(/("([^"]|"")*"|[^,]*)/g).filter((_, i) => i % 2 === 0);
    const o = {}; head.forEach((h, i) => o[h] = (parts[i] || '').replace(/^"|"$/g, '')); return o;
  });
}
const base = new Map(readCsv('reports/whatif-base.csv').map(r => [r.pid, r]));
const fix6 = new Map(readCsv('reports/whatif-fix6.csv').map(r => [r.pid, r]));
const rows = [];
for (const [pid, b] of base) {
  const a = fix6.get(pid); if (!a) continue;
  const db = +b.dhq, da = +a.dhq;
  rows.push({ pid, name: b.name, pos: b.pos, age: b.age, fc: +b.fc_value || 0,
    base: db, after: da, delta: da - db, pct: db ? +(100 * (da - db) / db).toFixed(1) : 0,
    devBase: b.dev_vs_fc_pct, devAfter: a.dev_vs_fc_pct });
}
const changed = rows.filter(r => r.delta !== 0);
const ups = changed.filter(r => r.delta > 0), downs = changed.filter(r => r.delta < 0);
const sum = (arr, f) => arr.reduce((s, r) => s + f(r), 0);

console.log(`\n══ FIX #6 IMPACT — ${rows.length} scored players (${rows.filter(r=>r.fc>0).length} have FC) ══`);
console.log(`Changed: ${changed.length}  (up ${ups.length}, down ${downs.length}, unchanged ${rows.length - changed.length})`);
console.log(`Only veterans with an FC value AND |DHQ-FC| deviation > ~0.18 move; rookies & FC-less players are untouched.`);
console.log(`Mean |Δ| among changed: ${Math.round(sum(changed, r => Math.abs(r.delta)) / Math.max(1, changed.length))} DHQ pts`);

console.log('\n── magnitude distribution (|Δ|) ──');
[[1, 100], [100, 300], [300, 600], [600, 1e9]].forEach(([lo, hi]) => {
  const n = changed.filter(r => Math.abs(r.delta) >= lo && Math.abs(r.delta) < hi).length;
  console.log(`  ${lo}-${hi === 1e9 ? '∞' : hi}: ${n}`);
});

console.log('\n── by position (changed players) ──');
console.log('  pos  n   up  down  meanΔ  mean|Δ|');
['QB', 'RB', 'WR', 'TE', 'K', 'DL', 'LB', 'DB'].forEach(p => {
  const a = changed.filter(r => r.pos === p); if (!a.length) return;
  console.log(`  ${p.padEnd(3)} ${String(a.length).padStart(3)} ${String(a.filter(r=>r.delta>0).length).padStart(4)} ${String(a.filter(r=>r.delta<0).length).padStart(5)}  ${String(Math.round(sum(a,r=>r.delta)/a.length)).padStart(5)}  ${String(Math.round(sum(a,r=>Math.abs(r.delta))/a.length)).padStart(6)}`);
});

const fmt = r => `  ${(r.delta>0?'+':'')+r.delta}`.padEnd(7) + ` ${r.name.padEnd(22)} ${r.pos.padEnd(3)} ${r.base}→${r.after}  (${r.pct>0?'+':''}${r.pct}%)  FC ${r.fc}  | vsFC ${r.devBase}%→${r.devAfter}%`;
console.log('\n── TOP 20 RISERS (under-market players pulled UP toward FC) ──');
ups.slice().sort((a, b) => b.delta - a.delta).slice(0, 20).forEach(r => console.log(fmt(r)));
console.log('\n── TOP 20 FALLERS (over-market DHQ reads pulled DOWN toward FC) ──');
downs.slice().sort((a, b) => a.delta - b.delta).slice(0, 20).forEach(r => console.log(fmt(r)));

console.log('\n── scale check: top 12 by baseline DHQ ──');
rows.slice().sort((a, b) => b.base - a.base).slice(0, 12).forEach(r => console.log(`  ${r.name.padEnd(22)} ${r.pos.padEnd(3)} ${r.base}→${r.after}  (${r.pct>0?'+':''}${r.pct}%)`));

// direction sanity
const risersUnder = ups.filter(r => +r.devBase < 0).length;
const fallersOver = downs.filter(r => +r.devBase > 0).length;
console.log(`\n── direction sanity ──`);
console.log(`  risers that were BELOW market: ${risersUnder}/${ups.length}  | fallers that were ABOVE market: ${fallersOver}/${downs.length}`);

// combined CSV
const HEAD = ['pid', 'name', 'pos', 'age', 'fc_value', 'dhq_base', 'dhq_fix6', 'delta', 'pct', 'devBase_pct', 'devAfter_pct'];
const cell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const out = [HEAD.join(',')].concat(rows.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  .map(r => [r.pid, r.name, r.pos, r.age, r.fc, r.base, r.after, r.delta, r.pct, r.devBase, r.devAfter].map(cell).join(','))).join('\n');
fs.writeFileSync(path.join(ROOT, 'reports', 'fix6-impact.csv'), out);
console.log('\nCombined per-player CSV (sorted by |Δ|) → reports/fix6-impact.csv');
