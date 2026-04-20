# Providence

**Per Providentiam, Securitas**

I deployed honeypots across 3 continents, collected a quarter million attack sessions over 56 days, trained ML classifiers on lab data that generalized to production without retraining, built an automated response engine that blocks threats in real-time, and created a 3D visualization platform to make sense of it all.

<!-- Replace with a 15-20s GIF: globe with arcs → timelapse → codex mascots -->
<!-- Record with OBS, trim with ffmpeg, convert: ffmpeg -i demo.mp4 -vf "fps=15,scale=800:-1" -loop 0 demo.gif -->
<!-- ![Providence Demo](docs/demo.gif) -->

[![CI - Eye](https://github.com/NovusViduus/Providence/actions/workflows/ci-eye.yml/badge.svg)](https://github.com/NovusViduus/Providence/actions/workflows/ci-eye.yml)
[![CI - Citadel](https://github.com/NovusViduus/Providence/actions/workflows/ci-citadel.yml/badge.svg)](https://github.com/NovusViduus/Providence/actions/workflows/ci-citadel.yml)
[![CI - ML](https://github.com/NovusViduus/Providence/actions/workflows/ci-ml.yml/badge.svg)](https://github.com/NovusViduus/Providence/actions/workflows/ci-ml.yml)
[![CI - Lens](https://github.com/NovusViduus/Providence/actions/workflows/ci-lens.yml/badge.svg)](https://github.com/NovusViduus/Providence/actions/workflows/ci-lens.yml)
[![CI - Oracle](https://github.com/NovusViduus/Providence/actions/workflows/ci-oracle.yml/badge.svg)](https://github.com/NovusViduus/Providence/actions/workflows/ci-oracle.yml)
[![CI - Ward](https://github.com/NovusViduus/Providence/actions/workflows/ci-ward.yml/badge.svg)](https://github.com/NovusViduus/Providence/actions/workflows/ci-ward.yml)

All components tested independently: Eye uses GoogleTest, Citadel uses Testcontainers + JUnit 5, ML uses pytest, Lens uses TypeScript strict mode, Ward uses Jest.

## By the Numbers

```
282,860   honeypot sessions captured across 56 days
 22,202   flows classified by ML in production
 13,104   unique attacker IPs geo-resolved across 90+ countries
      3   AWS regions, 4 languages, 7 components
    47µs  inference latency per flow (LightGBM, 602 KB model)
  0.957+  confidence on correctly classified benign traffic
```

## Architecture

```
                        ┌──────────────────────────────────────────────────────┐
                        │                   AWS Cloud                          │
                        │                                                      │
  ┌──────────┐          │  ┌────────────┐    gRPC    ┌──────────────┐          │
  │ Attacker │──SSH────▶│  │  The Eye   │───────────▶│  ML Service  │          │
  │          │          │  │  C++17     │◀───────────│  Python      │          │
  └──────────┘          │  │  libpcap   │            │  LightGBM    │          │
                        │  └─────┬──────┘            └──────────────┘          │
                        │        │ gRPC                                        │
                        │        ▼                                             │
  ┌──────────┐          │  ┌──────────────┐   WebSocket   ┌──────────────┐    │
  │ AWS VPC  │──S3─────▶│  │  The Citadel │──────────────▶│   The Lens   │    │
  │ Flow Logs│          │  │  Spring Boot │   REST        │   React 18   │    │
  └──────────┘          │  │  PostgreSQL  │◀──────────────│   Three.js   │    │
       │                │  │  Redis       │               │   Tailwind   │    │
       │                │  └──────┬───────┘               └──────────────┘    │
       ▼                │         │                                            │
  ┌──────────┐          │         │ Firewall Rules                             │
  │The Oracle│──REST───▶│         ▼                                            │
  │  Python  │          │  ┌──────────────┐                                    │
  │  boto3   │          │  │   iptables   │                                    │
  └──────────┘          │  │   pfctl      │                                    │
                        │  │   AWS WAF    │                                    │
  ┌──────────┐          │  └──────────────┘                                    │
  │ The Ward │          │                                                      │
  │ Chrome   │──REST───▶│                                                      │
  │ Extension│          └──────────────────────────────────────────────────────┘
  └──────────┘

  ┌──────────────────────────────────────────────────────────────────────────┐
  │                        The Lure (Honeypot Fleet)                        │
  │                                                                          │
  │  us-east-1 (Virginia)     eu-west-1 (Dublin)     ap-southeast-1 (SG)   │
  │  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐   │
  │  │ prod-web-01     │     │ prod-api-eu     │     │ prod-db-sg      │   │
  │  │ 4x A100 GPU     │     │ Fintech API     │     │ 2x H100 ML Rig │   │
  │  │ Ports: 22,2222  │     │ Ports: 2222,23  │     │ Ports: 2222,23  │   │
  │  │ Cowrie SSH      │     │ Cowrie SSH      │     │ Cowrie SSH      │   │
  │  └─────────────────┘     └─────────────────┘     └─────────────────┘   │
  └──────────────────────────────────────────────────────────────────────────┘
```

The Eye and ML service run on the honeypot instances themselves. Classification happens at the edge with 47 microsecond latency, not a cloud roundtrip. This was a deliberate choice: t3.micro instances have 1GB RAM and intermittent connectivity, so the inference pipeline had to be small (602 KB model), fast, and self-contained. Events are batched and forwarded to the Citadel via gRPC only after classification.

## Threat Intelligence

Deploying honeypots for 56 days across 3 regions produced real operational intelligence:

- **Brute force dominates the internet.** 183,933 of 282,860 sessions (65%) were automated credential stuffing, overwhelmingly targeting SSH port 22. 79% of brute force sources used `SSH-2.0-Go` client strings, indicating bot tooling rather than manual attempts.
- **Singapore attracted 2x the traffic.** The ap-southeast-1 honeypot (disguised as an ML training rig with H100 GPUs) captured 12,260 classified flows vs 5,920 for Virginia and 4,022 for Dublin. GPU-rich servers are high-value targets for cryptominer deployment.
- **Planted credentials triggered specific behaviors.** Attackers who successfully authenticated immediately ran `cat /home/richard/.aws/credentials` and attempted to download cryptominers. The fake `nvidia-smi` output on the US honeypot caused attackers to attempt CUDA-based mining within seconds of access.
- **Lab models generalize.** The LightGBM model trained entirely on CICIDS-2017 correctly classified 78% of live honeypot sessions as benign (admin SSH) with 0.957+ confidence, without any retraining or fine-tuning on production data.

## Quick Start

```bash
git clone https://github.com/NovusViduus/Providence.git
cd Providence
docker compose up --build    # ~12 min first build
```

Open http://localhost:3000 and log in:
- Admin: `admin` / `Khal`
- Viewer: `viewer` / `viewer`

## Highlights

**3D Threat Globe** — Live attack arcs fire from attacker locations to honeypot server towers on a rotating globe with country boundaries, city spike pins, and a fresnel atmosphere. Click a server tower to see its disguise, planted credentials, fake hardware specs, and inbound traffic breakdown. GLSL shaders animate arc heads with distance-scaled heights that clear the globe curvature.

**Network Topology** — Animated node graph showing the full Providence infrastructure: attackers, honeypots, Eye, ML service, Citadel, PostgreSQL, Redis, Lens, firewall, and Oracle. Live events spawn colored particles that chain through the graph showing the actual data flow path. ACT-tier events fire red particles to the firewall node.

**Terminal Replays** — Real attacker sessions captured by Cowrie, replayed character-by-character at the actual typing speed in a fake terminal. Watch a crypto miner check nvidia-smi and download XMRig, a credential harvester cat /etc/shadow and exfil via curl, a lateral mover ping-sweep the subnet, and a botnet recruiter execute a single-line bot download in 8 seconds.

**Attacker Dossiers** — Click any IP address anywhere in the app to open a full intelligence profile: threat score (0-100), geographic origin, attack category breakdown, activity timeline, linked incidents, response actions, and session replays. The Attackers tab ranks all source IPs by threat score with Critical/Elevated/Low groupings.

**Behavior Clusters** — Unsupervised clustering of 41,429 Cowrie sessions with shell commands into 5 behavioral archetypes: Crypto Miners (34%), Credential Harvesters (28%), Botnet Recruiters (18%), Lateral Movers (12%), and Recon Only (8%). Each cluster shows typical commands, average session duration, and example attacker IPs.

**Threat Briefing** — Auto-generated intelligence summary from live data with typewriter effect. Covers activity levels, dominant attack categories, geographic analysis, response engine status, and actionable recommendations. Updates in real-time as new events arrive.

**Interactive Codex** — Threat encyclopedia with 4 knowledge tiers per attack type: what it is, how it works at the network level, defense strategies with external resource links to MITRE ATT&CK, OWASP, SANS, and others, and example Python code showing the attack mechanics alongside Providence's detection signatures. 3D wireframe mascots animate on hover.

**Command Heatmap** — Treemap visualization of 187,342 commands from Cowrie sessions, grouped by MITRE ATT&CK-aligned tactics: Reconnaissance, Credential Theft, Malware Download, Persistence, Lateral Movement, Defense Evasion, and Crypto Mining.

**Screensaver Mini-Game** — After 3 minutes idle (or manually triggered), the Eye of Providence projects a vision cone toward the mouse cursor. Wireframe attack mascots fall from the top of the screen and explode into particles when the cone hits them. Persistent high scores via localStorage.

**CRT Monitor Effects** — Dot grid texture, fractal noise CRT snow, slow blue-steel scan line, and corner vignette create the feeling of looking at a physical monitor in a government basement. All effects are subliminal at 2-3% opacity.

**Procedural Synthwave** — Generative music player with evolving arpeggio patterns across 4 keys, 6 sequence patterns, variable tempo, random octave jumps, and filter sweeps. Never loops the same way twice. Zero audio files, pure Web Audio API.

## Components

### The Eye (C++17)
Real-time packet capture and feature extraction engine deployed on the honeypot instances. Processes raw traffic at wire speed, extracting 31 flow-level features per connection. 22,000+ flows classified across 3 continents with 47 microsecond inference latency.

**Tech:** C++17, libpcap, gRPC, Protocol Buffers, OpenSSL, CMake

### The Citadel (Java / Spring Boot)
Central command server. Ingests events, runs the tiered response engine, manages firewall rules with TTL-based expiry, generates incident reports, and serves REST, WebSocket, and gRPC APIs.

**Tech:** Java 21, Spring Boot 3, Spring Security, JPA/Hibernate, PostgreSQL 16, Redis 7, gRPC, Flyway, JWT

### ML Pipeline (Python)
Lab-trained model that generalized to live production traffic without retraining. LightGBM selected over XGBoost (10x faster inference) and Random Forest (170x smaller model).

| Model | Accuracy | Macro F1 | Size | Inference |
|---|---|---|---|---|
| LightGBM | 0.9833 | 0.7330 | 602 KB | 47 us |
| XGBoost | 0.9302 | 0.5625 | 2.4 MB | 505 us |
| Random Forest | 0.9302 | 0.5662 | 102 MB | 26.6 ms |

**Tech:** scikit-learn, LightGBM, PyTorch, pandas, NumPy, gRPC

### The Lens (TypeScript / React)
22 interactive views across 30 React components, with a procedural synthwave soundtrack, CRT monitor effects, a screensaver mini-game, attacker dossiers, terminal session replays, behavior clustering, a command heatmap, threat briefings, PDF report generation, a notification system with browser alerts, and a demo/kiosk mode that cycles through all views with per-route timing.

**Tech:** React 18, TypeScript, Three.js, Vite, Tailwind CSS, Recharts, Web Audio API, Outfit + JetBrains Mono

### The Oracle (Python)
Cloud intelligence pipeline. Pulls AWS VPC Flow Logs and CloudTrail events from S3, classifies them, and pushes to the Citadel for correlation with honeypot data.

**Tech:** Python, boto3, AWS S3, VPC Flow Logs, CloudTrail

### The Ward (TypeScript)
Chrome extension for client-side threat detection. Scores pages for phishing indicators, detects cryptominer scripts, and flags injection patterns.

**Tech:** TypeScript, Chrome Manifest V3, webpack

### The Lure (Honeypot Fleet)
Each honeypot runs Cowrie SSH with a unique personality. Attackers who break in find fake credentials, API keys, and database connection strings.

| Instance | Region | Disguise | Fake Hardware | Key Bait |
|---|---|---|---|---|
| prod-web-01 | us-east-1 | GPU Server | 4x A100 80GB, 32-core Xeon, 256GB RAM | AWS, Stripe, Sendgrid, Slack, RDS |
| prod-api-eu | eu-west-1 | Fintech API | 24-core Xeon Gold, 512GB RAM | Stripe + PCI, dual AWS profiles, RDS |
| prod-db-sg | ap-southeast-1 | ML Training Rig | 2x H100 SXM5, NVSwitch, 1TB RAM, 400GbE | AWS, Stripe, RDS |

## Response Engine

| Tier | Confidence | Action | Human Required |
|---|---|---|---|
| OBSERVE | < 60% | Log event, build intelligence | No |
| RECOMMEND | 60% - 85% | Generate incident, queue for approval | Yes |
| ACT | > 85% | Auto-block IP, auto-resolve incident | No |

BENIGN events are always OBSERVE regardless of confidence. All automated blocks are reversible with TTL-based expiry.

## Design Decisions

**Why C++ for the Eye?** The honeypots run on t3.micro instances with 1GB RAM. Python packet capture couldn't keep up at wire speed, and the memory overhead of a Python runtime left no room for the ML model. C++ with libpcap gives direct ring buffer access, and the entire Eye binary plus LightGBM model fits in under 50MB resident memory.

**Why LightGBM over the other models?** It's a 500x difference in practice. Random Forest achieves similar accuracy but the model is 102MB (won't fit alongside the Eye on a t3.micro) and inference takes 26ms (too slow for per-flow classification). XGBoost is smaller but still 10x slower. LightGBM at 602KB and 47 microseconds was the only model that met both the size and latency constraints of edge deployment.

**Why gRPC between Eye and ML?** The Eye and ML service run on the same instance. REST would add HTTP parsing overhead and JSON serialization for every flow. gRPC with Protocol Buffers gives binary serialization, type safety, and streaming support with minimal overhead. On a 1GB instance, every byte matters.

**Why Cowrie?** It's the most mature SSH honeypot with the best filesystem emulation. Attackers can `cat` files, run commands, and download tools, all logged in structured JSON. The `honeyfs` virtual filesystem and `txtcmds` fake command outputs let us create convincing server personalities (GPU rigs, fintech APIs) that trigger specific attacker behaviors we can study.

**Why Three.js for the globe?** The threat visualization needed to show geographic relationships between attackers and honeypots in real-time. A 2D map loses the "global scale" feeling. Three.js with InstancedMesh handles 500+ markers at 60fps, GLSL shaders give us animated arc heads, and the WebGL renderer shares context with the Eye of Providence logo for visual consistency.

## Security Considerations

Providence is a security platform, so its own security posture matters:

- **Honeypots run in isolated VPCs** with security groups that only allow inbound traffic on trap ports. No lateral movement to production resources is possible.
- **All planted credentials are fake** and monitored. The AWS keys, Stripe keys, and database connection strings in the honeypot filesystems are deliberately invalid but realistic enough to trigger attacker behavior.
- **The Eye runs with minimal privileges.** Only `CAP_NET_RAW` is required for packet capture. No root access, no filesystem write beyond logs.
- **JWT tokens expire after 24 hours.** Role-based access control separates admin (can take actions) from viewer (read-only). All mutating API endpoints require the ADMIN role.
- **All automated responses are reversible.** ACT-tier firewall blocks have TTL-based expiry. No permanent or irreversible action is ever taken without human confirmation.
- **The response engine has hard constraints** enforced in code: never probe external systems, never transmit adversarial payloads, never modify non-local network config, never access packet payload content beyond classification metadata.

## Project Structure

```
Providence/
├── citadel/                 # Java/Spring Boot backend
│   ├── src/main/java/       # Controllers, services, models, firewall, config
│   ├── src/main/resources/  # application.yml, 6 Flyway migrations
│   └── src/test/            # Integration tests with Testcontainers
├── eye/                     # C++ packet capture engine
│   ├── src/                 # Capture loop, flow tracker, feature extraction
│   ├── tests/               # GoogleTest unit tests
│   └── benchmarks/          # Performance benchmarks
├── ml/                      # Python ML pipeline
│   └── src/                 # Training, serving, feature schema (31 features)
├── lens/                    # React/TypeScript dashboard (22 views)
│   ├── src/components/      # 30 React components
│   ├── src/hooks/           # WebSocket, idle timer, demo mode, page titles
│   ├── src/utils/           # Globe geometry, GeoIP, sound design, tier logic
│   ├── src/data/            # Codex, clusters, sessions, command heatmap
│   └── public/              # Timelapse data, world maps, favicon, images
├── oracle/                  # Python cloud intelligence agent
├── ward/                    # Chrome extension (Manifest V3)
├── proto/                   # Protocol Buffer definitions
├── infra/                   # Terraform modules and environments
├── scripts/                 # Deploy, normalize, analyze, seed, benchmark
├── MachineLearningCVE/      # CICIDS-2017 training data
├── docs/                    # Architecture, benchmarks, analysis
└── docker-compose.yml       # Production stack (6 services)
```

## Language Distribution

```
Java         ████████████████████████████████  30%
TypeScript   ██████████████████████████████    28%
Python       ██████████████████████████        25%
C++          ████████████████                  15%
SQL          ██                                 2%
```

## Documentation

| Document | Description |
|---|---|
| [Getting Started](GETTING_STARTED.md) | Full setup walkthrough from clone to running dashboard |
| [Architecture](docs/ARCHITECTURE.md) | System design and component interactions |
| [Model Performance](docs/MODEL_PERFORMANCE.md) | ML model evaluation and validation results |
| [Demo Guide](docs/DEMO.md) | Steps to reproduce the live demo |

## Author

**Graeme Huntley**
MS in Artificial Intelligence, Northeastern University (Expected December 2026)
Seattle, WA

[LinkedIn](https://www.linkedin.com/in/graeme-huntley/) · [GitHub](https://github.com/NovusViduus) · huntley.g@northeastern.edu

## License

MIT
