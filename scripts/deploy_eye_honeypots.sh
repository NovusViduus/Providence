#!/usr/bin/env bash
#
# Deploy The Eye + ML Service to all 3 honeypot EC2 instances.
# Captures real attacker traffic, extracts flow features, classifies, exports JSON.
#
# Prerequisites:
#   - SSH key at ~/.ssh/providence_honeypot
#   - Trained models in ml/models/saved/
#   - Docker installed on each EC2 (or we install it)
#
# Usage:
#   ./scripts/deploy_eye_honeypots.sh deploy    # Push files + start Eye on all 3
#   ./scripts/deploy_eye_honeypots.sh collect   # Download flow_export.json from all 3
#   ./scripts/deploy_eye_honeypots.sh stop      # Stop Eye on all 3
#   ./scripts/deploy_eye_honeypots.sh status    # Check if Eye is running on all 3

set -euo pipefail

SSH_KEY="$HOME/.ssh/providence_honeypot"
SSH_PORT=62222
SSH_OPTS="-i $SSH_KEY -p $SSH_PORT -o StrictHostKeyChecking=no -o ConnectTimeout=15 -o ServerAliveInterval=30"

# Your 3 honeypot instances
HOSTS=(
  "54.91.174.191"     # LURE-SSH-US (us-east-1)
  "3.253.60.6"         # LURE-SSH-EU (eu-west-1)
  "3.0.102.2"         # LURE-SSH-AP (ap-southeast-1)
)
NAMES=(
  "lure-us"
  "lure-eu"
  "lure-ap"
)

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_DIR="/home/ubuntu/providence-eye"
COLLECT_DIR="$PROJECT_DIR/data/eye-captures"

log() { echo "[$(date +%H:%M:%S)] $*"; }

# ─── DEPLOY ───────────────────────────────────────────────────────────────────

do_deploy() {
  log "Packaging Eye + ML for deployment..."

  # Create a lightweight deployment bundle
  BUNDLE_DIR=$(mktemp -d)
  trap "rm -rf $BUNDLE_DIR" EXIT

  # ML server + models (the minimal set)
  mkdir -p "$BUNDLE_DIR/ml/src" "$BUNDLE_DIR/ml/models/saved" "$BUNDLE_DIR/proto"

  # Copy ML source files needed for inference
  cp "$PROJECT_DIR/ml/src/__init__.py" "$BUNDLE_DIR/ml/src/"
  cp "$PROJECT_DIR/ml/src/server.py" "$BUNDLE_DIR/ml/src/"
  cp -r "$PROJECT_DIR/ml/src/models" "$BUNDLE_DIR/ml/src/"
  cp -r "$PROJECT_DIR/ml/src/features" "$BUNDLE_DIR/ml/src/"
  cp -r "$PROJECT_DIR/ml/src/data" "$BUNDLE_DIR/ml/src/"
  cp "$PROJECT_DIR/ml/pyproject.toml" "$BUNDLE_DIR/ml/"

  # Copy trained model artifacts (exclude RF — too large for t3.micro, LightGBM is better)
  for f in "$PROJECT_DIR/ml/models/saved/"*.joblib; do
    case "$(basename "$f")" in
      random_forest_*) echo "  Skipping $(basename "$f") (too large for t3.micro)" ;;
      *) cp "$f" "$BUNDLE_DIR/ml/models/saved/" ;;
    esac
  done
  ls "$BUNDLE_DIR/ml/models/saved/"*.joblib >/dev/null 2>&1 || {
    log "ERROR: No trained models found in ml/models/saved/. Train first!"
    exit 1
  }

  # Copy proto files
  cp "$PROJECT_DIR/proto/"*.proto "$BUNDLE_DIR/proto/"

  # Create a simple startup script — battle-tested on t3.micro (1GB RAM, 8GB disk)
  cat > "$BUNDLE_DIR/start.sh" << 'STARTUP'
#!/bin/bash
set -e
cd /home/ubuntu/providence-eye

