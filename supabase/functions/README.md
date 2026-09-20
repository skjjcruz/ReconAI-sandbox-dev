# Supabase Function Ownership

The production Supabase project is shared by Scout and War Room. To avoid
deploy drift, each function has one source repo.

## Owned Here

- `espn-proxy` - ESPN private league proxy.
- `mfl-proxy` - MyFantasyLeague CORS/server relay.
- `yahoo-proxy` - Yahoo OAuth callback, token storage, refresh, and API proxy.

## Owned By War Room

- `ai-analyze` - official server AI routing, rate limits, telemetry, and model policy.
- `get-session-token` - legacy Sleeper username JWT session issuer.
- `set-password` - gifted-user password setup.
- `fw-signup`, `fw-signin`, `fw-create-checkout`, `fw-stripe-webhook`, `admin-list-users` - email auth, billing, and admin functions.

## Retired

- `yahoo-auth` is retired. Use `yahoo-proxy` for both OAuth and API proxying.

Deploy individual functions by name from the owning repo. Do not deploy a
same-named function from the other repo.


## Provider release checks

Run `npm run test:proxy-cors` and `npm run test:proxy-runtime` before releasing
these three functions. The deployment workflow verifies the existing private
Yahoo state schema and exact reviewed durable limiter through
`scripts/proxy-release-preflight.sql`. It does not apply migrations. If that
read-only gate fails, reconcile the owning schema/source before deployment.
Account/session issuance remains owned by the native War Room repository;
`_shared/yahoo-owner.ts` only validates the signed session contract for Yahoo.
See `reports/public-readiness/actual-reconai-proxies-20260920.md` for the source
comparison, evidence and remaining real-provider/native gates.
