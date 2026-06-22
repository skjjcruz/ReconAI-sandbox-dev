// ESLint flat config for ReconAI — browser extension (script-tag globals, no ES modules)
//
// GLOBALS PHILOSOPHY:
//   List every name that is used across multiple files. In a script-tag app,
//   all JS files share one page scope, so a function declared in shared/utils.js
//   is legitimately available in js/ui.js. ESLint doesn't know this unless we
//   tell it via globals.
//
//   `no-redeclare: [error, { builtinGlobals: false }]` lets files re-declare
//   globals with var/function (intentional pattern for browser globals) while
//   still catching real double-declarations within the same file.
//
// REAL BUGS FOUND BY ESLINT (not auto-fixed — needs manual review):
//   shared/espn-api.js:36         — duplicate object key '16'  (no-dupe-keys)
//   shared/mfl-api.js:153         — `year` used but never declared in mapMFLPlayer()
//   js/player-modal.js:127        — `team` used but never declared
//   shared/supabase-client.js:504 — `hashPassword` called but never defined
//   js/app.js (multiple)          — getLeagueRegistry / saveLeagueToRegistry /
//                                   updateRegistryKPIs / renderLeagueHub each
//                                   declared TWICE in the same file (no-redeclare)

// Third-party libraries loaded via <script> tags
const cdnLibs = {
  React: "readonly",
  ReactDOM: "readonly",
  marked: "readonly",
  Chart: "readonly",
  Babel: "readonly",
  htmx: "readonly",
};

const SCRIPT_GLOBAL_VAR_PATTERN = [
  "^_",
  "^[A-Z][A-Za-z0-9]*$",
  "^use(State|Effect|Memo|Ref|Callback)$",
  "^(showToast|switchTab|buildCtx|loadMemory|callClaude|escHtml|getPosBadgeStyle|getDcLabel|getPlayerAction|getPlayerRank|calcIDPScore|calcFantasyPts|calcRawPts|getIndustryPickValue|getFAAB|getRosterSlots|getAvailablePlayers|assessTeamFromGlobal|buildNflStarterSetFromGlobal|buildPicksByOwner|normPos|render.*|load.*|save.*|update.*|closePlayerModal|goAsk|addDraftMsg|sendHomeChat|callGrokNews|startStrategyWalkthrough|runMemoryCapture|fillGlobalChat|tryInjectTradeCard|openTradeBuilderForPlayer|getMemory|setMemory|autoSaveMemory|buildMemoryCtx|toggleJewels)$",
].join("|");

const LEGACY_UNUSED_VAR_NAMES = [
  "IDP_MAPPED", "MEMORY_TYPES", "MFL_ROSTER_STATUS", "PICK_IDEAL",
  "$", "acceptColor", "age", "avgVal", "bestFit", "confCls", "confIcon", "config", "currentPlayers",
  "dna", "earlyBuys", "gaps", "getUser", "grade", "gradeColor", "gradeLetter", "gridCard",
  "gridRookies", "heroCard", "histSpend", "key", "lateSells", "leagueAvg", "leagueFaab", "mode",
  "myBid", "myPids", "myRoster", "mySet", "mySlot", "needsStr", "originalRank", "pa", "peak",
  "peakStart", "peakYrs", "posMap", "posOrder", "posSurplus", "posture", "proj", "recentTrades",
  "rp", "sc", "season", "sorted", "spendCtx", "starters", "teams", "theirAssessNow", "theirSlot",
  "tier", "totalTimedTrades", "tradeHistory",
];
const LEGACY_UNUSED_VAR_PATTERN = "^(" + LEGACY_UNUSED_VAR_NAMES
  .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|") + ")$";

