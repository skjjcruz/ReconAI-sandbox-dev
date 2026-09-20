'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const manifest = require('../fixtures/ai-edge-source.json');

// Full-suite AI checks must inspect the reviewed owning backend. An unrelated
// sibling named warroom is not evidence for this Scout/backend pair.
function loadAiEdgeSource() {
  const explicit = process.env.AI_EDGE_ROOT || process.env.WARROOM_ROOT;
  const roots = explicit ? [explicit] : [
    path.resolve(__dirname, '../../../github.com-skjjcruz-owner-dashboard-dev'),
    path.resolve(__dirname, '../../../warroom'),
  ];
  for (const root of roots) {
    const file = path.join(root, manifest.path);
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    const hash = crypto.createHash('sha256').update(source).digest('hex');
    if (hash === manifest.sha256) return { source, file, ...manifest };
  }
  throw new Error('AI backend source is missing or differs from the reviewed owner. Set AI_EDGE_ROOT to ' +
    manifest.repository + ' at ' + manifest.revision + '. Review the source pin when the owning AI implementation changes.');
}
module.exports = { loadAiEdgeSource };
