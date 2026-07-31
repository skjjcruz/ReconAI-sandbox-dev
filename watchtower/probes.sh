#!/usr/bin/env bash
# Watchtower probes — use the product the way a customer does, every 10 min.
# Each probe retries once before counting as a failure; failures are appended
# to watchtower/state/failures.txt for alarm.sh. Never exits nonzero — the
# alarm layer is the signal, not a red X.
set -uo pipefail

FN_BASE="https://sxshiqyxhhifvtfqawbq.supabase.co/functions/v1"
APP="https://skjjcruz.github.io/github.com-skjjcruz-owner-dashboard-dev"
WEB="https://dhqfootball.com"
OUT="watchtower/state"
mkdir -p "$OUT"
: > "$OUT/failures.txt"

# probe <name> <expected-status> <curl args...>
probe() {
  local name="$1" expect="$2"; shift 2
  local code
  for attempt in 1 2; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$@") || code=000
    [ "$code" = "$expect" ] && { echo "OK   $name ($code)"; return 0; }
    sleep 5
  done
  echo "FAIL $name — got $code, expected $expect" | tee -a "$OUT/failures.txt"
}

# content <name> <needle> <url>
content() {
  local name="$1" needle="$2" url="$3"
  for attempt in 1 2; do
    if curl -s --max-time 15 "$url" | grep -q "$needle"; then
      echo "OK   $name"; return 0
    fi
    sleep 5
  done
  echo "FAIL $name — marker '$needle' missing from $url" | tee -a "$OUT/failures.txt"
}

# ── The native app's site (the shell live-loads this) ──
probe   app-index   200 "$APP/index.html"
content app-built   "PRECOMPILED BOOTSTRAP" "$APP/index.html"
probe   app-engine  200 "$APP/reconai-shared/supabase-client.js"
probe   app-engine2 200 "$APP/reconai-shared/dhq-engine.js"

# ── The website ──
probe   web-index   200 "$WEB/"
probe   web-engine  200 "$WEB/reconai-shared/supabase-client.js"

# ── The backend, as a signed-out client would hit it ──
# Correct behavior: 400 (bad request) / 401 (no auth). 5xx or CORS failures alarm.
probe   be-signin   400 -X POST "$FN_BASE/fw-signin"  -H "Origin: $WEB" -H 'Content-Type: application/json' -d '{}'
probe   be-signup   400 -X POST "$FN_BASE/fw-signup"  -H "Origin: $WEB" -H 'Content-Type: application/json' -d '{}'
probe   be-profile  401 -X POST "$FN_BASE/fw-profile" -H "Origin: $WEB" -H 'Content-Type: application/json' -d '{}'
probe   be-ai       401 -X POST "$FN_BASE/ai-analyze" -H "Origin: $WEB" -H 'Content-Type: application/json' -d '{}'

# ── Third-party feeds the product depends on ──
probe   sleeper     200 "https://api.sleeper.app/v1/state/nfl"

if [ -s "$OUT/failures.txt" ]; then
  echo "── PROBES: $(wc -l < "$OUT/failures.txt") failure(s)"
else
  echo "── PROBES: all green"
fi
exit 0
