#!/usr/bin/env bash
# Backend guardian — detects backend function changes that did NOT come from
# an approved pipeline, and restores the approved code on the spot.
#
# Approved pipelines: skjjcruz/github.com-skjjcruz-owner-dashboard-dev
# (deploy-functions.yml) and this repo's own deploy-functions.yml (the
# ESPN/MFL/Yahoo league proxies). Anything else that changes a production
# function — the idea lab's leftover pipeline, a stray CLI, anything — is
# unauthorized: the guardian redeploys the approved source immediately and
# reports the incident (watchtower/state/incident.txt → alarm.sh).
#
# Requires SUPABASE_ACCESS_TOKEN (repo secret). Without it the guardian
# reports itself unarmed so the hourly operator knows to take over.
# Never exits nonzero.
set -uo pipefail

PROJECT="sxshiqyxhhifvtfqawbq"
TRUTH_REPO="skjjcruz/github.com-skjjcruz-owner-dashboard-dev"
OUT="watchtower/state"
BASELINE="watchtower/baseline.json"
mkdir -p "$OUT"
: > "$OUT/incident.txt"

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "GUARDIAN UNARMED — SUPABASE_ACCESS_TOKEN secret is not set in this repo" | tee "$OUT/guardian-unarmed.txt"
  exit 0
fi
rm -f "$OUT/guardian-unarmed.txt"

snapshot() {
  local resp code body
  resp=$(curl -s --max-time 20 -w $'\n%{http_code}' -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    "https://api.supabase.com/v1/projects/$PROJECT/functions") || { echo "CURL_FAIL"; return; }
  code=$(echo "$resp" | tail -1)
  body=$(echo "$resp" | sed '$d')
  if [ "$code" != "200" ]; then
    echo "HTTP_$code $(echo "$body" | head -c 200)" >&2
    echo "API_ERROR"
    return
  fi
  echo "$body" | jq -S 'map({(.slug): .version|tostring}) | add // {}' 2>/dev/null || echo "PARSE_ERROR"
}

CURRENT=$(snapshot)
case "$CURRENT" in
  CURL_FAIL|API_ERROR|PARSE_ERROR|""|null)
    echo "guardian: management API check failed ($CURRENT) — skipping this cycle (see stderr above for detail)"
    exit 0;;
esac

# First run: record the baseline and stand watch from here.
if [ ! -f "$BASELINE" ]; then
  echo "$CURRENT" > "$BASELINE"
  echo "baseline-init" > "$OUT/commit-baseline.txt"
  echo "guardian: baseline initialized ($(echo "$CURRENT" | jq 'length') functions)"
  exit 0
fi

DRIFT=$(jq -n --argjson a "$(cat "$BASELINE")" --argjson b "$CURRENT" \
  '[($b | keys[]) as $k | select(($a[$k] // "absent") != $b[$k]) | $k]')
COUNT=$(echo "$DRIFT" | jq 'length')

if [ "$COUNT" -eq 0 ]; then
  echo "guardian: no drift"
  exit 0
fi
echo "guardian: drift in $COUNT function(s): $(echo "$DRIFT" | jq -r 'join(", ")')"

# Was this one of OUR pipelines? (any successful deploy-functions run that
# finished in the last 60 minutes, in either approved repo)
legit() {
  for repo in "$TRUTH_REPO" "$GITHUB_REPOSITORY"; do
    runs=$(curl -s --max-time 20 -H "Authorization: Bearer $GITHUB_TOKEN" \
      "https://api.github.com/repos/$repo/actions/workflows/deploy-functions.yml/runs?status=success&per_page=3" \
      | jq -r '.workflow_runs[]?.updated_at' 2>/dev/null)
    for ts in $runs; do
      age=$(( $(date +%s) - $(date -d "$ts" +%s) ))
      [ "$age" -lt 3600 ] && return 0
    done
  done
  return 1
}

if legit; then
  echo "guardian: drift matches an approved deploy — updating baseline"
  echo "$CURRENT" > "$BASELINE"
  echo "approved-deploy" > "$OUT/commit-baseline.txt"
  exit 0
fi

# ── UNAUTHORIZED CHANGE — restore the approved source ──
echo "UNAUTHORIZED backend change: $(echo "$DRIFT" | jq -r 'join(", ")')" | tee -a "$OUT/incident.txt"

git clone --depth 1 "https://github.com/$TRUTH_REPO.git" /tmp/truth 2>/dev/null

RESTORED=""; UNKNOWN=""
for slug in $(echo "$DRIFT" | jq -r '.[]'); do
  if [ -d "/tmp/truth/supabase/functions/$slug" ]; then
    ( cd /tmp/truth && supabase functions deploy "$slug" --project-ref "$PROJECT" --use-api --no-verify-jwt ) \
      && RESTORED="$RESTORED $slug" || UNKNOWN="$UNKNOWN $slug(restore-failed)"
  elif [ -d "supabase/functions/$slug" ]; then
    supabase functions deploy "$slug" --project-ref "$PROJECT" --use-api --no-verify-jwt \
      && RESTORED="$RESTORED $slug" || UNKNOWN="$UNKNOWN $slug(restore-failed)"
  else
    UNKNOWN="$UNKNOWN $slug(no-approved-source)"
  fi
done

[ -n "$RESTORED" ] && echo "Auto-restored from approved source:$RESTORED" | tee -a "$OUT/incident.txt"
[ -n "$UNKNOWN" ]  && echo "NEEDS HUMAN/OPERATOR:$UNKNOWN" | tee -a "$OUT/incident.txt"

# Re-baseline on the post-restore state so the alarm doesn't repeat forever.
snapshot > "$BASELINE" 2>/dev/null
echo "post-restore" > "$OUT/commit-baseline.txt"
exit 0
