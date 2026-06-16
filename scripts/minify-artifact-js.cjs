#!/usr/bin/env node
// minify-artifact-js.cjs — Minify (in place) the plain-JS files that ship RAW in
// the Pages artifact: shared/*.js and js/pro-launch.js. These paths exist for the
// War Room deploy on the same github.io host, which loads them as classic scripts
// at app boot — ~1MB of unminified JS on its critical path. The ReconAI app
// itself never fetches these copies (Vite bundles shared/ into hashed chunks).
//
// Top-level names are NOT mangled (terser default): the files are classic
// scripts whose contract is implicit globals / window.* attachment.
//
// Usage: node scripts/minify-artifact-js.cjs <dir-or-file> [...more]

const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

function collect(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return target.endsWith('.js') ? [target] : [];
  return fs.readdirSync(target)
    .map(name => path.join(target, name))
    .flatMap(collect);
}

async function run() {
  const targets = process.argv.slice(2);
  if (!targets.length) {
    console.error('usage: minify-artifact-js.cjs <dir-or-file> [...more]');
    process.exit(1);
  }
  const files = targets.flatMap(collect);
  let rawBytes = 0;
  let outBytes = 0;
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const result = await minify(raw, { compress: true, mangle: true, sourceMap: false });
    if (!result || typeof result.code !== 'string' || !result.code.length) {
      throw new Error(`terser produced no output for ${file}`);
    }
    fs.writeFileSync(file, result.code + '\n', 'utf8');
    rawBytes += Buffer.byteLength(raw);
    outBytes += Buffer.byteLength(result.code);
  }
  const pct = rawBytes ? Math.round((1 - outBytes / rawBytes) * 100) : 0;
  console.log(`[minify-artifact-js] ${files.length} files: ${(rawBytes / 1024).toFixed(0)}KB -> ${(outBytes / 1024).toFixed(0)}KB (-${pct}%)`);
}

run().catch(err => {
  console.error('[minify-artifact-js] failed:', err && err.message ? err.message : err);
  process.exit(1);
});
