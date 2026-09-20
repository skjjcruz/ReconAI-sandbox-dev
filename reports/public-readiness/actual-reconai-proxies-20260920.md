# Actual ReconAI provider reconciliation — 2026-09-20

Status: **review candidate; not deployed or public-ready proof**. Frozen provider source commit `5d4bed8`. Worktree `/Users/jacobc/Projects/reconai-readiness-actual-proxies`, branch `codex/readiness-actual-proxies-20260920`, exact base `78294c80cf483aab32b37ae046d6b645f03ccb72`. This patch changes only provider functions/helpers, their tests, and the owning release prerequisites. Account/auth endpoints and account lifecycle source are untouched.

## Ownership and current hosted evidence

The active owner is `skjjcruz/ReconAI-sandbox-dev`. Its [exact owning workflow](https://github.com/skjjcruz/ReconAI-sandbox-dev/blob/78294c80cf483aab32b37ae046d6b645f03ccb72/.github/workflows/deploy-functions.yml) deploys `espn-proxy`, `mfl-proxy`, and `yahoo-proxy` to the shared `sxshiqyxhhifvtfqawbq` backend. Actual native `aa13193` explicitly delegates these functions to ReconAI. Public-web `db1701f` does not own backend deployment. C2 `bb45182` (`abaa928` before cherry-pick) is reviewed prior work, not authority to overwrite the current owning source.

Read-only configured CLI metadata and source downloads on this checkpoint found:

| Function | Hosted version | Relation to actual owner base |
|---|---:|---|
| ESPN | 117 | Entry source identical |
| MFL | 124 | Older native-derived helper/import style and per-instance limiter; includes useful404 guidance absent in owner |
| Yahoo | 111 | Entry source identical; unsigned callback state and stale app session acceptance present |

Metadata was read both before and after download and was unchanged. [Hashes and timestamps](evidence/actual-proxy-provenance.json) record the exact comparison. No hosted functions, schema, accounts, connections, or provider data were mutated.

## Issues and resolution

| Severity / issue | Reproduction and cause | Resolution / evidence |
|---|---|---|
| High: Yahoo callback account injection and login CSRF | Actual handler accepts attacker-constructed base64 `{ownerKey,return}` and reaches token exchange; state is neither server-recorded nor browser-bound. | Port the reviewed opaque, expiring state + top-level browser-cookie start. Atomic filtered `DELETE RETURNING` consumes one matching browser state. Caller-supplied callback identity/return URL is ignored. Valid, forged, missing/wrong-cookie, expired, replay, and competing-callback fixtures pass. |
| High: revoked app sessions retain Yahoo access | A real signed app JWT with version1 still receives an auth URL while the fixture account is version2. Owner verification checked only signature. | Provider-local helper verifies the signed app identifier and current database session version for every action. App-shaped tokens cannot fall back to legacy claims. Callback checks the version before and after token exchange. Valid legacy signed Sleeper identities remain supported; legacy version parity is not claimed. |
| High: automatic redirect can carry MFL credentials outside checked provider host | Owner source validates only initial URL and at most the first explicit redirect. Login uses automatic redirects and the second cookie hop resumes automatic redirects. | Every hop is manual and checked before request; bound to HTTPS MFL hosts with no embedded credentials/nonstandard ports, maximum5 requests/15seconds. Explicit lineup POST semantics survive permitted shard/relative redirects. Login follows ordinary302/303 method conversion and carries/extracts the permitted MFL session cookie. Foreign first/second hops and loops fail before sending credentials there. ESPN/Yahoo do not follow unexpected redirects with credentials. |
| High: limiter outage resets public proxy budgets | Owner helper uses per-worker fallback after durable RPC/configuration failure, so new workers receive new allowances. | Preserve the owner's existing `check_rate_limit` RPC and namespace; reject unavailable/malformed outcomes with truthful503 and retry headers. Ordinary exhausted budgets remain429. Tests share one counter across fresh workers and deny errors/empty/malformed replies. No C2 auth helper or alternate rate-limit schema is imported. |
| Medium: Yahoo success despite failed token save | Original `storeTokens` logs `{error}` then callback redirects success. Provider responses are not checked for required tokens. | Storage failures throw, incomplete token results fail, and no success URL is returned without confirmed storage. Existing return query/fragment survive. Fixture storage failure produces503 without database detail. |
| Medium: unsafe/unhelpful errors and malformed bodies | Original callback interpolates unescaped `error` into HTML; null action body throws; MFL lacks hosted404 guidance. | Callback errors are fixed plain text with no-store/nosniff; malformed body shapes get400; provider failures return bounded safe messages. Preserve MFL hosted League ID/year404 copy. |

[Baseline log](evidence/actual-proxy-before.log) records the first four direct original failures and four expected missing-security-flow regressions; eight failing test groups are **not eight independently reproduced defects**. The redirect and limiter cases are separately exercised by the runtime fixtures. All provider/database interactions in these tests are explicit disposable fixtures; no real purchase, login, lineup change, Yahoo authorization code, or provider account was used.

## Validation

- `npm run test:proxy-cors`:9/9 existing contracts, updated only where established replacement behavior is now protected by actual-handler tests.
- `npm run test:proxy-runtime`:12 Yahoo/JWT and9 relay/limiter groups. Actual TypeScript bodies are transpiled with pinned TypeScript5.8.3; real jose5.10.0 signs/verifies fixture JWTs. No network imports execute in tests.
- Both runtime suites also pass under Node20.20.2, matching the owner's existing Node20 CI family. [Focused log](evidence/actual-proxy-focused.log).
- `npm run test:schema`:9/9; `npm run test:rls`:8/8. [Log](evidence/actual-proxy-schema-contracts.log).
- `npx --yes deno check --node-modules-dir=none --no-lock` on all3 actual entrypoints:PASS. [Log](evidence/actual-proxy-deno.log).
- Workflow YAML parsed; embedded Python preflight compiled; exactly the three owning deploy commands remain. `git diff --check`:PASS.
- **Broader npm test did not pass**:unchanged unit tests stop at136pass/9fail in legacy/free-tier expectations while actual shared `dedbb1614f08459905eef27d0f0b7bce27cd4e15` returns paid access. No related source or assertions were edited. [Full attempted run](evidence/actual-proxy-full-test.log). Later broad suites therefore are not counted as run.
- Independent-baseline reproduction: exported **untouched owner78294c8** with `git archive` into `/tmp/readiness-proxy-78294c8-baseline`, attached the same installed dependency tree, synced the exact same actual shared `dedbb16`, and ran the same `npm test` under Node25.8.1. It also stops at136pass/9fail. A comparison of all nine failing assertion names **and their expected/actual lines** matched exactly. [Untouched baseline log](evidence/actual-proxy-untouched-baseline-test.log). This confirms the unit failure was not introduced by the proxy patch; it does not waive the owner-wide release gate.
- Local `npm audit` reports one pre-existing moderate transitive `@humanfs/node` advisory. No high/critical finding appeared; unrelated tooling upgrades were not added.

## Existing schema and release boundary

Read-only catalog checks confirm `yahoo_oauth_states`, its primary key/browser hash/expiry/version fields, private browser access, `app_users.session_version`, Yahoo owner binding, and the service-only atomic `check_rate_limit(text,integer,integer)` RPC. The existing `active_app_session` policies are **restrictive**, not a permissive bypass; Yahoo token storage retains deny-all browser policy. [Schema](evidence/actual-proxy-hosted-schema.json), [policy mode](evidence/actual-proxy-hosted-policies.json).

No migration is introduced or auto-applied. The owning workflow retains its old migration-registry check and adds a fixed `BEGIN READ ONLY` [preflight](../../scripts/proxy-release-preflight.sql) requiring all7 known compatibility checks, including the exact observed limiter definition fingerprint. It runs actual proxy contracts before any deployment even without a token, then rejects unavailable/different schema before any provider is deployed. [Actual hosted preflight result:7true](evidence/actual-proxy-release-preflight.json). Changes to the shared RPC definition require a new review and fingerprint; do not weaken this to deploy a stale caller.

Publishing/releasing is outside this agent's task. Configured GitHub metadata reported pull permission only on this actual upstream. Root may prepare the authorized upstream PR/release through the established route once reviewed. Re-read current hosted sources and this preflight immediately before release because another owning workflow can change the shared backend. Recover by a reviewed compatible provider revision only; never restore the unsigned Yahoo flow or blanket-deploy the C2 account/backend copies. The current owner workflow still has no cross-repository atomic deployment lock or hosted source compare-and-swap; this candidate does not claim to solve external deployment races.

## Remaining evidence and next steps

1. Independent source review, then an owning-repository release candidate with exact revision and current hosted source comparison. No publication/deployment has happened here.
2. Resolve or explicitly account for the unrelated owner-wide unit gate before claiming the whole ReconAI repository green.
3. After authorized provider release, verify deployed source/helper hashes, gateway configuration, and supported frontend origins; then exercise controlled provider journeys with actual permitted credentials.
4. Yahoo Developer client secrets, registered redirect configuration, actual consent/cookie behavior and provider account authorization were **not validated**. Tests establish handler behavior, not a live OAuth connection. Existing clients' `auth_url` top-level navigation is source-compatible; real-browser provider completion remains untested.
5. Native CORS headers are tested as contract data. Native URL-scheme return handling, native builds, installation, physical devices and store distribution are **not tested**. Do not infer native Yahoo readiness from browser callback fixtures.
6. MFL real login, private league reads/writes, provider outage/latency and ESPN private-cookie access remain untested. No provider credentials were requested or printed. Mocked competing callbacks prove the client query shape and handler outcomes, not independent-connection hosted contention.
7. In-flight account revocation and provider token persistence are not one cross-service transaction. The second version check closes the observed exchange delay; no claim of atomicity across account DB and Yahoo is made. Reconnect remains the recovery path after an uncertain provider token rotation/save failure.

Scope stayed within existing provider functionality. Browser public access, MFL login/write support, legacy signed owner support, production/native CORS origins and actionable provider errors are preserved; none were hidden to make tests pass.
