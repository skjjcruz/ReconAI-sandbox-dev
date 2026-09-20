# Yahoo initiation proof and coordinated release — 2026-09-20

Status: **local reviewed-candidate evidence; independent correction review pending; provider deployment mechanically blocked until exact Scout client bytes are served**. No source publication, provider consent, hosted schema/data/function mutation, account operation, or store action was performed by this lane.

## Exact source ownership and issue

Owning provider and active Scout consumer: skjjcruz/ReconAI-sandbox-dev, baseline78294c80cf483aab32b37ae046d6b645f03ccb72. Isolated worktree reconai-readiness-actual-proxies, branch codex/readiness-actual-proxies-20260920. Prior candidate5d4bed8/bff7b20/b1aaddc preserved current provider behavior and repaired several defects, but root independently found the cookie-start fix incomplete.

Root's [recorded before observation](evidence/yahoo-transferred-start-before.json): an authenticated initiator handed an unused start link to a second browser. Its unauthenticated GET returned302 and assigned the recipient a cookie; fixture consent callback returned302, exchanged once, and stored provider tokens under the initiating app owner. That is a high-severity initiating-owner/browser mismatch. **Obtaining the resulting random Yahoo session ID or exercising actual provider consent was not proven.** The first report's closure claim is superseded.

## Cause and bounded correction

A top-level navigation cookie only identifies whoever opens the start URL. It does not prove that browser initiated the authenticated connection. New protocol `browser-verifier-v2` uses a random256-bit browser secret stored before navigation, sends only its SHA-256 challenge, and records the challenge/account/version/exact return URL in existing private state storage. The `browser_hash` text uses a `v2:` prefix, so old cookie states cannot qualify. No migration, pricing, entitlement, provider consent scope, or hidden product gate changed.

Yahoo's callback only relays code/state in a fragment to the recorded allowed app entry URL. No provider tokens are exchanged or saved at callback. Scout's first inline head script removes the fragment before any assets or actions. Its real boot path waits for `Yahoo.handleCallback()` before loading leagues. The initiating tab must send the original secret and its still-current app credential. Server completion atomically consumes one matching state/account/version/origin/path/query/secret before exchanging and confirming persistence. Client checks stop delayed responses from installing a session after the account changes.

This is browser-to-proxy proof, not a claim of provider PKCE support. API/refresh of existing saved sessions remains compatible, including signed legacy Sleeper owners without app-version revocation parity. Broader Yahoo hydration/account-switch response handling remains a separate review item; this batch does not claim all provider journeys are ready.

## Consumer inventory and compatibility

- Actual canonical shared proposal: **2ba92489cdbbedea7506f445e6baaab8c22f59ee**, isolated dhq-shared-readiness-yahoo from actualdedbb161. Only Yahoo module/tests/report changed; capital/ESPN remain independent candidates.
- Actual Scout consumer commits: **7a6d768415ddf9dc287ba74df5657357dec262ef**, then **ed259cf**. Files: `index.html`, `js/app.js`, `.dhq-shared-revision`, `.github/workflows/deploy.yml`. This is production consumer code, not solely the browser fixture. The final helper/version fallback reports refresh/reconnect without breaking unrelated boot paths.
- Actual publicdb1701f and nativeaa13193 dashboards contain an already-hidden Yahoo new-connect placeholder in js/app.js; no startAuth/handleCallback/yahoo_session callback callers exist. Sandbox shared provider loading and existing league hydration remain. Their gate is unchanged.
- Current C2 WarRoom likewise has the existing hidden Yahoo placeholder at js/app.js1896 and no callback caller. Its saved-session APIs remain compatible.
- Old C2 ReconAI source does contain the old callback/start caller. Configured read-only GitHub metadata shows both C2-Football/ReconAI and ReconAI-sandbox archived; both Pages endpoints return404. No unarchive or replacement deployment is inferred. Any cached old initiating client receives explicit HTTP409 `client_upgrade_required` and refresh/restart text from v2; it cannot fall back to insecure state.

New client/old backend refuses an absent v2 protocol before navigating to consent. Old cookie flows are not resumable on v2. An uncertain completion, timeout or failed browser persistence never claims success and requires a fresh flow; no automatic code replay. A pending attempt lasts10minutes. Existing saved sessions are not deleted by this change.

## Mechanical release and recovery gates

The owning Pages workflow now checks out an exact reviewed `.dhq-shared-revision`, not floating main. The prepared client-release manifest binds consumerrevisioned259cf, sharedrevision2ba9248, critical source hashes and **seven exact built index/JS assets**. It was generated after a successful Node20.20.2 Vite build with the exact canonical checkout and an identical vendored Yahoo file. Static module references must be represented in its verified asset graph.

