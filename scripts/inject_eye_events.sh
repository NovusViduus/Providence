#!/usr/bin/env bash
# Inject real Eye classification events from honeypot logs into the running Citadel.
# Maps private dest IPs to actual honeypot public IPs for geo-location.
# Usage: ./scripts/inject_eye_events.sh

set -euo pipefail

CITADEL="http://localhost:8080"
LOG_DIR="data/eye-captures"

# Map region to honeypot public IP
get_dest_ip() {
  case "$1" in
    lure-us) echo "54.91.174.191" ;;
    lure-eu) echo "3.253.60.6" ;;
    lure-ap) echo "3.0.102.2" ;;
    *) echo "10.0.1.5" ;;
  esac
}

echo "Getting auth token..."
TOKEN=$(curl -s "$CITADEL/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

if [ -z "$TOKEN" ] || [ "$TOKEN" = "None" ]; then
  echo "ERROR: Failed to get auth token. Is Citadel running?"
  exit 1
fi

echo "Parsing Eye logs and injecting events..."

TOTAL=0
ERRORS=0

for LOG_FILE in "$LOG_DIR"/*_eye.log; do
  REGION=$(basename "$LOG_FILE" | sed 's/_eye.log//')
  DEST_IP=$(get_dest_ip "$REGION")
  echo "Processing $REGION (dest=$DEST_IP)..."

  COUNT=0

  grep "\[CLASSIFY\]" "$LOG_FILE" | grep -v "169.254.169.254" | while IFS= read -r line; do
    # Parse: [CLASSIFY] 107.173.182.172:49006 <-> 172.31.21.11:22 → EXFILTRATION (1.000)
    SRC=$(echo "$line" | sed 's/.*\[CLASSIFY\] //' | sed 's/ <->.*//')
    DST=$(echo "$line" | sed 's/.*<-> //' | sed 's/ →.*//')
    CAT=$(echo "$line" | sed 's/.*→ //' | sed 's/ (.*//')
    CONF=$(echo "$line" | sed 's/.*(//' | sed 's/)//')

    SRC_IP=$(echo "$SRC" | cut -d: -f1)
    SRC_PORT=$(echo "$SRC" | cut -d: -f2)
    DST_PORT=$(echo "$DST" | cut -d: -f2)

    # Skip private/local source IPs
    case "$SRC_IP" in
      10.*|172.16.*|172.17.*|172.18.*|172.19.*|172.2*|172.30.*|172.31.*|192.168.*|129.10.*) continue ;;
    esac

    EVENT_ID="${REGION}-${SRC_IP}-${SRC_PORT}-${DST_PORT}-$(date +%s%N | tail -c 6)"

    curl -s -o /dev/null -w "" -X POST "$CITADEL/api/v1/events/ingest" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d "{
        \"eventId\":\"$EVENT_ID\",
        \"timestamp\":$(date +%s000),
        \"sourceIp\":\"$SRC_IP\",
        \"sourcePort\":$SRC_PORT,
        \"destIp\":\"$DEST_IP\",
        \"destPort\":$DST_PORT,
        \"protocol\":\"TCP\",
        \"category\":\"$CAT\",
        \"subcategory\":\"honeypot\",
        \"confidence\":$CONF,
        \"sourceComponent\":\"eye\"
      }" 2>/dev/null || true

    COUNT=$((COUNT + 1))
    # Progress every 100
    if [ $((COUNT % 100)) -eq 0 ]; then
      echo "  $REGION: $COUNT events injected..."
    fi
  done

  echo "  $REGION done"
done

echo ""
echo "Injection complete. Refresh http://localhost:5173/threats"
