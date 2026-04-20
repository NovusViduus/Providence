# Phase 5: The Lens — Implementation Checklist

> Spec vs. what was built, task by task.

---

## Task 1: Project Setup

| Requirement | Status | Notes |
|---|---|---|
| Vite + React + TypeScript | ✅ Done | Vite 5.3, React 18.3, TypeScript 5.5 |
| react-router-dom | ✅ Done | v6.26 |
| recharts | ✅ Done | v2.12 |
| lucide-react | ✅ Done | v0.400 |
| tailwindcss | ✅ Done | v3.4 with dark theme palette |
| three + @types/three | ✅ Done | v0.167 |
| No component library | ✅ Done | Tailwind + custom components only |
| Directory structure matches spec | ✅ Done | `components/`, `hooks/`, `services/`, `types/`, `utils/` |
| All 11 components created | ✅ Done | Layout, Login, AttackFeed, ResponseLog, ThreatMap, ManualOverride, PlaybookEditor, EventDetail, IncidentDetail, StatsOverview, ModelMetrics |
| Vite proxy for `/api`, `/ws`, `/auth` | ✅ Done | All three proxied to `localhost:8080` |
| Dark theme matching Providence aesthetic | ✅ Done | Custom `providence` color palette: bg `#0a0f0d`, surface `#111a16`, accent `#00ffc8`, danger `#ff1744` |

---

## Task 2: TypeScript Types & API Client

| Requirement | Status | Notes |
|---|---|---|
| `SecurityEvent` interface | ✅ Done | All fields from spec |
| `IncidentReport` interface | ✅ Done | Includes `pendingApproval` |
| `ResponseAction` interface | ✅ Done | All fields including `reversedAt`, `reversedReason` |
| `Playbook` interface | ✅ Done | |
| `ActiveBlock` interface | ✅ Done | |
| `GeoThreat` interface | ✅ Done | |
| `EventStats` interface | ✅ Done | |
| `Page<T>` generic type | ✅ Done | |
| `api.ts` with typed functions for every endpoint | ✅ Done | 15 functions covering events, incidents, playbooks, blocks, actions, threats, geo |
| JWT auto-injection from localStorage | ✅ Done | `Authorization: Bearer` header on every request |
| 401 → redirect to login | ✅ Done | `logout()` called on 401 |
| Base URL from `VITE_API_URL` env var | ✅ Done | Defaults to `/api/v1` |
| `auth.ts` with login/logout/getToken/getRole/isAdmin | ✅ Done | localStorage-based token + role storage |

---

## Task 3: JWT Authentication

### Citadel Side

| Requirement | Status | Notes |
|---|---|---|
| `spring-boot-starter-security` dependency | ✅ Done | Added to pom.xml |
| `jjwt` dependencies (api, impl, jackson) | ✅ Done | v0.12.6 |
| `SecurityConfig.java` — stateless, JWT-based | ✅ Done | `SessionCreationPolicy.STATELESS`, CSRF disabled |
| `/auth/login` permitted without auth | ✅ Done | `requestMatchers("/auth/**").permitAll()` |
| `/ws/**` permitted (WebSocket) | ✅ Done | `requestMatchers("/ws/**").permitAll()` |
| GET `/api/**` requires authentication | ✅ Done | `.authenticated()` |
| PUT/POST/PATCH/DELETE `/api/**` requires ADMIN role | ✅ Done | `.hasRole("ADMIN")` |
| CORS for Lens origins | ✅ Done | `localhost:5173` and `localhost:3000` |
| `POST /auth/login` endpoint | ✅ Done | `AuthController.java` |
| In-memory user store from env vars | ✅ Done | `PROVIDENCE_ADMIN_USER/PASS`, `PROVIDENCE_VIEWER_USER/PASS` with defaults |
| Returns `{ token, role, expiresIn }` | ✅ Done | 24-hour JWT with `sub`, `role`, `iat`, `exp` claims |
| `JwtAuthFilter.java` — OncePerRequestFilter | ✅ Done | Extracts Bearer token, validates with HMAC key, sets SecurityContext |
| JWT validation: signature + expiry | ✅ Done | `Jwts.parser().verifyWith(KEY).build().parseSignedClaims()` |
| Role-based authorities set in SecurityContext | ✅ Done | `ROLE_ADMIN` or `ROLE_VIEWER` |

### Lens Side

| Requirement | Status | Notes |
|---|---|---|
| `Login.tsx` with username/password form | ✅ Done | Calls `POST /auth/login`, stores JWT + role, redirects to `/` |
| Error display on invalid credentials | ✅ Done | Red error text |
| Protected routes redirect to `/login` | ✅ Done | `ProtectedRoute` component checks `getToken()` |
| Role-aware UI: Admin sees mutation controls | ✅ Done | `isAdmin()` guards on approve/reject/unblock/edit buttons |
| Viewer sees read-only (controls hidden) | ✅ Done | Buttons conditionally rendered |
| WebSocket JWT validation on handshake | ✅ Done | `JwtHandshakeInterceptor` added to `WebSocketConfig`. Extracts `?token=` query param, validates with `JwtAuthFilter.KEY`, rejects if invalid/missing. |

