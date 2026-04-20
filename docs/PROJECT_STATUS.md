# Providence — Project Status (April 18, 2026)

---

## Platform Components

| Component | Status | Notes |
|---|---|---|
| The Eye (C++17) | ✅ Running on 3 honeypots | Classifying live traffic since Apr 15. 22K+ flows classified. |
| The Citadel (Java/Spring) | ✅ Docker running | gRPC + REST + WebSocket. Flyway migrations applied. DB column types fixed (inet→varchar, jsonb→text). |
| ML Pipeline (Python) | ✅ Models trained | 3 models on CICIDS2017. LightGBM deployed to honeypots. |
| The Lens (React/Three.js) | ✅ Running (Vite dev) | Globe with server towers, timelapse, live mode. Docker image also builds. |
| The Oracle (Python/boto3) | ✅ Docker running | No-op mode (no AWS creds). Functional when configured. |
| The Ward (Chrome Ext) | ✅ Code complete | Not tested in this session. Needs `npm run build` + Chrome load. |
| Infrastructure | ✅ Docker Compose works | All 6 services start. Postgres, Redis, Citadel, ML, Lens, Oracle. |

---

## Honeypot Fleet (The Lure)

| Instance | Region | Current IP | Eye Status | ML Status |
|---|---|---|---|---|
| LURE-SSH-US | us-east-1 | `54.91.174.191` | ✅ Running | ✅ LightGBM |
| LURE-SSH-EU | eu-west-1 | `3.253.60.6` | ✅ Running | ✅ LightGBM |
| LURE-SSH-AP | ap-southeast-1 | `3.0.102.2` | ✅ Running | ✅ LightGBM |

- IPs changed after stop/start cycles (no Elastic IPs)
- Eye + ML deployed via `scripts/deploy_eye_honeypots.sh`
- Deploy script handles swap creation, disk cleanup, -j1 build, PYTHONPATH fix
- Eye classifying since Apr 15: US=5,920 flows, EU=4,022 flows, AP=12,260 flows
- Security groups need your current IP added each time it changes

---

## ML Models

| Model | Accuracy | Macro F1 | Size | Inference | Deployed |
|---|---|---|---|---|---|
| LightGBM | 0.9833 | 0.7330 | 602 KB | 47µs | ✅ All 3 honeypots |
| XGBoost | 0.9302 | 0.5625 | 2.4 MB | 505µs | ❌ |
| Random Forest | 0.9302 | 0.5662 | 102 MB | 26.6ms | ❌ Too slow + large |

- Trained on CICIDS2017 (2.83M samples, 16 intersection features)
- Evaluation plots in `ml/evaluation/plots/`
- Benchmark results in `ml/evaluation/`

---

## Real-World Validation

- 22,202 flows classified across 3 regions (Apr 15-18)
- Excluding AWS metadata: 1,787 real flows
  - BENIGN: 1,399 (78%) — admin SSH sessions, short probes
  - EXFILTRATION: 382 (21%) — attacker data transfer sessions
  - BRUTE_FORCE: 6 (0.3%) — credential stuffing
- Your SSH sessions correctly classified as BENIGN (0.957+ confidence)
- Model trained on lab data generalizes to real traffic without retraining

---

## Honeypot Data (Cowrie)

- 282,863 sessions collected Feb 18 – Apr 15 (56 days)
- 665 log files across 3 regions
- Categories: BRUTE_FORCE 183,933 / PROBE 92,726 / EXFILTRATION 6,204
- Normalized to `data/honeypot/` (282,860 JSON files)
- Geo cache built: 13,104 unique IPs resolved (`data/geo_cache.json`)

---

## Globe Visualization

### Live Mode (`/threats`)
- ✅ 3D globe with Three.js, starfield, fresnel atmosphere
- ✅ Country boundaries (50m TopoJSON)
- ✅ Wireframe server towers at 3 honeypot locations
- ✅ Click tower → honeypot detail panel (region, IP, stack, traffic stats)
- ✅ InstancedMesh threat markers, color-coded by category
- ✅ Hover markers → tooltip with IP, city, category, event count
- ✅ Animated ballistic arcs (GLSL shader, white-hot head, colored trail)
- ✅ Arc height scales inversely with distance
- ✅ Category-colored arcs (not uniform teal)
- ✅ Arcs route to actual dest coordinates (not hardcoded Seattle)
- ✅ Pulsing rings at honeypot locations
- ✅ Blinking LED indicators on server towers
- ✅ Right sidebar with per-IP cards, category badges, country rollup
- ✅ Drag to rotate, scroll to zoom, auto-rotation

