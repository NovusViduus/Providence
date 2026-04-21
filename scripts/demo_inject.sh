#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Providence Demo Event Injector
#
# Injects random attack events into Citadel for live demos.
# All injected events use sourceComponent="demo" so they can
# be cleaned up afterward.
#
# Usage:
#   ./scripts/demo_inject.sh                  # default: 2 hours, localhost
#   ./scripts/demo_inject.sh 30               # run for 30 minutes
#   CITADEL=http://44.251.168.55:8080 ./scripts/demo_inject.sh
#
# Kill:
#   kill $(cat /tmp/providence_demo.pid)
#   # or just Ctrl+C
#
# Cleanup happens automatically on exit (SIGINT, SIGTERM, or timeout).
# ─────────────────────────────────────────────────────────────

set -euo pipefail

CITADEL="${CITADEL:-http://localhost:8080}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-Khal}"
DURATION_MINUTES="${1:-120}"
MIN_INTERVAL=30   # seconds
MAX_INTERVAL=90   # seconds
PID_FILE="/tmp/providence_demo.pid"

# ── Attacker IPs (realistic, from known threat ranges) ──
ATTACKER_IPS=(
  "185.220.101.34"   # NL - Tor exit
  "45.148.10.240"    # RU - scanner
  "176.65.132.254"   # RU - brute force
  "103.48.192.48"    # IN - scanner
  "219.153.103.109"  # CN - brute force
  "91.224.92.147"    # UA - exfil
  "36.132.36.134"    # CN - probe
  "89.47.53.19"      # RO - scanner
  "124.236.76.72"    # CN - miner
  "178.170.8.254"    # RU - exfil
  "205.210.31.33"    # US - scanner
  "87.121.84.102"    # BG - brute force
  "117.50.130.163"   # CN - probe
  "95.85.245.170"    # NL - scanner
  "160.30.158.167"   # US - exfil
)

# ── Honeypot destinations ──
HONEYPOT_IPS=("54.91.174.191" "3.253.60.6" "3.0.102.2")
HONEYPOT_PORTS=(22 2222 23)

# ── Attack categories with weights ──
# Format: "CATEGORY:SUBCATEGORY:MIN_CONF:MAX_CONF:WEIGHT"
ATTACK_PROFILES=(
  "BRUTE_FORCE:ssh:0.70:0.98:30"
  "EXFILTRATION:data_transfer:0.80:0.99:20"
  "DOS:syn_flood:0.65:0.95:15"
  "DOS:slowloris:0.60:0.90:10"
  "PROBE:port_scan:0.40:0.85:15"
  "INJECTION:sql:0.55:0.92:5"
  "AI_AGENT:llm_driven:0.75:0.97:5"
)

# ── Track injected event IDs for cleanup ──
INJECTED_IDS=()

# ── Helper: random int in range ──
rand_range() {
  local min=$1 max=$2
  echo $(( RANDOM % (max - min + 1) + min ))
}

# ── Helper: random float between two values (2 decimal places) ──
rand_float() {
  local min_100=$(echo "$1 * 100" | bc | cut -d. -f1)
  local max_100=$(echo "$2 * 100" | bc | cut -d. -f1)
  local val=$(( RANDOM % (max_100 - min_100 + 1) + min_100 ))
  printf "0.%02d" "$val" | sed 's/0\.0\([0-9]\)/0.0\1/'
  # Better approach:
  echo "$val" | awk '{printf "%.2f", $1/100}'
}

# ── Helper: pick random element from array ──
pick() {
  local arr=("$@")
  echo "${arr[RANDOM % ${#arr[@]}]}"
}

# ── Helper: weighted random attack profile ──
pick_attack() {
  local total=0
  for p in "${ATTACK_PROFILES[@]}"; do
    local w="${p##*:}"
    total=$((total + w))
  done
  local roll=$(( RANDOM % total ))
  local cumulative=0
  for p in "${ATTACK_PROFILES[@]}"; do
    local w="${p##*:}"
    cumulative=$((cumulative + w))
    if [ "$roll" -lt "$cumulative" ]; then
      echo "$p"
      return
    fi
  done
  echo "${ATTACK_PROFILES[0]}"
}

# ── Get JWT token ──
get_token() {
  curl -sf "${CITADEL}/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])" 2>/dev/null
}

