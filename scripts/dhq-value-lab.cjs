#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const DEFAULT_OUT = path.join(REPO, 'reports/dhq-value-lab-output.csv');

function parseArgs(argv) {
  const args = {
    teams: 16,
    numQbs: 2,
    ppr: 0.5,
    season: 2025,
    years: 2,
    mode: 'dynasty',
    draftRounds: 4,
    roster: 'QB,RB,RB,WR,WR,TE,FLEX,SUPER_FLEX,K',
    scoring: null,
    scoringFile: null,
    dataFile: null,
    out: DEFAULT_OUT,
  };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === '--teams') args.teams = Number(next), i++;
    else if (key === '--num-qbs') args.numQbs = Number(next), i++;
    else if (key === '--ppr') args.ppr = Number(next), i++;
    else if (key === '--season') args.season = Number(next), i++;
    else if (key === '--years') args.years = Number(next), i++;
    else if (key === '--mode') args.mode = String(next), i++;
    else if (key === '--draft-rounds') args.draftRounds = Number(next), i++;
    else if (key === '--roster') args.roster = String(next), i++;
    else if (key === '--scoring') args.scoring = JSON.parse(next), i++;
    else if (key === '--scoring-file') args.scoringFile = path.resolve(next), i++;
    else if (key === '--data-file') args.dataFile = path.resolve(next), i++;
    else if (key === '--out') args.out = path.resolve(next), i++;
  }
  if (args.scoringFile) args.scoring = JSON.parse(fs.readFileSync(args.scoringFile, 'utf8'));
  args.rosterPositions = args.roster.split(',').map(s => s.trim()).filter(Boolean);
  return args;
}

function loadCommonJsBrowserFile(file, ...more) {
  const sandbox = {
    module: { exports: {} },
    exports: {},
    globalThis: {},
    window: { App: {} },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of [file, ...more]) vm.runInContext(fs.readFileSync(f, 'utf8'), sandbox, { filename: f });
  return sandbox.module.exports && Object.keys(sandbox.module.exports).length
    ? sandbox.module.exports
    : sandbox.window.App.DhqCore;
}

function csvCell(value) {
  if (value == null) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(file, rows) {
  const preferred = [
    'sleeper_id', 'asset_type', 'name', 'position', 'nfl_team', 'age', 'gp',
    'season_total', 'ppg', 'fc_value', 'fc_rank', 'fc_pos_rank', 'fc_trend_30d',
    'mode', 'league_size', 'roster_slots', 'starter_demand', 'league_starter_pool',
    'replacement_ppg', 'replacement_edge_ppg', 'lineup_value_ppg', 'lineup_total_ppg',
    'player_lineup_point_share', 'position_lineup_point_share', 'position_lineup_marginal_share',
    'position_lineup_slot_share', 'position_context', 'age_curve_phase', 'age_factor',
    'market_weight', 'market_compatibility_score', 'market_compatibility_reasons',
    'ppg_value', 'dhq_now', 'dhq_year_1', 'dhq_year_2',
    'overall_rank', 'position_rank',
  ];
  const extras = Array.from(new Set(rows.flatMap(row => Object.keys(row)))).filter(k => !preferred.includes(k));
  const headers = preferred.filter(k => rows.some(row => row[k] !== undefined)).concat(extras);
  const body = [headers.join(','), ...rows.map(row => headers.map(h => csvCell(row[h])).join(','))].join('\n');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body + '\n');
}

function parsePickName(name) {
  const match = String(name || '').match(/^(\d{4}) Pick (\d+)\.(\d{2})$/);
  if (!match) return null;
  return { season: Number(match[1]), round: Number(match[2]), slot: Number(match[3]) };
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

function normalizePickModel(fn) {
  return function pickValue(pickNumber, teams, rounds) {
    return fn(pickNumber, teams, rounds);
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const core = loadCommonJsBrowserFile(path.join(REPO, 'shared/dhq-core.js'), path.join(REPO, 'shared/dhq-core-values.js'));
  const pickModel = loadCommonJsBrowserFile(path.join(REPO, 'shared/pick-value-model.js'));
  const isDynasty = args.mode !== 'redraft';
  let fcUrl = `https://api.fantasycalc.com/values/current?isDynasty=${isDynasty ? 'true' : 'false'}&numQbs=${args.numQbs}&numTeams=${args.teams}&ppr=${args.ppr}`;
  let fcData, players, stats;
  if (args.dataFile) {
    const data = JSON.parse(fs.readFileSync(args.dataFile, 'utf8'));
    fcUrl = `local:${path.relative(REPO, args.dataFile)}`;
    fcData = data.marketRows || [];
    players = data.players || {};
    stats = data.stats || {};
  } else {
    [fcData, players, stats] = await Promise.all([
      getJson(fcUrl),
      getJson('https://api.sleeper.app/v1/players/nfl'),
      getJson(`https://api.sleeper.app/v1/stats/nfl/regular/${args.season}`),
    ]);
  }

  const fcPickValues = new Map();
  fcData.forEach(row => {
    if (row.player?.position === 'PICK') {
      const pick = parsePickName(row.player.name);
      if (pick) fcPickValues.set(`${pick.season}:${pick.round}:${pick.slot}`, row.value || 0);
    }
  });

  const basePickYear = new Date().getFullYear();
  const result = core.calculateValues({
    config: {
      mode: args.mode,
      teams: args.teams,
      ppr: args.ppr,
      season: args.season,
      projectionYears: args.years,
      draftRounds: args.draftRounds,
      rosterPositions: args.rosterPositions,
      scoring: args.scoring || {},
      basePickYear,
    },
    players,
    stats,
    marketRows: fcData,
    pickValueFn: normalizePickModel(pickModel.getIndustryPickValue || core.defaultPickValue),
  });

  if (isDynasty) {
    result.pickRows.forEach(row => {
      const pick = parsePickName(row.name);
      if (!pick) return;
      const fcValue = fcPickValues.get(`${pick.season}:${pick.round}:${pick.slot}`);
      if (fcValue && pick.season === basePickYear) {
        row.fc_value = fcValue;
        row.dhq_now = Math.round((Number(row.dhq_now) || 0) * 0.30 + fcValue * 0.70);
      }
    });
    result.rows = [...result.playerRows, ...result.pickRows];
  }

  writeCsv(args.out, result.rows);
  fs.writeFileSync(args.out.replace(/\.csv$/i, '.json'), JSON.stringify({
    fantasyCalcUrl: fcUrl,
    ...result,
  }, null, 2));

  const topPlayers = result.playerRows.slice(0, 12).map(r => `${r.name} ${r.position} ${r.dhq_now}`).join(', ');
  console.log(`Wrote ${path.relative(process.cwd(), args.out)}`);
  console.log(`Wrote ${path.relative(process.cwd(), args.out.replace(/\.csv$/i, '.json'))}`);
  console.log(`Top 12 assets: ${topPlayers}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