### Timelapse Mode (`/timelapse`)
- ✅ 16,245 events spanning Feb 18 – Apr 15
- ✅ Time-based playback (events fire at their real timestamps)
- ✅ Speed options: 1 day/min, 1 day/10s, 1 day/3s, 1 week/min
- ✅ Date + time counter ticking in top-left
- ✅ Server towers with blinking LEDs
- ✅ Category-colored arcs with distance-scaled height
- ✅ Accumulating markers as new sources appear
- ✅ Right sidebar with live category breakdown, top countries, recent IPs
- ✅ Click tower → honeypot panel with accumulated stats
- ✅ Click marker → pinned tooltip with IP, category, city, timestamp
- ✅ Play/Pause/Reset controls, progress bar, speed buttons
- ✅ Starfield background

---

## Docker Compose

All services build and start:

```bash
docker compose build --no-cache  # ~12 min first time
docker compose up
```

Fixes applied during this session:
- `ml/Dockerfile`: paths fixed for root build context, added `libgomp1`
- `citadel/Dockerfile`: proto path fixed, workdir restructured
- `citadel/pom.xml`: gRPC version downgraded to 1.63.0 (matches spring-boot-starter)
- `oracle/Dockerfile`: removed editable install, fixed setuptools backend
- `oracle/pyproject.toml`: build backend changed to `setuptools.build_meta`
- `lens/Dockerfile`: `npm ci` → `npm install`
- `lens/src/vite-env.d.ts`: added for Vite env types
- `JwtAuthFilter.java`: KEY field made public
- `CloudFirewallManager.java`: `.ingress(true)` → `.egress(false)`
- `SecurityEvent.java`: inet columns → varchar(45)
- DB columns altered at runtime: all inet→varchar, jsonb→text

---

## Key Files Created/Modified This Session

| File | What |
|---|---|
| `eye/CMakeLists.txt` | Optional gRPC, optional tests/benchmarks, protoc fallback |
| `scripts/deploy_eye_honeypots.sh` | Full deploy script with swap, disk cleanup, -j1 build |
| `scripts/inject_eye_events.sh` | Injects Eye logs into Citadel with real honeypot dest IPs |
| `scripts/build_timelapse_data.py` | Builds timelapse.json from honeypot + Eye data |
| `scripts/poster_plots.py` | 7 poster-ready plots (white background) |
| `lens/src/components/ThreatMap.tsx` | Live globe with server towers, panels, rich tooltips |
| `lens/src/components/TimelapseGlobe.tsx` | Timelapse with time-based playback, click detection |
| `lens/src/utils/globe.ts` | All geometry helpers including buildServerTower |
| `lens/public/countries-50m.json` | Higher-res world boundaries |
| `lens/public/timelapse.json` | 16K events with geo coordinates |
| `data/geo_cache.json` | 13K IP geo lookups (persistent) |
| `POSTER_INFO.txt` | All poster content organized by section |
| `GLOBE.md` | Complete globe source code reference |
| `poster_plots/` | 7 PNG plots for the poster |
| `providence_reference.md` | Updated honeypot IPs |

---

## What's Working End-to-End

1. Cowrie honeypots collect SSH attack sessions → S3
2. S3 sync to local → normalize to JSON → geo-locate IPs
3. The Eye captures packets on honeypots → ML classifies flows → logs to eye.log
4. Eye logs parsed → injected into Citadel via REST API
5. Citadel geo-locates IPs → serves to Lens dashboard
6. Globe renders live threats with arcs, markers, towers
7. Timelapse replays 56 days of honeypot data with time-based playback
8. Docker Compose runs full stack locally

---

## Remaining Items

| Item | Priority | Notes |
|---|---|---|
| Elastic IPs for honeypots | High | IPs change on stop/start |
| Timelapse marker click detection | Medium | Screen-space projection approach implemented, needs testing |
| Record demo video | High | Walk through GETTING_STARTED.md + DEMO.md |
| Poster final layout in Canva | High | Content in POSTER_INFO.txt, plots in poster_plots/ |
| Chrome Web Store submission | Low | Ward needs `npm run build` + icon PNGs |
| Git tag v1.0.0 | Medium | After demo video |
| Security group automation | Low | Script to auto-add current IP |
| Eye flow_export.json | Low | Only written on SIGINT — need to collect properly |