echo "[$(date)] ── Step 1/7: Free disk space ──"
# Remove the 107MB RF model — LightGBM (592K) is better anyway
rm -f ml/models/saved/random_forest_intersection_v1.joblib
# Clear apt cache and old journals
sudo apt-get clean 2>/dev/null || true
sudo journalctl --vacuum-size=10M 2>/dev/null || true
echo "[$(date)] Disk: $(df -h / | tail -1 | awk '{print $4}') free"

echo "[$(date)] ── Step 2/7: Add swap (t3.micro needs it for C++ compilation) ──"
if ! swapon --show | grep -q /swapfile; then
  sudo swapoff /swapfile 2>/dev/null || true
  sudo rm -f /swapfile
  sudo fallocate -l 256M /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo "[$(date)] 256MB swap enabled"
else
  echo "[$(date)] Swap already active"
fi

echo "[$(date)] ── Step 3/7: Install system dependencies ──"
sudo apt-get update -qq
sudo apt-get install -y -qq python3-pip python3-venv protobuf-compiler libprotobuf-dev libpcap-dev cmake build-essential libssl-dev pkg-config > /dev/null 2>&1
echo "[$(date)] System deps installed"

echo "[$(date)] ── Step 4/7: Python venv + ML deps ──"
if [ ! -d "ml/.venv" ]; then
  python3 -m venv ml/.venv
fi
source ml/.venv/bin/activate
pip install -q scikit-learn xgboost lightgbm numpy pandas joblib protobuf
echo "[$(date)] Python deps installed"

