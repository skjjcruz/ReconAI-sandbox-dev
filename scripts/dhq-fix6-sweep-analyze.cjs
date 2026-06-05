#!/usr/bin/env node
// Compares baseline vs several FIX-#6 settings: how many players move, how
// "FC-clone" it gets, and — the thing Jacob cares about — ranking-order outliers.
'use strict';
const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
function readCsv(f) {
  const p = path.join(ROOT, f); if (!fs.existsSync(p)) return null;
  const lines = fs.readFileSync(p, 'utf8').trim().split('\n'); const head = lines[0].split(',');
  return lines.slice(1).map(l => { const c = l.match(/("([^"]|"")*"|[^,]*)/g).filter((_, i) => i % 2 === 0); const o = {}; head.forEach((h, i) => o[h] = (c[i] || '').replace(/^"|"$/g, '')); return o; });
}
const base = readCsv('reports/whatif-base.csv');
const baseMap = new Map(base.map(r => [r.pid, r]));
// FC players only, for ranking-order analysis
function analyze(label, file) {
  const rows = readCsv(file); if (!rows) return null;
  const map = new Map(rows.map(r => [r.pid, r]));
  let moved = 0, down = 0;
  for (const [pid, b] of baseMap) { const a = map.get(pid); if (a && +a.dhq !== +b.dhq) { moved++; if (+a.dhq < +b.dhq) down++; } }
  const fc = rows.filter(r => +r.fc_value > 0).map(r => ({ pid: r.pid, name: r.name, pos: r.pos, dhq: +r.dhq, fc: +r.fc_value, dev: +r.dev_vs_fc_pct }));
  // rank-order outliers: DHQ rank vs FC rank among FC players
  const dhqRank = new Map(fc.slice().sort((a, b) => b.dhq - a.dhq).map((r, i) => [r.pid, i + 1]));
  const fcRank = new Map(fc.slice().sort((a, b) => b.fc - a.fc).map((r, i) => [r.pid, i + 1]));
  let n = fc.length, d2 = 0; fc.forEach(r => { const d = dhqRank.get(r.pid) - fcRank.get(r.pid); d2 += d * d; });
  const rho = +(1 - 6 * d2 / (n * (n * n - 1))).toFixed(3);
  const gaps = fc.map(r => ({ ...r, rankGap: dhqRank.get(r.pid) - fcRank.get(r.pid) }));
  const bigRankOutliers = gaps.filter(r => Math.abs(r.rankGap) > 25);
  const worstRank = gaps.slice().sort((a, b) => Math.abs(b.rankGap) - Math.abs(a.rankGap)).slice(0, 3);
  const extremeVal = fc.filter(r => Math.abs(r.dev) > 75);
  const worstOver = fc.slice().sort((a, b) => b.dev - a.dev)[0];
  const worstUnder = fc.slice().sort((a, b) => a.dev - b.dev)[0];
  return { label, moved, down, up: moved - down, rho, bigRankOutliers: bigRankOutliers.length,
    worstRank: worstRank.map(r => `${r.name}(${r.rankGap > 0 ? '+' : ''}${r.rankGap})`).join(', '),
    extremeVal: extremeVal.length, worstOver: `${worstOver.name} +${worstOver.dev}%`, worstUnder: `${worstUnder.name} ${worstUnder.dev}%`, map };
}
const settings = [
  ['BASELINE (no #6)', 'reports/whatif-base.csv'],
  ['outlier-only .40/.60/1.5', 'reports/whatif-fix6-outlier.csv'],
  ['surgical .45/.50/1.2', 'reports/whatif-fix6-surgical.csv'],
  ['moderate .50/.40/1.0', 'reports/whatif-fix6-moderate.csv'],
  ['ORIGINAL .65/.18/.50', 'reports/whatif-fix6.csv'],
];
const res = settings.map(([l, f]) => analyze(l, f)).filter(Boolean);
console.log('\n══ FIX #6 SETTING SWEEP — ranking-order sanity vs how much DHQ defers ══');
console.log('setting                      moved  down   rho   rankOutliers(|gap|>25)   extremeVal(|dev|>75%)');
res.forEach(r => console.log(`  ${r.label.padEnd(27)} ${String(r.moved).padStart(4)}  ${String(r.down).padStart(4)}  ${String(r.rho).padStart(5)}   ${String(r.bigRankOutliers).padStart(6)}                 ${String(r.extremeVal).padStart(5)}`));
console.log('\nworst remaining outliers per setting:');
res.forEach(r => console.log(`  ${r.label.padEnd(27)} over: ${r.worstOver.padEnd(28)} under: ${r.worstUnder.padEnd(24)} rankGap: ${r.worstRank}`));

// key players across settings — do DHQ's moderate opinions survive?
const KEY = ['De\'Von Achane', 'Kyren Williams', 'Jonathan Taylor', 'Malik Nabers', 'Brock Bowers', 'Matthew Stafford', 'Anthony Richardson', 'Jared Goff', 'Jalen Hurts'];
console.log('\nkey players — DHQ value across settings (baseline → outlier → surgical → moderate → original):');
const byName = {}; res.forEach(r => { for (const [, b] of baseMap) { } });
KEY.forEach(name => {
  const pid = base.find(r => r.name === name)?.pid; if (!pid) return;
  const vals = res.map(r => r.map.get(pid)?.dhq || '—');
  console.log(`  ${name.padEnd(20)} ${vals.map(v => String(v).padStart(5)).join('  ')}`);
});
