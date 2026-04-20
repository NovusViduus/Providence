#!/usr/bin/env bash
# Auto-pull Eye logs from honeypots and inject into Citadel.
# Run via cron: */30 * * * * /path/to/auto_inject.sh
#
# Prerequisites: ssh-agent with key loaded, Docker running

set -euo pipefail
cd "$(dirname "$0")/.."

LOG_DIR="data/eye-captures"
mkdir -p "$LOG_DIR"

# Pull latest logs (skip if unreachable)
for pair in "54.91.174.191:lure-us" "3.253.60.6:lure-eu" "3.0.102.2:lure-ap"; do
  HOST="${pair%%:*}"
  NAME="${pair##*:}"
  scp -P 62222 -o ConnectTimeout=5 -o StrictHostKeyChecking=no \
    "ubuntu@$HOST:/home/ubuntu/eye.log" "$LOG_DIR/${NAME}_eye.log" 2>/dev/null || true
done

# Inject if Citadel is running
if curl -s --max-time 3 http://localhost:8080/actuator/health > /dev/null 2>&1; then
  ./scripts/inject_eye_events.sh 2>/dev/null
fi
