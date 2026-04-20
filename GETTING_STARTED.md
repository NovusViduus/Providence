# Getting Started with Providence

Everything you need to go from a fresh clone to a running platform.

---

## Prerequisites

You need these installed:

| Tool | Version | Check |
|---|---|---|
| Docker | 24+ | `docker --version` |
| Docker Compose | v2+ | `docker compose version` |
| Git | any | `git --version` |

Optional (for local development outside Docker):

| Tool | For | Check |
|---|---|---|
| Java 21 | Citadel | `java --version` |
| Maven | Citadel | `mvn --version` |
| Python 3.12 | ML / Oracle | `python3 --version` |
| Node 20 | Lens / Ward | `node --version` |
| CMake + libpcap | Eye | `cmake --version` |
| Chrome | Ward extension | — |

---

## 1. Clone and Start the Stack

```bash
git clone https://github.com/NovusViduus/Providence.git
cd Providence
docker compose up --build
```

This starts 6 services:

| Service | Port | What It Does |
|---|---|---|
| **postgres** | 5432 | PostgreSQL 16 — event storage |
| **redis** | 6379 | Pub/sub + active threat cache |
| **citadel** | 8080 (REST/WS), 50051 (gRPC) | Backend API + response engine |
| **ml-service** | — (Unix socket) | ML classification server |
| **lens** | 3000 | Dashboard UI |
| **oracle** | — | Cloud agent (no-op without AWS creds) |

First build takes 3-5 minutes (downloading base images, Maven deps, npm packages). Subsequent starts are fast.

Wait until you see all services healthy. You can check with:

```bash
docker compose ps
```

---

## 2. Open the Dashboard

Go to **http://localhost:3000**

You'll see the login page. Two accounts are available:

| Username | Password | Role | Can Do |
|---|---|---|---|
| `admin` | `admin` | Admin | Everything — approve/reject, unblock, edit playbooks |
| `viewer` | `viewer` | Viewer | Read-only — see events, stats, globe, but no mutations |

Log in as `admin` to see the full experience.

---

## 3. Verify Everything Is Running

After login you should see the Overview page with stat cards (all zeros — no events yet). Quick health checks:

```bash
# Citadel health
curl http://localhost:8080/actuator/health

# Citadel API
curl http://localhost:8080/api/v1/events/stats

# Lens serves
curl -s http://localhost:3000 | head -5
```

---

## 4. Generate Some Events

Without The Eye running, the dashboard is empty. You have two options:

### Option A: Inject test events via REST (no Eye needed)

```bash
# Get a JWT token
TOKEN=$(curl -s http://localhost:8080/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Inject a DOS event
curl -X POST http://localhost:8080/api/v1/events/ingest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "eventId": "test-dos-001",
    "timestamp": '$(date +%s000)',
    "sourceIp": "185.220.101.34",
    "sourcePort": 54321,
    "destIp": "10.0.1.5",
    "destPort": 443,
    "protocol": "TCP",
    "category": "DOS",
    "subcategory": "syn_flood",
    "confidence": 0.92,
    "sourceComponent": "eye"
  }'

# Inject a BRUTE_FORCE event (RECOMMEND tier)
curl -X POST http://localhost:8080/api/v1/events/ingest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "eventId": "test-brute-001",
    "timestamp": '$(date +%s000)',
    "sourceIp": "203.0.113.42",
    "sourcePort": 12345,
    "destIp": "10.0.1.5",
    "destPort": 22,
    "protocol": "TCP",
    "category": "BRUTE_FORCE",
    "subcategory": "ssh",
    "confidence": 0.72,
    "sourceComponent": "eye"
  }'

# Inject a PROBE event (OBSERVE tier)
curl -X POST http://localhost:8080/api/v1/events/ingest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "eventId": "test-probe-001",
    "timestamp": '$(date +%s000)',
    "sourceIp": "198.51.100.1",
    "sourcePort": 0,
    "destIp": "10.0.1.5",
    "destPort": 80,
    "protocol": "TCP",
    "category": "PROBE",
    "subcategory": "port_scan",
    "confidence": 0.45,
    "sourceComponent": "eye"
  }'
```

Refresh the dashboard — you should see:
- 3 events in the AttackFeed
- Stats cards showing counts
- The DOS event triggered an ACT-tier response (check ResponseLog)
- The BRUTE_FORCE event is pending approval (check Incidents)

