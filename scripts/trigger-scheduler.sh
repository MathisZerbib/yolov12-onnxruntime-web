#!/usr/bin/env bash
# Local development helper. Production is driven by the Cloudflare Cron Trigger
# declared in wrangler.jsonc and never runs this shell process.

set -u

SCHEDULER_URL="${SCHEDULER_URL:-http://localhost:8787/cdn-cgi/handler/scheduled}"
SCHEDULER_INTERVAL_SECONDS="${SCHEDULER_INTERVAL_SECONDS:-60}"
SCHEDULER_STARTUP_TIMEOUT="${SCHEDULER_STARTUP_TIMEOUT:-60}"  # Nouveau: timeout de démarrage

if ! [[ "$SCHEDULER_INTERVAL_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  echo "SCHEDULER_INTERVAL_SECONDS must be a positive integer" >&2
  exit 1
fi

trigger_scheduler() {
  curl --fail --silent --show-error --max-time 10 "$SCHEDULER_URL" >/dev/null 2>&1
}

# Nouveau: attend que le port soit réellement disponible avant de commencer
echo "⏳ Waiting for Worker to be ready (timeout: ${SCHEDULER_STARTUP_TIMEOUT}s)..."
elapsed=0
until trigger_scheduler; do
  sleep 1
  elapsed=$((elapsed + 1))
  if [ $elapsed -ge $SCHEDULER_STARTUP_TIMEOUT ]; then
    echo "❌ Worker did not start within ${SCHEDULER_STARTUP_TIMEOUT}s" >&2
    exit 1
  fi
done
echo "✓ Worker ready on http://localhost:8787"

echo "🚀 Local market scheduler started; Cloudflare Cron handles this in production."
while sleep "$SCHEDULER_INTERVAL_SECONDS"; do
  if trigger_scheduler; then
    echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') ✓ scheduler reconciled"
  else
    echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') ✗ scheduler failed; retrying in ${SCHEDULER_INTERVAL_SECONDS}s" >&2
  fi
done