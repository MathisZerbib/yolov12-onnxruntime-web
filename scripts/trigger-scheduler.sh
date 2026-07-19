#!/usr/bin/env bash
# Local development helper. Production is driven by the Cloudflare Cron Trigger
# declared in wrangler.jsonc and never runs this shell process.

set -u

SCHEDULER_URL="${SCHEDULER_URL:-http://localhost:8787/cdn-cgi/handler/scheduled}"
SCHEDULER_INTERVAL_SECONDS="${SCHEDULER_INTERVAL_SECONDS:-60}"

if ! [[ "$SCHEDULER_INTERVAL_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  echo "SCHEDULER_INTERVAL_SECONDS must be a positive integer" >&2
  exit 1
fi

trigger_scheduler() {
  curl --fail --silent --show-error --max-time 20 "$SCHEDULER_URL" >/dev/null
}

until trigger_scheduler; do
  echo "Waiting for the local Worker scheduler endpoint..."
  sleep 1
done

echo "Local market scheduler started; Cloudflare Cron handles this in production."
while sleep "$SCHEDULER_INTERVAL_SECONDS"; do
  if trigger_scheduler; then
    echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') market scheduler reconciled"
  else
    echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') market scheduler failed; retrying in ${SCHEDULER_INTERVAL_SECONDS}s" >&2
  fi
done
