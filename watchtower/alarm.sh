#!/usr/bin/env bash
# Alarm layer — turns probe failures / guardian incidents into ONE persistent
# GitHub issue (labeled 'watchtower') that the hourly operator works from.
# Green cycles close the issue with a recovery note. Issue edits don't email
# anyone; only open/close do — so a real incident makes exactly one sound.
# Never exits nonzero.
set -uo pipefail

OUT="watchtower/state"
LABEL="watchtower"
TITLE="🔴 Watchtower: production attention needed"
STAMP="$(date -u '+%Y-%m-%d %H:%M UTC')"

gh label create "$LABEL" --description "Automated production watch" --color D93F0B 2>/dev/null || true

BODY=""
if [ -s "$OUT/failures.txt" ]; then
  BODY+=$'## Probe failures\n```\n'"$(cat "$OUT/failures.txt")"$'\n```\n'
fi
if [ -s "$OUT/incident.txt" ]; then
  BODY+=$'## Backend guardian incident\n```\n'"$(cat "$OUT/incident.txt")"$'\n```\n'
fi
if [ -f "$OUT/guardian-unarmed.txt" ]; then
  BODY+=$'## Guardian status\nUnarmed — SUPABASE_ACCESS_TOKEN secret missing in this repo; drift detection is running on the hourly operator instead.\n'
fi

EXISTING=$(gh issue list --label "$LABEL" --state open --json number --jq '.[0].number' 2>/dev/null || echo "")

if [ -n "$BODY" ]; then
  FULL=$'Automated report — last update: '"$STAMP"$'\n\n'"$BODY"$'\n---\nThe hourly operator (Claude) works this issue under standing orders (restore approved code, re-run approved pipelines). Frozen-app changes and database structure always escalate to the owner.'
  if [ -n "$EXISTING" ]; then
    gh issue edit "$EXISTING" --body "$FULL" >/dev/null && echo "alarm: updated issue #$EXISTING"
  else
    gh issue create --title "$TITLE" --label "$LABEL" --body "$FULL" >/dev/null && echo "alarm: OPENED new incident issue"
  fi
else
  if [ -n "$EXISTING" ]; then
    gh issue close "$EXISTING" --comment "✅ All probes green as of $STAMP — recovered." >/dev/null \
      && echo "alarm: closed issue #$EXISTING (recovered)"
  else
    echo "alarm: all green, nothing open"
  fi
fi
exit 0
