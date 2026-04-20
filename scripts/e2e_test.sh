#!/usr/bin/env bash
# End-to-end integration test for the Providence pipeline.
# Validates: Eye → ML Service → Eye → Citadel → PostgreSQL
set -euo pipefail

echo "=== Providence E2E Test ==="

# 1. Start infrastructure
echo "[1/8] Starting PostgreSQL + Redis + Citadel..."
docker compose up -d postgres redis citadel
sleep 10

# 2. Start ML inference server
echo "[2/8] Starting ML inference server..."
python -m src.server --socket-path /tmp/providence_ml.sock &
ML_PID=$!
sleep 3

# 3. Start The Eye on loopback
echo "[3/8] Starting The Eye on loopback..."
IFACE="lo0"
if [[ "$(uname)" == "Linux" ]]; then
    IFACE="lo"
fi
./eye/build/eye "$IFACE" --citadel localhost:50051 --ml-socket /tmp/providence_ml.sock &
EYE_PID=$!
sleep 2

# 4. Generate test traffic
echo "[4/8] Generating test traffic..."
curl -s http://example.com > /dev/null 2>&1 || true
# Simulated port scan (connect to a few ports)
for port in 22 80 443 8080 8443; do
    (echo > /dev/tcp/127.0.0.1/$port) 2>/dev/null || true
done

# 5. Wait for flows to complete
echo "[5/8] Waiting 15s for flow completion and classification..."
sleep 15

# 6. Stop The Eye
echo "[6/8] Stopping The Eye..."
kill -INT $EYE_PID 2>/dev/null || true
wait $EYE_PID 2>/dev/null || true

# 7. Query Citadel
echo "[7/8] Querying Citadel REST API..."
RESPONSE=$(curl -s http://localhost:8080/api/v1/events)
EVENT_COUNT=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('totalElements', 0))" 2>/dev/null || echo "0")

echo "Events in Citadel: $EVENT_COUNT"

# 8. Cleanup
echo "[8/8] Cleaning up..."
kill $ML_PID 2>/dev/null || true
docker compose down

if [ "$EVENT_COUNT" -gt 0 ]; then
    echo ""
    echo "✓ E2E test PASSED — $EVENT_COUNT events classified and stored"
    exit 0
else
    echo ""
    echo "✗ E2E test FAILED — no events found in Citadel"
    echo "  (This may be expected if no classifiable traffic was generated on loopback)"
    exit 1
fi