// Project globals: names used in multiple files.
// Declared somewhere in the project's own .js files but consumed across files.
// builtinGlobals:false on no-redeclare allows the declaring file to also use
// var/function for these without triggering a false-positive.
const projectGlobals = {
  // Platform / provider namespaces (set on window.*)
  App: "readonly",
  OD: "readonly",
  Sleeper: "readonly",
  ESPN: "readonly",
  Yahoo: "readonly",
  MFL: "readonly",
  FWCache: "readonly",

  // Short-hand helpers / namespace aliases assigned early in app lifecycle
  S: "writable",
  LI: "writable",
  $: "readonly",
  DhqEvents: "writable",
  DhqStorage: "writable",

  // Top-level utility functions
  showToast: "readonly",
  switchTab: "readonly",
  buildCtx: "readonly",
  loadMemory: "readonly",
  callClaude: "readonly",
  escHtml: "readonly",
  getPosBadgeStyle: "readonly",
  getDcLabel: "readonly",
  getPlayerAction: "readonly",
  getPlayerRank: "readonly",
  calcIDPScore: "readonly",
  calcFantasyPts: "readonly",
  calcRawPts: "readonly",
  getIndustryPickValue: "readonly",
  getFAAB: "readonly",
  getRosterSlots: "readonly",
  getAvailablePlayers: "readonly",
  assessTeamFromGlobal: "readonly",
  buildNflStarterSetFromGlobal: "readonly",
  buildPicksByOwner: "readonly",
  normPos: "readonly",

  // Constants objects (shared/constants.js)
  STORAGE_KEYS: "readonly",
  FEATURES: "readonly",
  DEPTH_POSITIONS: "readonly",
  DHQ_IDENTITY: "readonly",

  // Runtime flags / state
  DEV_MODE: "writable",
  LI_LOADED: "writable",

  // DHQ AI module (shared/dhq-engine.js + shared/dhq-providers.js)
  dhqAI: "readonly",
  dhqLog: "readonly",
  dhqContext: "readonly",
  dhqCompactContext: "readonly",
  dhqBuildMentalityContext: "readonly",
  dhqBuildOwnerProfiles: "readonly",

  // Tier / auth / subscription (shared/tier.js + shared/supabase-client.js)
  getTier: "readonly",
  getUser: "readonly",
  canAccess: "readonly",
  hasAnyAI: "readonly",
  hasServerAI: "readonly",
  getDailyChatRemaining: "readonly",
  incrementDailyChat: "readonly",
  loadUserTier: "readonly",
  trackUsage: "readonly",
  showUpgradePrompt: "readonly",

  // Data loading functions
  loadMentality: "readonly",
  loadStrategy: "readonly",
  loadLeague: "readonly",
  loadRosterStats: "readonly",
  loadLeagueIntel: "readonly",
  loadAllData: "readonly",
  fetchTrending: "readonly",

  // Render / UI build functions
  renderFieldLogCard: "readonly",
  renderFieldLogPanel: "readonly",
  renderDraftNeeds: "readonly",
  onDraftTabOpen: "readonly",
  renderMobileHome: "readonly",
  renderHomeSnapshot: "readonly",
  renderTradeIntel: "readonly",
  initTradeCalc: "readonly",
  renderRoster: "readonly",
  renderWaivers: "readonly",
  renderTrades: "readonly",
  renderPicks: "readonly",
  renderAvailable: "readonly",
  renderInsightCards: "readonly",
  renderTeamOverview: "readonly",
  renderHealthTimeline: "readonly",
  renderLeaguePulse: "readonly",
  renderDailyBriefing: "readonly",
  renderStartSit: "readonly",
  renderScoutBriefing: "readonly",
  renderTeamBar: "readonly",
  renderTrialBanner: "readonly",
  buildRosterTable: "readonly",

  // UI update / status functions
  updateSettingsStatus: "readonly",
  updateTrialSettingsSection: "readonly",
  updateSyncStatus: "readonly",
  updateDataFreshness: "readonly",
  updateProviderHint: "readonly",
  checkApiKeyCallout: "readonly",
  renderLeagueHub: "readonly",
  getLeagueRegistry: "readonly",
  saveLeagueToRegistry: "readonly",
  updateRegistryKPIs: "readonly",

  // UI interaction functions
  closePlayerModal: "readonly",
  goAsk: "readonly",
  addDraftMsg: "readonly",
  sendHomeChat: "readonly",
  callGrokNews: "readonly",
  startStrategyWalkthrough: "readonly",
  runMemoryCapture: "readonly",
  _updateChatPlaceholder: "readonly",
  _tierGatePlaceholder: "readonly",
  fillGlobalChat: "readonly",
  tryInjectTradeCard: "readonly",
  openTradeBuilderForPlayer: "readonly",

  // Memory API (shared/league-memory.js or similar)
  getMemory: "readonly",
  setMemory: "readonly",
  saveMemory: "readonly",
  autoSaveMemory: "readonly",
  loadConvMemory: "readonly",
  saveConvMemory: "readonly",
  addConvMemory: "readonly",
  buildMemoryCtx: "readonly",

  // Chat history state arrays (set at top level in app.js, used in other files)
  homeChatHistory: "writable",
  tradeChatHistory: "writable",
  draftChatHistory: "writable",
  mobileTab: "writable",

  // Per-player context variables (set at call sites before invoking render fns)
  pName: "writable",
  pNameShort: "writable",
  pPos: "writable",
  pAge: "writable",
  pM: "writable",
  pTeam: "writable",
  fullTeam: "writable",
  myR: "writable",
  dynastyValue: "writable",
  idpTier: "writable",
  posClass: "writable",
  pickValue: "writable",
  tradeValueTier: "writable",
  peakYears: "writable",

  // Internal state globals
  _newsCache: "writable",
  _reconVerdict: "writable",
  _strategyContextLine: "writable",

  // Node.js dual-use pattern in pick-value-model.js (exports for both browser + Node tests)
  module: "readonly",
};