---

## Task 4: WebSocket Integration

| Requirement | Status | Notes |
|---|---|---|
| `useWebSocket.ts` hook | ✅ Done | Returns `{ events, connected, error }` |
| Connect with JWT in query param | ✅ Done | `?token=<jwt>` appended to URL |
| Parse incoming JSON as SecurityEvent | ✅ Done | `JSON.parse(e.data)` |
| Rolling buffer (last 200 events) | ✅ Done | `.slice(0, MAX_EVENTS)` |
| Auto-reconnect with exponential backoff | ✅ Done | 1s, 2s, 4s, 8s... max 30s |
| Connection status indicator (green/red dot) | ✅ Done | In Layout header |
| Backfill last 50 events via REST on reconnect | ❌ Missing | Spec asks for REST backfill after reconnect gap. Not implemented — reconnect just resumes the stream. |

---

## Task 5: Dashboard Pages & Components

### Layout

| Requirement | Status | Notes |
|---|---|---|
| Sidebar nav with all page links | ✅ Done | 7 nav items: Overview, Events, Incidents, Responses, Threats, Playbooks, Metrics |
| Header with connection indicator | ✅ Done | Green/red dot + "Live"/"Disconnected" text |
| Logged-in user role badge | ✅ Done | Cyan badge showing role |
| Logout button | ✅ Done | Calls `logout()` |
| Dark theme | ✅ Done | Providence color palette throughout |

### StatsOverview

| Requirement | Status | Notes |
|---|---|---|
| Stat cards: total, last hour, last 24h, active threats, active blocks | ✅ Done | 5-column grid |
| Category distribution pie chart | ✅ Done | Recharts PieChart with category colors |
| Tier distribution bar chart | ✅ Done | Recharts BarChart with OBSERVE/RECOMMEND/ACT colors |
| Timeline chart (events over time) | ❌ Missing | Spec asks for area chart with 1-hour buckets over 24h. Not implemented — would need a time-series endpoint or client-side bucketing. |
| Auto-refresh every 30s or on WS event | ❌ Missing | Data fetched once on mount via `useApi`. No periodic refresh or WS-triggered refresh. |

### AttackFeed

| Requirement | Status | Notes |
|---|---|---|
| Live scrolling table from WebSocket | ✅ Done | Merges live + historical, newest first |
| Columns: timestamp, source IP, dest port, category, confidence bar, tier badge | ✅ Done | All 6 columns |
| Color coding: OBSERVE gray, RECOMMEND yellow, ACT red | ✅ Done | `TIER_BADGE` mapping |
| Click row → EventDetail | ✅ Done | `navigate(/events/${id})` |
| Category dropdown filter | ✅ Done | Select with all 7 categories |
| Tier dropdown, min confidence slider, source IP search | ⚠️ Partial | Category filter only. Tier, confidence, and IP filters not implemented. |
| Pagination for historical events | ⚠️ Partial | Fetches first page via REST. No infinite scroll or page buttons. |

### EventDetail

| Requirement | Status | Notes |
|---|---|---|
| Full event fields displayed | ✅ Done | 12-field grid: source, dest, protocol, category, confidence, tier, duration, packets, bytes, JA3, component, time |
| Feature importances bar chart (top 10) | ✅ Done | Recharts horizontal BarChart |
| Related incident link | ❌ Missing | No link to associated incident |
| Response actions for this event | ❌ Missing | No actions section |
| Flow metadata | ✅ Done | Duration, packet count, byte count, JA3 hash shown |

### ResponseLog

| Requirement | Status | Notes |
|---|---|---|
| Active Blocks section from `GET /api/v1/blocks` | ✅ Done | Parses JSON values, shows IP + action + category |
| Unblock button (Admin only) | ✅ Done | Calls `DELETE /api/v1/blocks/{ip}`, refreshes list |
| Countdown timer for time remaining | ❌ Missing | Shows block info but no live countdown to expiry |
| Action History table from `GET /api/v1/actions` | ✅ Done | Time, IP, action, platform, success, reversed reason |

### ManualOverride

| Requirement | Status | Notes |
|---|---|---|
| Pending approvals section | ✅ Done | Filters `pendingApproval = true` |
| Shows: source IP, category, confidence, tier | ✅ Done | |
| Approve button (Admin) → `POST /api/v1/incidents/{id}/approve` | ✅ Done | Green button, refreshes after action |
| Reject button (Admin) → `POST /api/v1/incidents/{id}/reject` | ✅ Done | Red button, refreshes after action |
| Manual block form (IP + TTL) | ❌ Missing | Spec asks for a manual block form. Not implemented — would need a new Citadel endpoint. |

