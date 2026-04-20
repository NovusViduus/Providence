# Providence — Demo Guide

Step-by-step instructions for reproducing the full pipeline demo.

## Prerequisites

- Docker and Docker Compose
- (Optional) The Eye binary built locally for live capture
- (Optional) The Ward extension loaded in Chrome

## Steps

### 1. Start the stack

```bash
docker-compose up --build
```

Wait for all services to be healthy (~30 seconds). You should see Citadel, PostgreSQL, Redis, ML service, and Lens all running.

### 2. Open the dashboard

Navigate to `http://localhost:3000`. Login with:
- Username: `admin`
- Password: `admin`

You should see the Overview page with stat cards and empty charts.

### 3. Start The Eye (optional — live capture)

```bash
# macOS
sudo ./eye/build/eye lo0 --citadel localhost:50051 --ml-socket /tmp/providence_ml.sock

# Linux
sudo ./eye/build/eye lo --citadel localhost:50051 --ml-socket /tmp/providence_ml.sock
```

### 4. Generate test traffic

```bash
# Benign HTTP
curl http://example.com

# Simulated port scan
for port in 22 80 443 8080 8443; do
  (echo > /dev/tcp/127.0.0.1/$port) 2>/dev/null || true
done

# Simulated brute force (rapid connections)
for i in $(seq 1 20); do
  ssh -o ConnectTimeout=1 -o StrictHostKeyChecking=no test@127.0.0.1 2>/dev/null &
done
```

### 5. Watch events in real-time

- AttackFeed: events appear as they're classified
- Globe: threat markers appear at source IP locations
- StatsOverview: counters update

### 6. See automated responses

- Events with confidence > 0.85 trigger ACT tier
- ResponseLog shows active blocks with countdown timers
- IncidentDetail shows the playbook that was matched

### 7. Manual override

- Navigate to Incidents page
- Find a RECOMMEND-tier event (confidence 0.60-0.85)
- Click "Approve" to execute the pending action
- Or "Reject" to dismiss

### 8. Playbook configuration

- Navigate to Playbooks page
- Edit a playbook's confidence threshold or TTL
- Changes take effect immediately

### 9. (Optional) The Ward extension

1. Build: `cd ward && npm install && npm run build`
2. Load unpacked in `chrome://extensions` → `ward/dist/`
3. Visit a test page — popup shows threat score
4. Visit a known phishing domain — warning banner appears
5. In Settings, connect to `http://localhost:8080` with admin JWT
6. Ward events appear in the Lens dashboard with shield icon

### 10. Cleanup

```bash
docker-compose down -v
```