The provider workflow verifies the committed `scripts/yahoo-client-release.json` using `scripts/verify-yahoo-client-release.py` before **any** of its three deployment commands. No redirects are followed, the owning Scout destination is fixed, stale/error/missing bytes fail, and source/pin changes demand a new build and manifest review. The workflow never generates a manifest automatically. Existing schema preflight remains required and applies no SQL. A read-only run against current Scout **failed closed on index.html**, correctly proving these new bytes are not served yet.

Authorized release sequence for the parent: independently review shared/client/provider/gate; merge canonical Yahoo with other approved canonical changes and select the final exact revision; update the consumer pin, rebuild the complete consumer, regenerate and review its manifest (source/asset hashes necessarily change); publish and verify Scout consumer; then permit provider deployment when its preflight passes exact served bytes. A localMac-generated manifest does not assert that a future Linux artifact matches; differing final artifacts require regenerated reviewed hashes. Do not merge a floating pin or rely on parallel automatic jobs. Keep a verified v2 consumer/backend pair for rollback; reintroducing the old transferable callback is not a safe recovery path.

## Actual verification and limits

| Check | Result / evidence |
|---|---|
| Actual canonical browser module | 14groupsPASS: storage/proof confinement, reload, separate browser, account/version/path/state mismatch, duplicate and delayed requests, timeout/save failures, legacy saved API session. [Log](evidence/yahoo-client-sep20.log) |
| Actual provider handlers/helpers | Yahoo15 + ESPN/MFL9 groupsPASS; real fixture JWT verification, exact ownership, wrong proof, competing consumption, revocation and save failure. [Log](evidence/yahoo-proxy-runtime-sep20.log) |
| CORS contracts | 9PASS. Obsolete cookie-path source assertion replaced with the stricter return/context check; behavioral coverage expanded. [Log](evidence/yahoo-cors-sep20.log) |
| Actual client + handler + Scout boot | 4groupsPASS, including real boot awaiting proof before league actions and error recovery. [Log](evidence/yahoo-integration-sep20.log) |
| Chrome fixture contexts | 3PASS: transferred consent link rejected in a separate browser, initiating320px browser completes/reloads,844×390control reachable.390pxrecipient recovery screenshot inspected. [Log](evidence/yahoo-browser-sep20.log), [image](evidence/yahoo-transferred-proof-recovery.png) |
| Release guard | 10groupsPASS: exact/stale bytes, source/pin/path/destination/manifest failures, missing referenced module, no redirect, mandatory ordering before every provider deployment. [Log](evidence/yahoo-release-guard-sep20.log) |
| Build and static checks | Exact shared sync, Node20.20.2 Vite build, Deno Yahoo check, diff-checkPASS. [Build](evidence/yahoo-build-node20-sep20.log), [Deno](evidence/yahoo-deno-sep20.log) |
| Broad owner suite | Still136/145, same9 tier assertions as independently proven untouched78294c8 baseline. Not waived or repaired in this Yahoo lane. [Current log](evidence/yahoo-full-suite-sep20.log), [prior exact baseline proof](actual-reconai-proxies-20260920.md) |
| Live readiness gate | **BLOCKED as intended:** new index bytes are not served. [Read-only evidence](evidence/yahoo-live-gate-sep20.log) |

The Chrome fixture uses actual shared code, actual callback-head source, actual server handler and controlled signed accounts. Provider HTTP/consent and app shell are routed fixtures. The HTTP302 server response is separately verified; the browser harness translates it to a top-level fixture navigation so its route handler cannot fall through to a real site. Full Scout product browser journey, real Yahoo consent/read/write, native callback/build/install/device, and store evidence are **NOT RUN**. No Yahoo public-readiness claim is made.

Re-run: `node tests/proxy-security-runtime.cjs`; `npm run test:proxy-runtime`; `npm run test:proxy-cors`; `python3 tests/yahoo-release-guard.py`; `READINESS_YAHOO_SHARED=/path/to/exact/shared node tests/yahoo-handshake-integration.cjs`; canonical `node tests/yahoo-browser-binding.cjs`. Browser fixture accepts `PLAYWRIGHT_MODULE_PATH` (tested existing@playwright/test1.59.1) and optional `PLAYWRIGHT_CHROME_PATH`. Use `python3 scripts/verify-yahoo-client-release.py --write --shared /path/to/exact/shared` only after a clean, verified consumer build, then independently review the resulting manifest; ordinary verification is read-only with no flags.
