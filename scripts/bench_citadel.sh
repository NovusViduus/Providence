#!/usr/bin/env bash
# Citadel REST API latency benchmark
set -euo pipefail

URL="${CITADEL_URL:-http://localhost:8080}"
TOKEN="${CITADEL_JWT:-}"
AUTH=""
if [ -n "$TOKEN" ]; then AUTH="-H 'Authorization: Bearer $TOKEN'"; fi

echo "=== Citadel REST Benchmark ==="
echo "Target: $URL"
echo ""

# GET /api/v1/events — 100 requests
echo "GET /api/v1/events (100 requests):"
for i in $(seq 1 100); do
  curl -s -o /dev/null -w "%{time_total}\n" "$URL/api/v1/events?size=10" $AUTH
done | sort -n | awk '
  { a[NR]=$1; sum+=$1 }
  END {
    printf "  p50: %.0fms\n", a[int(NR*0.5)]*1000
    printf "  p99: %.0fms\n", a[int(NR*0.99)]*1000
    printf "  avg: %.0fms\n", (sum/NR)*1000
  }'

echo ""
echo "GET /api/v1/events/stats (100 requests):"
for i in $(seq 1 100); do
  curl -s -o /dev/null -w "%{time_total}\n" "$URL/api/v1/events/stats" $AUTH
done | sort -n | awk '
  { a[NR]=$1; sum+=$1 }
  END {
    printf "  p50: %.0fms\n", a[int(NR*0.5)]*1000
    printf "  p99: %.0fms\n", a[int(NR*0.99)]*1000
  }'

echo ""
echo "Done."