### Option B: Run The Eye for live capture (requires local build)

```bash
# Build The Eye (needs cmake, libpcap-dev, libssl-dev, protobuf-compiler)
cd eye
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j$(nproc)

# Run on loopback (captures your own traffic)
sudo ./build/eye lo0 --citadel localhost:50051 --ml-socket /tmp/providence_ml.sock
# On Linux: sudo ./build/eye lo
```

Then generate traffic in another terminal:

```bash
curl http://example.com
curl http://httpbin.org/get
```

Events will flow: Eye → ML Service → Eye → Citadel → Dashboard.

---

## 5. Explore the Dashboard

Now that you have events, walk through each page:

| Page | What to Look For |
|---|---|
| **Overview** | Stat cards, category pie chart, tier bar chart, timeline |
| **Events** | Live feed with filters (category, tier, confidence, IP). Click a row for detail. |
| **Incidents** | Pending approvals. Click "Approve" on the BRUTE_FORCE event to execute the block. |
| **Responses** | Active blocks with countdown timers. Action history table. |
| **Threats** | 3D globe. If you injected events with real public IPs, markers appear at their geo locations. Hover for tooltips. Drag to rotate, scroll to zoom. |
| **Playbooks** | 13 playbooks. Click "Edit" to change confidence thresholds or TTL. |
| **Metrics** | Classification stats, rejected recommendations count, AI agent detections. |

---

## 6. Try the Ward Extension (Optional)

```bash
cd ward
npm install
npm run build
```

1. Open `chrome://extensions`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked" → select the `ward/dist/` folder
4. Browse to any website — the extension icon shows a green/yellow/red badge
5. Click the icon to see the threat score and reasons
6. Try visiting a suspicious-looking domain — the score goes up

To connect Ward to your running Citadel:
1. Click the extension icon → "Settings" link at the bottom
2. Enter Citadel URL: `http://localhost:8080`
3. For the JWT, use the token from step 4 above
4. Click "Test Connection" → should show ✓
5. Click "Connect"

Now Ward events appear in the Lens dashboard with a shield icon.

---

## 7. Enable Cloud Monitoring (Optional, needs AWS)

Create a `.env` file in the project root:

```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
FLOW_LOG_BUCKET=your-flow-log-bucket
CLOUDTRAIL_BUCKET=your-cloudtrail-bucket
```

Then restart:

```bash
docker compose up --build oracle
```

The Oracle will poll your S3 buckets for VPC Flow Logs and CloudTrail events. Cloud events appear in the dashboard with a cloud icon.

Without AWS credentials, the Oracle runs in no-op mode (logs a warning, doesn't crash).

---

## 8. Shut Down

```bash
docker compose down        # stop services, keep data
docker compose down -v     # stop services AND delete database/redis data
```

---

## Ports Summary

| Port | Service | Protocol |
|---|---|---|
| 3000 | Lens dashboard | HTTP |
| 8080 | Citadel REST + WebSocket | HTTP/WS |
| 50051 | Citadel gRPC | gRPC |
| 5432 | PostgreSQL | TCP |
| 6379 | Redis | TCP |

---

## Troubleshooting

**"Cannot connect to the Docker daemon"**
→ Start Docker Desktop (macOS) or `sudo systemctl start docker` (Linux).

**Citadel fails to start with "Connection refused" to postgres**
→ PostgreSQL takes a few seconds to initialize. Docker Compose health checks handle this, but if you see it, just wait and it'll retry.

**Lens shows "Disconnected" in the header**
→ The WebSocket connection to Citadel failed. Check that Citadel is running: `docker compose ps citadel`. The Lens auto-reconnects with exponential backoff.

**Eye can't open capture device**
→ Needs root/sudo. On macOS: `sudo ./build/eye en0`. On Linux: `sudo ./build/eye eth0`.

**Ward extension doesn't load**
→ Make sure you ran `npm run build` in `ward/` and loaded the `dist/` directory (not `ward/` itself).

**Oracle logs "No AWS credentials configured"**
→ Expected without a `.env` file. It runs in no-op mode. Set up AWS credentials per step 7 to enable cloud monitoring.

---

## What's Next

- Run benchmarks: `cd eye/build && ./benchmarks/throughput_bench`
- Train ML models: `cd ml && python -m src.training.train_classifier --data-dir /path/to/cicids`
- Record a demo video following [docs/DEMO.md](docs/DEMO.md)
- Read the architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