# ── Cleanup: delete all demo events ──
cleanup() {
  echo ""
  echo "╔══════════════════════════════════════╗"
  echo "║  Cleaning up demo events...          ║"
  echo "╚══════════════════════════════════════╝"

  local count=${#INJECTED_IDS[@]}
  if [ "$count" -eq 0 ]; then
    echo "No events to clean up."
  else
    echo "Removing ${count} injected demo events..."

    # Refresh token in case it expired
    local token
    token=$(get_token) || { echo "Failed to get token for cleanup. Events tagged sourceComponent=demo remain in DB."; exit 1; }

    # Delete via SQL through a cleanup endpoint, or just mark them
    # Since Citadel doesn't have a bulk delete endpoint, we'll use
    # a direct DB cleanup via docker exec
    ssh -i ~/.ssh/providence-key.pem -o ConnectTimeout=5 ubuntu@44.251.168.55 \
      "docker exec providence-postgres-1 psql -U providence -d providence -c \"DELETE FROM security_events WHERE source_component = 'demo';\"" 2>/dev/null \
      && echo "✓ Cleaned ${count} demo events from database." \
      || echo "⚠ Could not reach DB directly. Run manually:"
    echo "  docker exec providence-postgres-1 psql -U providence -d providence -c \"DELETE FROM security_events WHERE source_component = 'demo';\""
  fi

  rm -f "$PID_FILE"
  echo "Done. Demo injector stopped."
  exit 0
}

# ── Trap signals for cleanup ──
trap cleanup SIGINT SIGTERM EXIT

# ── Main ──
echo "╔══════════════════════════════════════╗"
echo "║  Providence Demo Event Injector      ║"
echo "╠══════════════════════════════════════╣"
echo "║  Target:   ${CITADEL}"
echo "║  Duration: ${DURATION_MINUTES} minutes"
echo "║  Interval: ${MIN_INTERVAL}-${MAX_INTERVAL}s"
echo "║  PID file: ${PID_FILE}"
echo "║                                      ║"
echo "║  Kill: kill \$(cat ${PID_FILE})  ║"
echo "║    or: Ctrl+C                        ║"
echo "╚══════════════════════════════════════╝"
echo ""

# Write PID
echo $$ > "$PID_FILE"

# Get initial token
echo "Authenticating..."
TOKEN=$(get_token) || { echo "ERROR: Failed to authenticate with ${CITADEL}"; exit 1; }
echo "✓ Authenticated"
echo ""

# Calculate end time
END_TIME=$(( $(date +%s) + DURATION_MINUTES * 60 ))
TOKEN_TIME=$(date +%s)
EVENT_NUM=0

while [ "$(date +%s)" -lt "$END_TIME" ]; do
  # Refresh token every 20 minutes
  NOW=$(date +%s)
  if [ $(( NOW - TOKEN_TIME )) -gt 1200 ]; then
    TOKEN=$(get_token) || { echo "WARN: Token refresh failed, using old token"; }
    TOKEN_TIME=$NOW
  fi

  # Pick attack profile
  PROFILE=$(pick_attack)
  IFS=':' read -r CATEGORY SUBCATEGORY MIN_CONF MAX_CONF _WEIGHT <<< "$PROFILE"

  # Generate confidence (random between min and max)
  CONF_INT=$(rand_range $(echo "$MIN_CONF * 100" | bc | cut -d. -f1) $(echo "$MAX_CONF * 100" | bc | cut -d. -f1))
  CONFIDENCE=$(awk "BEGIN {printf \"%.2f\", ${CONF_INT}/100}")

  # Pick random attacker and honeypot
  SRC_IP=$(pick "${ATTACKER_IPS[@]}")
  HP_IDX=$(( RANDOM % ${#HONEYPOT_IPS[@]} ))
  DST_IP="${HONEYPOT_IPS[$HP_IDX]}"
  DST_PORT="${HONEYPOT_PORTS[$HP_IDX]}"
  SRC_PORT=$(rand_range 1024 65535)

  # Generate event ID
  EVENT_NUM=$((EVENT_NUM + 1))
  EVENT_ID="demo-$(date +%s)-${EVENT_NUM}"
  TIMESTAMP=$(($(date +%s) * 1000))

  # Determine tier for display
  if (( $(echo "$CONFIDENCE > 0.85" | bc -l) )); then
    TIER="ACT"
  elif (( $(echo "$CONFIDENCE > 0.60" | bc -l) )); then
    TIER="RECOMMEND"
  else
    TIER="OBSERVE"
  fi

  # Remaining time
  REMAINING=$(( (END_TIME - $(date +%s)) / 60 ))

  # Inject
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "${CITADEL}/api/v1/events/ingest" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d "{
      \"eventId\": \"${EVENT_ID}\",
      \"timestamp\": ${TIMESTAMP},
      \"sourceIp\": \"${SRC_IP}\",
      \"sourcePort\": ${SRC_PORT},
      \"destIp\": \"${DST_IP}\",
      \"destPort\": ${DST_PORT},
      \"protocol\": \"TCP\",
      \"category\": \"${CATEGORY}\",
      \"subcategory\": \"${SUBCATEGORY}\",
      \"confidence\": ${CONFIDENCE},
      \"sourceComponent\": \"demo\"
    }")

  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    INJECTED_IDS+=("$EVENT_ID")
    echo "[$(date +%H:%M:%S)] #${EVENT_NUM} ${CATEGORY}/${SUBCATEGORY} → ${DST_IP} from ${SRC_IP} (conf=${CONFIDENCE}, tier=${TIER}) ✓  [${REMAINING}m left]"
  else
    echo "[$(date +%H:%M:%S)] #${EVENT_NUM} FAILED (HTTP ${HTTP_CODE}) ${CATEGORY} → ${DST_IP}"
  fi

  # Random sleep between events
  SLEEP=$(rand_range $MIN_INTERVAL $MAX_INTERVAL)
  sleep "$SLEEP"
done

echo ""
echo "Duration complete. Cleaning up..."