// Browser built-ins — comprehensive list for a browser extension / web app
const browserGlobals = {
  window: "readonly",
  document: "readonly",
  navigator: "readonly",
  location: "readonly",
  history: "readonly",
  localStorage: "readonly",
  sessionStorage: "readonly",
  console: "readonly",
  fetch: "readonly",
  alert: "readonly",
  confirm: "readonly",
  prompt: "readonly",
  setTimeout: "readonly",
  setInterval: "readonly",
  clearTimeout: "readonly",
  clearInterval: "readonly",
  requestAnimationFrame: "readonly",
  cancelAnimationFrame: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  FormData: "readonly",
  Blob: "readonly",
  File: "readonly",
  FileReader: "readonly",
  XMLHttpRequest: "readonly",
  WebSocket: "readonly",
  Worker: "readonly",
  Promise: "readonly",
  Map: "readonly",
  Set: "readonly",
  WeakMap: "readonly",
  WeakSet: "readonly",
  Symbol: "readonly",
  Proxy: "readonly",
  Reflect: "readonly",
  JSON: "readonly",
  Math: "readonly",
  Date: "readonly",
  Error: "readonly",
  TypeError: "readonly",
  RangeError: "readonly",
  SyntaxError: "readonly",
  ReferenceError: "readonly",
  RegExp: "readonly",
  Array: "readonly",
  Object: "readonly",
  String: "readonly",
  Number: "readonly",
  Boolean: "readonly",
  BigInt: "readonly",
  NaN: "readonly",
  Infinity: "readonly",
  undefined: "readonly",
  isNaN: "readonly",
  isFinite: "readonly",
  parseInt: "readonly",
  parseFloat: "readonly",
  encodeURIComponent: "readonly",
  decodeURIComponent: "readonly",
  encodeURI: "readonly",
  decodeURI: "readonly",
  atob: "readonly",
  btoa: "readonly",
  structuredClone: "readonly",
  queueMicrotask: "readonly",
  crypto: "readonly",
  performance: "readonly",
  MutationObserver: "readonly",
  IntersectionObserver: "readonly",
  ResizeObserver: "readonly",
  CustomEvent: "readonly",
  Event: "readonly",
  EventTarget: "readonly",
  AbortController: "readonly",
  AbortSignal: "readonly",
  Headers: "readonly",
  Request: "readonly",
  Response: "readonly",
  ReadableStream: "readonly",
  TextEncoder: "readonly",
  TextDecoder: "readonly",
  HTMLElement: "readonly",
  Element: "readonly",
  Node: "readonly",
  NodeList: "readonly",
  DocumentFragment: "readonly",
  ShadowRoot: "readonly",
  Range: "readonly",
  Selection: "readonly",
  DOMParser: "readonly",
  DOMRect: "readonly",
  DOMRectReadOnly: "readonly",
  CSSStyleDeclaration: "readonly",
  MediaQueryList: "readonly",
  Image: "readonly",
  Audio: "readonly",
  Video: "readonly",
  Canvas: "readonly",
  CanvasRenderingContext2D: "readonly",
  WebGLRenderingContext: "readonly",
  indexedDB: "readonly",
  IDBDatabase: "readonly",
  IDBTransaction: "readonly",
  IDBObjectStore: "readonly",
  Notification: "readonly",
  ServiceWorker: "readonly",
  ServiceWorkerRegistration: "readonly",
  caches: "readonly",
  Cache: "readonly",
  CacheStorage: "readonly",
};

// Service worker globals (for sw.js only)
const serviceWorkerGlobals = {
  self: "readonly",
  clients: "readonly",
  skipWaiting: "readonly",
  importScripts: "readonly",
  ExtendableEvent: "readonly",
  FetchEvent: "readonly",
  InstallEvent: "readonly",
  ActivateEvent: "readonly",
};

export default [
  // Files to completely ignore
  {
    ignores: [
      "node_modules/**",
      ".claude/**",
      "tests/**",
      "supabase/**",
      "**/*.min.js",
      "reports/**",
      // Canonical engine checkout used only as a sync source in CI/deploy
      // (actions/checkout into dhq-shared-src/). Not app source — don't lint it.
      "dhq-shared-src/**",
      "dhq-shared/**",
      // dhq-ai.js contains a raw knowledge-base text block after valid JS;
      // ESLint cannot parse it. Exclude until the file is refactored.
      "shared/dhq-ai.js",
      // Vite config uses ESM import syntax; not a browser script
      "vite.config.js",
      "main.js",
      // Build output — not source
      "dist/**",
    ],
  },

  // Main config for all JS files
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2021,
      // script mode required for browser extensions using script-tag globals
      sourceType: "script",
      globals: {
        ...browserGlobals,
        ...cdnLibs,
        ...projectGlobals,
      },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none", varsIgnorePattern: [SCRIPT_GLOBAL_VAR_PATTERN, LEGACY_UNUSED_VAR_PATTERN].join("|") }],
      // builtinGlobals:false prevents false-positives when a file uses
      // var/function to declare something that's also listed in globals above
      // (intentional cross-file global pattern). Real same-file redeclarations
      // are still caught.
      "no-redeclare": ["error", { builtinGlobals: false }],
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      eqeqeq: ["warn", "always", { null: "ignore" }],
      "no-constant-condition": "warn",
    },
  },

  // Service worker override — add self + SW-specific globals
  {
    files: ["sw.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "script",
      globals: {
        ...browserGlobals,
        ...serviceWorkerGlobals,
        ...cdnLibs,
        ...projectGlobals,
      },
    },
  },
];
