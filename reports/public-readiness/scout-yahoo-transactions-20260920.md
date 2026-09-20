# Scout Yahoo transaction recovery

Branch: codex/readiness-scout-yahoo-transactions-20260920. Owning repository: skjjcruz/ReconAI-sandbox-dev. Base: reviewed provider/initiating-tab client 8d6cf54. Shared source used for validation: canonical proposal dc1e501 (`dhq-shared-readiness-yahoo-scout`, based on b104ce4). No auth/account/provider handler edits, hosted mutation, publication, final shared pin or release manifest changes.

## Issue, intended behavior and correction

The active Scout connection calls legacy `Yahoo.connectLeague`, whose original state publication discarded transactions. The Trades view then read only the current-week bucket even though a Yahoo trade has a documented timestamp but no confirmed NFL week. Trade Studio could instead use untagged LI history; History read that unrelated history exclusively and could default absent valuation inputs to A+ grades, zero values and winner counts.

Scout now consumes the shared completed-trade feed and exact availability metadata. All three actual caller functions (`renderTrades`, `_tcRenderRecentTrades`, `renderTradeHistory`) route Yahoo data through a small common consumer. Other platform branches are unchanged. Unknown-week trades remain discoverable. Ready, stale and unavailable are distinct; a confirmed empty response is the only zero-history state. Incomplete/pending/foreign metadata never appears as a ready trade. LI history is never substituted for Yahoo.

Retry is read-only and single-flight. It captures the original published Scout scope, account/provider identity, selected league and season. Results cannot overwrite a new account, provider connection, selected league, S object or even a same-account reconnect to the same league. Failure preserves labeled last-confirmed rows where available. Real second-tab storage changes remove the old rows and show Reload Scout; copied/unconfirmed state cannot borrow the current account's identity. Names and assets are escaped as text.

The history view preserves useful team activity filtering, pair counts and expandable received/sent player details. It explicitly reports missing historical values, winner records, trade grades and draft-pick detail. Those capabilities are not counted as completed or quietly replaced by zeros. This feed covers the returned confirmed completed player trades for the selected season, not all multi-season/add-drop/waiver intelligence. Broader Yahoo intelligence, historical coverage and valuation remain required follow-through outside this bounded feed repair.

## Verification and reproducibility

Use `READINESS_YAHOO_SHARED=/absolute/path/to/reviewed/shared` for the following commands; the test deliberately requires the exact source. `npm ci --ignore-scripts` installs the owning repo's pinned TypeScript parser used to extract the three unchanged-in-fixture production functions. No extra dependency or package lock change was needed.

- `node tests/scout-yahoo-transactions.cjs`: 11 actual module/caller groups pass. Exact 8d6cf54 caller source with the same new helper/provider fails 2 groups (9 pass); it still shows false empty/unrelated history. No test assertion was weakened.
- `PLAYWRIGHT_MODULE_PATH=/path/to/@playwright/test node tests/scout-yahoo-browser.cjs`: three real Chrome viewports pass, 320×740, 390×844, 844×390. Exercises actual canonical legacy connection/provider, actual Scout helper and three production caller functions in a controlled surrounding shell. Initial 503 is unavailable, retry restores named trades, details/filter/network are reachable, failed refresh retains stale cards, confirmed empty clears cards, reload refetches, and a real second tab's account change hides rows. All controls measured at least 44px; no horizontal overflow or page errors. 320px screenshots inspected. These are local API-fixture checks, not live provider consent or a full signed-in deployed app journey.
- Node20.20.2 Vite build with explicit `DHQ_SHARED_SOURCE` override passes. New consumer ESLint: zero errors/warnings. `git diff --check` passes.
- Existing shared suites pass: Yahoo state 5, transactions 18, context 14, league validation 21, protocol 14; ESPN transactions 18.
- Existing owner handshake integration: four groups pass. Existing release guard: ten groups pass. Existing intelligence contract: 12 pass. Existing DHQ sanity: 52 pass, zero skipped.
- Existing owner unit gate remains **136 pass / 9 fail** (145 total), the previously identified tier expectations. Re-ran exact 8d6cf54 `tests/unit.js` and `js/scout-ui.js` with the identical current shared bytes and Node25.8.1; all nine failure descriptions and summary match byte-for-byte. No tier behavior or assertion changed. This gate is not labeled passed.

Evidence: `evidence/scout-yahoo-transactions/`. Initial browser fixture attempted to open an absent blank second-tab page (404); adding that fixture route resolved the harness failure. Final browser run passes all three viewports. Local runtime uses Chrome fixtures; native build/install/device/store checks are not performed by this batch.

## Release status and remaining gates

The old checked-in provider release manifest correctly rejects the changed `main.js` before network verification. No final pin or manifest was regenerated. The parent must independently review/integrate this client and dc1e501 with the final canonical union, pin the exact reviewed shared revision, rebuild, regenerate/review the exact consumer manifest, release the consumer and verify all served asset hashes before any provider cutover. Existing initiating-tab verifier protocol and mechanical provider-first deployment block remain intact.

Independent review is requested; no suite-readiness claim is made. Real Yahoo credentials/consent are unavailable, so actual provider transaction completeness/pagination, a private league history and ordinary authored trades remain unverified. The full deployed Scout journey and broader league intelligence must be checked after authorized provider access is available. The existing nine unit tier failures remain documented, outside this transaction-only delta.
