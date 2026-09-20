'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');
// Execute the actual TypeScript bodies. All network/database imports must be
// supplied explicitly by fixtures; no hosted calls or service credentials.
module.exports = function load(file, globals = {}) {
  const source = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true } }).outputText
    .replace(/^import .*?;\s*$/gm, '').replace(/^export (?=(?:async )?function|const|class)/gm, '');
  let handler;
  const context = { console, Request, Response, Headers, URL, URLSearchParams,
    TextEncoder, TextDecoder, Uint8Array, AbortSignal, setTimeout, clearTimeout,
    atob, btoa, crypto: webcrypto,
    Deno: { env: { get: () => 'fixture-config' } }, serve: fn => { handler = fn; }, ...globals };
  vm.createContext(context); vm.runInContext(code, context, { filename: file });
  return { context, handler };
};