### ThreatMap

| Requirement | Status | Notes |
|---|---|---|
| Three.js 3D globe | ✅ Done | Scene, camera, renderer, requestAnimationFrame loop |
| Sphere body (dark Providence green-black) | ✅ Done | `0x0a1a14`, transparent, opacity 0.95 |
| Country boundaries from GeoJSON | ✅ Done | Fetches `/world-110m.geojson`, renders as `LineSegments` |
| `buildBoundaryGeometry()` utility | ✅ Done | Handles Polygon and MultiPolygon, outer rings only |
| Atmosphere glow | ✅ Done | BackSide sphere, `0x00ffc8`, opacity 0.05 |
| Threat markers via InstancedMesh | ✅ Done | Max 500 instances, per-category colors, scale by event count |
| `latLngToVector3()` utility | ✅ Done | Exact formula from spec |
| `buildArcGeometry()` utility | ✅ Done | QuadraticBezierCurve3 with configurable arc height |
| Arc lines for ACT-tier events | ❌ Missing | `buildArcGeometry` exists but is not called in ThreatMap. No arcs rendered. |
| Auto-rotation | ✅ Done | 0.001 radians/frame around Y axis |
| Mouse drag rotation | ✅ Done | mousedown/mousemove/mouseup handlers |
| Scroll zoom | ✅ Done | Camera z between 1.5 and 4.0 |
| Hover tooltip with Raycaster | ✅ Done | Raycaster in mousemove intersects InstancedMesh, reads `instanceId`, positions absolute tooltip div with IP/city/country/category/count. |
| Pause auto-rotation during drag | ✅ Done | `autoRotate = false` on mousedown, `true` on mouseup |
| Data from `GET /api/v1/events/geo` | ✅ Done | Fetches on mount via `useApi` |
| Max 500 InstancedMesh instances | ✅ Done | `MAX_MARKERS = 500` |
| `requestAnimationFrame` loop (not setInterval) | ✅ Done | |
| Dispose all Three.js objects on unmount | ✅ Done | Cleanup in useEffect return |
| `setPixelRatio(Math.min(devicePixelRatio, 2))` | ✅ Done | |
| ResizeObserver for responsive canvas | ✅ Done | |
| WebGL fallback detection | ✅ Done | Checks `getContext('webgl')`, shows text fallback |
| Flat SVG fallback | ❌ Missing | Spec asks for react-simple-maps or inline SVG. Only shows text message. |
| Top source countries panel (right side) | ✅ Done | Aggregates by country, shows top 10 with counts |
| 65%/35% layout split | ✅ Done | `flex-[2]` / `flex-1` |

### IncidentDetail

| Requirement | Status | Notes |
|---|---|---|
| All incident fields displayed | ✅ Done | 9-field grid |
| Timeline (detected → action → resolution) | ❌ Missing | Shows timestamps but no visual timeline |
| Add notes form (Admin) | ✅ Done | Textarea + button, calls `PATCH /api/v1/incidents/{id}` |
| Resolve button | ✅ Done | Calls `PATCH` with `resolved: true` |

### PlaybookEditor

| Requirement | Status | Notes |
|---|---|---|
| List all playbooks | ✅ Done | From `GET /api/v1/playbooks` |
| Expandable with category, actions, confidence, TTL, enabled | ✅ Done | Inline display + edit form |
| Admin can edit: confidence, TTL, enabled, description | ✅ Done | Input fields + save button |
| Save calls `PUT /api/v1/playbooks/{id}` | ✅ Done | |
| Viewer sees read-only | ✅ Done | Edit button hidden for non-admin |

### ModelMetrics

| Requirement | Status | Notes |
|---|---|---|
| Total classifications count | ✅ Done | From `stats.total` |
| Rejected recommendations count (false positive indicator) | ✅ Done | Counts incidents with "Rejected" in notes |
| ACT-tier event count | ✅ Done | From `stats.byTier.ACT` |
| Per-category event counts bar chart | ✅ Done | Recharts BarChart |
| Confidence distribution histogram | ❌ Missing | Would need per-event confidence values, not just aggregates |
| Per-category events over time | ❌ Missing | Would need time-series data |

---

## Task 6: Citadel — Geo IP Endpoint