echo "[$(date)] ── Step 5/7: Generate proto stubs + start ML server ──"
mkdir -p ml/src/proto
protoc --python_out=ml/src/proto/ -Iproto/ proto/*.proto
touch ml/src/proto/__init__.py
# Symlink so 'from proto import features_pb2' works from ml/ directory
ln -sf /home/ubuntu/providence-eye/ml/src/proto /home/ubuntu/providence-eye/ml/proto

cd ml
# PYTHONPATH includes src/proto so protobuf cross-imports resolve
PYTHONPATH=/home/ubuntu/providence-eye/ml:/home/ubuntu/providence-eye/ml/src/proto \
  nohup python -m src.server --socket-path /tmp/providence_ml.sock > /home/ubuntu/ml_server.log 2>&1 &
ML_PID=$!
echo $ML_PID > /home/ubuntu/ml_server.pid
cd ..

sleep 3
if kill -0 $ML_PID 2>/dev/null; then
  echo "[$(date)] ML server running (PID $ML_PID)"
else
  echo "[$(date)] ERROR: ML server failed. Log:"
  cat /home/ubuntu/ml_server.log
  exit 1
fi

echo "[$(date)] ── Step 6/7: Build The Eye (single-threaded to avoid OOM) ──"
if [ ! -f "eye/build/eye" ]; then
  cd eye
  rm -rf build
  cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTS=OFF -DBUILD_BENCHMARKS=OFF 2>&1
  # -j1 is critical on t3.micro — parallel compilation OOMs with 1GB RAM
  cmake --build build -j1 2>&1
  cd ..
  if [ ! -f "eye/build/eye" ]; then
    echo "[$(date)] ERROR: Eye build failed!"
    exit 1
  fi
  echo "[$(date)] Eye built successfully"
else
  echo "[$(date)] Eye already built, skipping"
fi

echo "[$(date)] ── Step 7/7: Start The Eye ──"
# Kill any existing Eye process
if [ -f /home/ubuntu/eye.pid ]; then
  sudo kill -INT $(cat /home/ubuntu/eye.pid) 2>/dev/null || true
  sudo rm -f /home/ubuntu/eye.pid
fi
IFACE=$(ip route | grep default | awk '{print $5}' | head -1)
echo "[$(date)] Capturing on interface $IFACE"
sudo nohup ./eye/build/eye "$IFACE" --ml-socket /tmp/providence_ml.sock > /home/ubuntu/eye.log 2>&1 &
EYE_PID=$!
sudo bash -c "echo $EYE_PID > /home/ubuntu/eye.pid"

sleep 5
if sudo kill -0 $EYE_PID 2>/dev/null; then
  echo "[$(date)] ✓ Eye running (PID $EYE_PID)"
  # Verify ML connection after a few seconds
  sleep 10
  if grep -q "CLASSIFY" /home/ubuntu/eye.log 2>/dev/null; then
    echo "[$(date)] ✓ ML classification working"
  else
    echo "[$(date)] ⚠ Eye running but no classifications yet (may need more traffic)"
  fi
else
  echo "[$(date)] ERROR: Eye failed to start. Log:"
  tail -20 /home/ubuntu/eye.log
  exit 1
fi

echo "[$(date)] ══════════════════════════════════════"
echo "[$(date)] ✓ DEPLOYMENT COMPLETE"
echo "[$(date)]   ML:  PID $ML_PID (LightGBM)"
echo "[$(date)]   Eye: PID $EYE_PID on $IFACE"
echo "[$(date)]   Logs: ~/eye.log, ~/ml_server.log"
echo "[$(date)]   Collect: ./scripts/deploy_eye_honeypots.sh collect"
echo "[$(date)] ══════════════════════════════════════"
STARTUP
  chmod +x "$BUNDLE_DIR/start.sh"

  # Create stop script
  cat > "$BUNDLE_DIR/stop.sh" << 'STOPSCRIPT'
#!/bin/bash
echo "[$(date)] Stopping The Eye..."
if [ -f /home/ubuntu/eye.pid ]; then
  sudo kill -INT $(cat /home/ubuntu/eye.pid) 2>/dev/null || true
  rm /home/ubuntu/eye.pid
fi
echo "[$(date)] Stopping ML server..."
if [ -f /home/ubuntu/ml_server.pid ]; then
  kill $(cat /home/ubuntu/ml_server.pid) 2>/dev/null || true
  rm /home/ubuntu/ml_server.pid
fi
echo "[$(date)] Stopped."
STOPSCRIPT
  chmod +x "$BUNDLE_DIR/stop.sh"

  # Include Eye source for building on the EC2 (no tests/benchmarks — skip for deploy)
  mkdir -p "$BUNDLE_DIR/eye/src"
  cp "$PROJECT_DIR/eye/CMakeLists.txt" "$BUNDLE_DIR/eye/"
  cp -r "$PROJECT_DIR/eye/src/"* "$BUNDLE_DIR/eye/src/"

  # Deploy to each host
  for i in "${!HOSTS[@]}"; do
    HOST="${HOSTS[$i]}"
    NAME="${NAMES[$i]}"
    log "Deploying to $NAME ($HOST)..."

    # Create remote directory
    ssh $SSH_OPTS ubuntu@$HOST "mkdir -p $REMOTE_DIR/eye/src $REMOTE_DIR/ml $REMOTE_DIR/proto" 2>/dev/null

    # Sync bundle
    rsync -az --progress -e "ssh $SSH_OPTS" \
      "$BUNDLE_DIR/" ubuntu@$HOST:$REMOTE_DIR/ 2>/dev/null

    log "Starting Eye on $NAME..."
    ssh $SSH_OPTS ubuntu@$HOST "cd $REMOTE_DIR && bash start.sh" 2>&1 | while read line; do
      echo "  [$NAME] $line"
    done &

    log "$NAME deployment started (backgrounded)"
  done

  wait
  log "All 3 honeypots deployed. Eye is capturing."
  log "Let it run overnight, then: ./scripts/deploy_eye_honeypots.sh collect"
}

# ─── COLLECT ──────────────────────────────────────────────────────────────────

do_collect() {
  mkdir -p "$COLLECT_DIR"
  log "Collecting flow exports from all honeypots..."

  for i in "${!HOSTS[@]}"; do
    HOST="${HOSTS[$i]}"
    NAME="${NAMES[$i]}"
    log "Collecting from $NAME ($HOST)..."

    # Stop Eye gracefully (SIGINT triggers export)
    ssh $SSH_OPTS ubuntu@$HOST "cd $REMOTE_DIR && bash stop.sh" 2>/dev/null || true

    sleep 3

    # Download flow_export.json and dns_export.json
    scp $SSH_OPTS ubuntu@$HOST:$REMOTE_DIR/flow_export.json \
      "$COLLECT_DIR/${NAME}_flow_export.json" 2>/dev/null && \
      log "  ✓ ${NAME}_flow_export.json downloaded" || \
      log "  ✗ No flow_export.json on $NAME"

    scp $SSH_OPTS ubuntu@$HOST:$REMOTE_DIR/dns_export.json \
      "$COLLECT_DIR/${NAME}_dns_export.json" 2>/dev/null && \
      log "  ✓ ${NAME}_dns_export.json downloaded" || \
      log "  ✗ No dns_export.json on $NAME"

    # Also grab logs
    scp $SSH_OPTS ubuntu@$HOST:/home/ubuntu/eye.log \
      "$COLLECT_DIR/${NAME}_eye.log" 2>/dev/null || true
    scp $SSH_OPTS ubuntu@$HOST:/home/ubuntu/ml_server.log \
      "$COLLECT_DIR/${NAME}_ml_server.log" 2>/dev/null || true
  done

  log "All exports collected to $COLLECT_DIR/"
  ls -lh "$COLLECT_DIR/"

  # Count flows
  TOTAL=0
  for f in "$COLLECT_DIR"/*_flow_export.json; do
    if [ -f "$f" ]; then
      COUNT=$(python3 -c "import json; print(len(json.load(open('$f'))))" 2>/dev/null || echo 0)
      log "  $(basename $f): $COUNT flows"
      TOTAL=$((TOTAL + COUNT))
    fi
  done
  log "Total flows captured: $TOTAL"
}

# ─── STATUS ───────────────────────────────────────────────────────────────────

do_status() {
  for i in "${!HOSTS[@]}"; do
    HOST="${HOSTS[$i]}"
    NAME="${NAMES[$i]}"
    echo -n "[$NAME] $HOST: "
    ssh $SSH_OPTS ubuntu@$HOST "
      if [ -f /home/ubuntu/eye.pid ] && kill -0 \$(cat /home/ubuntu/eye.pid) 2>/dev/null; then
        echo 'Eye RUNNING (PID '\$(cat /home/ubuntu/eye.pid)')'
      else
        echo 'Eye NOT RUNNING'
      fi
      if [ -f /home/ubuntu/ml_server.pid ] && kill -0 \$(cat /home/ubuntu/ml_server.pid) 2>/dev/null; then
        echo '         ML  RUNNING (PID '\$(cat /home/ubuntu/ml_server.pid)')'
      else
        echo '         ML  NOT RUNNING'
      fi
      if [ -f $REMOTE_DIR/flow_export.json ]; then
        echo '         Flows: '\$(python3 -c \"import json; print(len(json.load(open('$REMOTE_DIR/flow_export.json'))))\" 2>/dev/null || echo '?')
      fi
    " 2>/dev/null || echo "UNREACHABLE"
  done
}

# ─── STOP ─────────────────────────────────────────────────────────────────────

do_stop() {
  for i in "${!HOSTS[@]}"; do
    HOST="${HOSTS[$i]}"
    NAME="${NAMES[$i]}"
    log "Stopping $NAME ($HOST)..."
    ssh $SSH_OPTS ubuntu@$HOST "cd $REMOTE_DIR && bash stop.sh" 2>/dev/null || true
  done
  log "All stopped."
}

# ─── MAIN ─────────────────────────────────────────────────────────────────────

case "${1:-help}" in
  deploy)  do_deploy ;;
  collect) do_collect ;;
  status)  do_status ;;
  stop)    do_stop ;;
  *)
    echo "Usage: $0 {deploy|collect|status|stop}"
    echo ""
    echo "  deploy   Push Eye + ML to all 3 honeypots and start capturing"
    echo "  collect  Stop Eye, download flow_export.json from all 3"
    echo "  status   Check if Eye is running on each honeypot"
    echo "  stop     Stop Eye on all 3 honeypots"
    ;;
esac
