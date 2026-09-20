'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadAiEdgeSource } = require('./helpers/ai-edge-source.cjs');

const reviewed = loadAiEdgeSource();
assert.equal(reviewed.repository, 'skjjcruz/github.com-skjjcruz-owner-dashboard-dev');
assert.match(reviewed.source, /const AI_ROUTES/);
console.log('PASS exact reviewed owning AI source is available');
const oldRoot = process.env.AI_EDGE_ROOT;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-ai-source-'));
try {
  process.env.AI_EDGE_ROOT = temporary;
  assert.throws(loadAiEdgeSource, /missing or differs/);
  console.log('PASS explicit missing source cannot silently skip or use another checkout');
  const file = path.join(temporary, reviewed.path);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, reviewed.source + '\n// unreviewed change\n');
  assert.throws(loadAiEdgeSource, /missing or differs/);
  console.log('PASS changed owning source requires a new review');
} finally {
  if (oldRoot === undefined) delete process.env.AI_EDGE_ROOT;
  else process.env.AI_EDGE_ROOT = oldRoot;
  fs.rmSync(temporary, { recursive: true, force: true });
}
