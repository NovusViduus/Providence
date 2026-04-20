# Providence — Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DATA SOURCES                                  │
│                                                                      │
│  ┌──────────┐   ┌──────────────┐   ┌──────────┐   ┌──────────────┐ │
│  │ Local NIC │   │ AWS VPC Flow │   │ AWS      │   │ Chrome       │ │
│  │ (libpcap) │   │ Logs (S3)    │   │CloudTrail│   │ Browser      │ │
│  └─────┬─────┘   └──────┬───────┘   └────┬─────┘   └──────┬───────┘ │
│        │                 │                │                 │         │
│        ▼                 ▼                ▼                 ▼         │
│  ┌──────────┐   ┌──────────────┐              ┌──────────────┐      │
│  │ THE EYE  │   │ THE ORACLE   │              │  THE WARD    │      │
│  │ C++17    │   │ Python/boto3 │              │  Chrome MV3  │      │
│  │ 31 feat  │   │ Rule-based   │              │  Heuristic   │      │
│  │ JA3/DNS  │   │ + ML fallback│              │  Phishing    │      │
│  └─────┬─────┘   └──────┬───────┘              └──────┬───────┘      │
│        │                 │                             │              │
│   Unix Socket       REST + SNS                    REST (opt)         │
│        │                 │                             │              │
│        ▼                 │                             │              │
│  ┌──────────┐            │                             │              │
│  │ML SERVICE│            │                             │              │
│  │ Python   │            │                             │              │
│  │ XGBoost  │            │                             │              │
│  │ LSTM/CNN │            │                             │              │
│  └─────┬─────┘            │                             │              │
│        │                 │                             │              │
│   Classification         │                             │              │
│        │                 │                             │              │
│        ▼                 ▼                             ▼              │
│  ┌───────────────────────────────────────────────────────────┐      │
│  │                    THE CITADEL                             │      │
│  │                  Java 21 / Spring Boot                     │      │
│  │                                                            │      │
│  │  ┌─────────────┐  ┌──────────────────┐  ┌──────────────┐ │      │
│  │  │ gRPC Server  │  │ REST API         │  │ WebSocket    │ │      │
│  │  │ (Eye ingest) │  │ (Oracle/Ward/    │  │ /ws/events   │ │      │
│  │  │              │  │  Lens queries)   │  │ (live feed)  │ │      │
│  │  └──────┬───────┘  └────────┬─────────┘  └──────┬───────┘ │      │
│  │         │                   │                    │         │      │
│  │         ▼                   ▼                    │         │      │
│  │  ┌──────────────────────────────────┐            │         │      │
│  │  │     ResponseOrchestrator         │            │         │      │
│  │  │  OBSERVE → log only              │            │         │      │
│  │  │  RECOMMEND → log + pending       │            │         │      │
│  │  │  ACT → execute playbook          │            │         │      │
│  │  └──────────────┬───────────────────┘            │         │      │
│  │                 │                                │         │      │
│  │    ┌────────────┼────────────┐                   │         │      │
│  │    ▼            ▼            ▼                   │         │      │
│  │  BLOCK     RATE_LIMIT   ALERT                    │         │      │
│  │    │            │            │                    │         │      │
│  │    ▼            ▼            ▼                    │         │      │
│  │  ┌──────────────────────────────┐                │         │      │
│  │  │     FirewallManager          │                │         │      │
│  │  │  noop │ pfctl │ iptables │   │                │         │      │
│  │  │       │       │ cloud(NACL)  │                │         │      │
│  │  └──────────────────────────────┘                │         │      │
│  │                                                  │         │      │
│  │  ┌────────────┐  ┌─────────┐                     │         │      │
│  │  │ PostgreSQL │  │  Redis  │─────────────────────┘         │      │
│  │  │ (persist)  │  │ pub/sub │                               │      │
│  │  │ 5 tables   │  │ cache   │                               │      │
│  │  └────────────┘  └─────────┘                               │      │
│  └────────────────────────────────────────────────────────────┘      │
│                                                                      │
│        ▲ REST + WebSocket                                            │
│        │                                                             │
│  ┌─────┴──────────────────────────────────────────────────────┐      │
│  │                    THE LENS                                 │      │
│  │                React 18 / TypeScript / Three.js             │      │
│  │                                                             │      │
│  │  ┌────────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐ │      │
│  │  │ AttackFeed │ │ 3D Globe │ │ Response │ │ Manual      │ │      │
│  │  │ (live+hist)│ │ (threats)│ │ Log      │ │ Override    │ │      │
│  │  └────────────┘ └──────────┘ └──────────┘ └─────────────┘ │      │
│  └─────────────────────────────────────────────────────────────┘      │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐      │
│  │              AWS RESPONSE INFRASTRUCTURE                    │      │
│  │  Lambda: revoke_iam │ terminate_instance │ sns_alert        │      │
│  │  SNS: providence-alerts │ NACL: providence-blocklist        │      │
│  │  Terraform: infra/modules/monitoring + remediation          │      │
│  └─────────────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────────┘
```

## Data Flow

1. **Capture**: Eye captures packets (local), Oracle polls S3 (cloud), Ward analyzes pages (browser)
2. **Extract**: 31 flow features (Eye), 16 mapped features (Oracle), 24 behavioral features (AI detector), heuristic signals (Ward)
3. **Classify**: XGBoost/LightGBM on flow features, rule-based for cloud events, LSTM/CNN for AI agent detection, weighted scoring for web threats
4. **Dispatch**: Eye → gRPC, Oracle → REST + SNS, Ward → REST (optional)
5. **Respond**: Citadel's ResponseOrchestrator applies tiered logic (Observe/Recommend/Act), executes playbooks via FirewallManager
6. **Visualize**: Lens receives events via WebSocket, renders 3D globe, live feed, response log, manual override panel

## Database Schema

5 tables across 5 Flyway migrations:
- `security_events` — all classified events from all sources (5 indexes)
- `playbooks` — 13 response playbooks (6 network + 3 cloud + 4 web)
- `incident_reports` — ACT/RECOMMEND tier incidents with pending_approval
- `response_actions` — full audit trail of every firewall action

## Communication Protocols

| Path | Protocol | Format |
|---|---|---|
| Eye → ML Service | Unix socket | 4-byte BE length prefix + protobuf |
| Eye → Citadel | gRPC | `EventService.ReportEvent` |
| Oracle → Citadel | REST | `POST /api/v1/events/ingest` (JSON) |
| Ward → Citadel | REST | `POST /api/v1/events/ingest` (JSON) |
| Oracle → AWS | SNS | JSON (triggers Lambda remediation) |
| Citadel → Lens | WebSocket | JSON events on `providence:events` Redis channel |
| Lens → Citadel | REST | JWT-authenticated queries and mutations |

## Security

- JWT authentication with 24h expiry, HMAC-SHA256 signing
- RBAC: Admin (full access) and Viewer (read-only)
- WebSocket JWT validation via HandshakeInterceptor
- API rate limiting: 100 req/min per IP
- Firewall safety guards: IP validation, loopback/gateway/VPC protection
- All automated actions are TTL-based and reversible
