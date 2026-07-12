#!/bin/bash
# Trigger the Cloudflare worker scheduled handler for local development
# This simulates the cron trigger that creates market rounds

while true; do
  echo "$(date): Triggering market scheduler..."
  curl -s "http://localhost:8787/cdn-cgi/handler/scheduled" && echo " ✓"
  sleep 120  # Wait 2 minutes (matches wrangler.jsonc cron schedule)
done