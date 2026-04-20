# The Citadel — Spring Boot Backend

Event storage, tiered response engine, JWT authentication, gRPC + REST API, WebSocket streaming, Redis pub/sub.

## Build & Run

```bash
cd citadel
mvn package -DskipTests
java -jar target/*.jar
```

## Docker

```bash
docker-compose up citadel postgres redis
```

## API Summary

| Method | Path | Description |
|---|---|---|
| POST | /auth/login | JWT authentication |
| GET | /api/v1/events | Paginated events (category, tier, confidence, IP filters) |
| GET | /api/v1/events/stats | Aggregate statistics |
| GET | /api/v1/events/geo | Geographic threat data |
| POST | /api/v1/events/ingest | REST ingest (Oracle, Ward) |
| GET/POST | /api/v1/incidents | Incident management + approve/reject |
| GET/PUT | /api/v1/playbooks | Playbook configuration |
| GET/DELETE | /api/v1/blocks | Active block management |
| GET | /api/v1/actions | Response action audit trail |
| GET | /actuator/health | Health check |
| WS | /ws/events | Real-time event stream |
| gRPC | EventService.ReportEvent | Eye event ingestion |