| Requirement | Status | Notes |
|---|---|---|
| `GET /api/v1/events/geo?hours=24` endpoint | ✅ Done | `GeoController.java` |
| Groups by source IP | ✅ Done | `HashMap` grouping |
| Returns: sourceIp, lat, lng, country, city, category, eventCount, lastSeen | ✅ Done | All fields in response |
| Geo lookup via ip-api.com | ✅ Done | `HttpClient` with 3s timeout |
| Redis cache for geo lookups (7-day TTL) | ✅ Done | `geo:ip:` prefix, `Duration.ofDays(7)` |
| Skips private/loopback IPs | ✅ Done | Checks `10.`, `192.168.`, `172.`, `127.` prefixes |
| MaxMind GeoLite2 alternative | ❌ Not used | Spec mentions MaxMind as option. Used ip-api.com instead (simpler, no license key). |

---

## Task 7: Docker & CI

| Requirement | Status | Notes |
|---|---|---|
| `lens/Dockerfile` — Node builder → nginx | ✅ Done | `node:20-alpine` → `nginx:alpine` |
| `lens/nginx.conf` — SPA fallback + API/WS proxy | ✅ Done | `/api/`, `/auth/`, `/ws/` all proxied to `citadel:8080` |
| WebSocket upgrade headers in nginx | ✅ Done | `Upgrade` + `Connection "upgrade"` |
| Lens added to `docker-compose.yml` | ✅ Done | Port 3000, depends on citadel |
| `.github/workflows/ci-lens.yml` | ✅ Done | Node 20, `npm ci`, `npm run build` |
| CI lint step | ❌ Missing | Spec asks for `npm run lint`. CI only runs build. Lint script exists in package.json but no eslint config file (`.eslintrc`) was created. |

---

## Verification Checklist (from spec)

| Check | Status |
|---|---|
| `docker-compose up --build` starts Lens + Citadel + PostgreSQL + Redis | ✅ |
| Login page authenticates with Admin and Viewer credentials | ✅ |
| JWT attached to all REST and WebSocket requests | ✅ |
| Admin sees mutation controls | ✅ |
| Viewer sees read-only dashboard | ✅ |
| WebSocket streams live events to AttackFeed | ✅ |
| WebSocket auto-reconnects with backfill | ⚠️ (reconnects yes, backfill no) |
| Overview shows stats, category distribution, timeline chart | ⚠️ (stats + charts yes, timeline no) |
| AttackFeed shows live + historical with filtering | ⚠️ (category filter only) |
| EventDetail shows feature importances bar chart | ✅ |
| ResponseLog shows active blocks with unblock button | ✅ |
| ManualOverride shows pending approvals with approve/reject | ✅ |
| ThreatMap renders 3D globe with threat markers from geo endpoint | ✅ (with hover tooltips + country boundaries from TopoJSON) |
| PlaybookEditor allows Admin to update configs | ✅ |
| ModelMetrics shows confidence distribution and trends | ⚠️ (category counts yes, confidence histogram no) |
| nginx proxies REST and WebSocket correctly | ✅ |
| CI builds and lints | ⚠️ (builds yes, lint config missing) |

---

## Gaps Summary

### Closed

| Gap | Notes |
|---|---|
| WebSocket JWT validation | `JwtHandshakeInterceptor` in `WebSocketConfig` validates `?token=` query param on handshake. Rejects unauthenticated upgrades. |
| ThreatMap hover tooltip | Raycaster intersects InstancedMesh on mousemove, positions tooltip div with IP/city/country/category/count. |
| `world-110m.json` bundled | TopoJSON (108KB) from world-atlas CDN in `lens/public/`. `topoToGeo()` converter decodes arcs + quantization. |

### Open

| Gap | Severity | Notes |
|---|---|---|
| WebSocket reconnect backfill | Low | Reconnects work but doesn't fetch missed events via REST to fill the gap. |
| StatsOverview timeline chart | Low | No time-series area chart. Would need a time-bucketed endpoint or client-side aggregation. |
| StatsOverview auto-refresh | Low | Data fetched once. No periodic refresh or WS-triggered update. |
| AttackFeed: tier/confidence/IP filters | Low | Only category filter implemented. |
| AttackFeed pagination | Low | Shows first page only. No infinite scroll or page buttons. |
| EventDetail: related incident link + response actions | Low | Shows event fields but no cross-links to incidents or actions. |
| ResponseLog countdown timer | Low | Shows block info but no live countdown to expiry. |
| ManualOverride: manual block form | Medium | No way to manually block an IP from the UI. Would need a new Citadel endpoint `POST /api/v1/blocks`. |
| ThreatMap arc lines | Low | `buildArcGeometry` utility exists but arcs not rendered in the component. |
| ThreatMap flat SVG fallback | Low | Shows text message instead of flat map when WebGL unavailable. |
| IncidentDetail timeline visualization | Low | Shows timestamps but no visual timeline component. |
| ModelMetrics confidence histogram | Low | Would need per-event confidence data, not just aggregates. |
| ModelMetrics per-category over time | Low | Would need time-series endpoint. |
| ESLint config file | Low | `npm run lint` script exists but no `.eslintrc` config. CI lint step would fail. |
