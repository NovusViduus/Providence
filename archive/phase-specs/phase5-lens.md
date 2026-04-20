# Phase 5: The Lens — Dashboard

> Providence Network Security Intelligence Platform
> Component: The Lens — React TypeScript Real-Time Monitoring Dashboard
> Timeline: Weeks 12–14
> Prerequisites: Phase 2 (The Citadel) complete, Phase 4 (Response Engine) complete

---

## Goal

Build a real-time monitoring dashboard where a human operator can see every event, every response action, every active threat — and override any automated decision. The Lens connects to The Citadel via WebSocket for live event streaming and REST for historical queries, CRUD operations, and manual overrides. JWT authentication with two roles (Admin, Viewer) gates access.

---

## Deliverable

A fully functional React TypeScript dashboard. Real-time event streaming via WebSocket. Geographic threat visualization. Attack classification feed. Response action log. Manual override panel (approve/reject/unblock). Historical analytics. JWT-based login with RBAC. Dockerized.

---

## Context

### Citadel APIs Available (from Phases 2 + 4)

**WebSocket:**
- `ws://localhost:8080/ws/events` — raw WebSocket, pushes JSON events from Redis pub/sub `providence:events` channel

**REST — Events:**
- `GET /api/v1/events` — paginated, filterable (category, sourceIp, tier, minConfidence, from, to)
- `GET /api/v1/events/{id}` — single event
- `GET /api/v1/events/stats` — aggregates (total, lastHour, lastDay, byCategory, byTier)

**REST — Incidents:**
- `GET /api/v1/incidents` — paginated, filterable (resolved, category, from, to)
- `GET /api/v1/incidents/{id}` — single incident
- `PATCH /api/v1/incidents/{id}` — update (resolve, add notes)
- `POST /api/v1/incidents/{id}/approve` — execute pending RECOMMEND action
- `POST /api/v1/incidents/{id}/reject` — reject pending action

**REST — Playbooks:**
- `GET /api/v1/playbooks` — list all
- `GET /api/v1/playbooks/{id}` — single
- `PUT /api/v1/playbooks/{id}` — update (actions, thresholds, enabled)

**REST — Blocks:**
- `GET /api/v1/blocks` — active blocks from Redis
- `DELETE /api/v1/blocks/{ip}` — manual unblock

**REST — Actions:**
- `GET /api/v1/actions` — paginated action history (actionType, sourceIp, success, active)

**REST — Threats:**
- `GET /api/v1/threats/active` — active threat cache from Redis

### Authentication (ADR-009, to be implemented)

- `POST /auth/login` — credentials → JWT
- JWT in `Authorization: Bearer <token>` header for REST
- JWT in query param or first message for WebSocket handshake
- Two roles: **Admin** (full access) and **Viewer** (read-only, no mutations)
- Spring Security in-memory user store, credentials from environment variables

---

## Tasks

### Task 1: Project Setup

**Requirements:**
- [ ] Initialize React project with TypeScript:
  - Vite as build tool (faster than CRA)
  - `lens/package.json` with dependencies: react, react-dom, typescript, react-router-dom, recharts, lucide-react, tailwindcss, three, @types/three
  - No component library (Tailwind + custom components)
- [ ] Directory structure:
  ```
  lens/
  ├── package.json
  ├── tsconfig.json
  ├── vite.config.ts
  ├── tailwind.config.js
  ├── index.html
  ├── src/
  │   ├── App.tsx
  │   ├── main.tsx
  │   ├── components/
  │   │   ├── Layout.tsx              # Shell: sidebar nav + header + content
  │   │   ├── Login.tsx               # JWT login form
  │   │   ├── AttackFeed.tsx          # Live classified event stream
  │   │   ├── ResponseLog.tsx         # Action history + active blocks
  │   │   ├── ThreatMap.tsx           # Geographic IP visualization
  │   │   ├── ManualOverride.tsx      # Approve/reject/unblock panel
  │   │   ├── PlaybookEditor.tsx      # View/edit playbook configs
  │   │   ├── EventDetail.tsx         # Single event deep-dive
  │   │   ├── IncidentDetail.tsx      # Single incident deep-dive
  │   │   ├── StatsOverview.tsx       # Top-level stat cards + charts
  │   │   └── ModelMetrics.tsx        # Classification performance
  │   ├── hooks/
  │   │   ├── useWebSocket.ts         # WebSocket connection + reconnect
  │   │   └── useApi.ts               # REST client with JWT
  │   ├── services/
  │   │   ├── api.ts                  # Axios/fetch wrapper, base URL config
  │   │   └── auth.ts                 # Login, token storage, role check
  │   ├── types/
  │   │   └── events.ts               # TypeScript type definitions
  │   └── utils/
  │       ├── geoip.ts                # IP → lat/lng lookup
  │       └── globe.ts                # Lat/lng → 3D sphere coords, GeoJSON boundary projection
  ├── public/
  └── Dockerfile
  ```
- [ ] Configure proxy in `vite.config.ts` to forward `/api` and `/ws` to `localhost:8080` during development
- [ ] Tailwind configured with a dark theme palette (the existing honeypot dashboard uses dark greens/cyans — match that aesthetic)

**Acceptance criteria:**
- `npm run dev` starts the dashboard at `localhost:5173`
- Proxied requests to `/api/v1/events` hit the Citadel

---

### Task 2: TypeScript Types & API Client

**Requirements:**
- [ ] `types/events.ts` — type definitions matching Citadel JSON responses:
  ```typescript
  interface SecurityEvent {
    id: string;
    eventId: string;
    timestamp: string;
    sourceIp: string;
    sourcePort: number;
    destIp: string;
    destPort: number;
    protocol: string;
    category: string;
    subcategory?: string;
    confidence: number;
    featureImportances?: Record<string, number>;
    sourceComponent: string;
    ja3Hash?: string;
    flowDuration?: number;
    packetCount?: number;
    byteCount?: number;
    responseTier: string;
    responseAction?: string;
  }

  interface IncidentReport {
    id: string;
    eventId: string;
    playbookId?: string;
    responseTier: string;
    actionsTaken: string[];
    sourceIp: string;
    category: string;
    confidence: number;
    resolved: boolean;
    pendingApproval: boolean;
    notes?: string;
    createdAt: string;
    resolvedAt?: string;
  }

  interface ResponseAction {
    id: string;
    incidentId?: string;
    actionType: string;
    sourceIp: string;
    success: boolean;
    detail?: string;
    platform: string;
    ttlSeconds?: number;
    createdAt: string;
    expiresAt?: string;
    reversedAt?: string;
    reversedReason?: string;
  }

  interface Playbook {
    id: string;
    name: string;
    category: string;
    description?: string;
    actions: string[];
    minConfidence: number;
    enabled: boolean;
    ttlSeconds: number;
  }

  interface ActiveBlock {
    ip: string;
    action: string;
    category: string;
    confidence: number;
    blockedAt: string;
    expiresAt: string;
    incidentId: string;
  }

  interface EventStats {
    total: number;
    lastHour: number;
    lastDay: number;
    byCategory: Record<string, number>;
    byTier: Record<string, number>;
  }

  type Page<T> = {
    content: T[];
    totalElements: number;
    totalPages: number;
    number: number;
    size: number;
  };
  ```

- [ ] `services/api.ts`:
  - Base URL from env var `VITE_API_URL` (default `/api/v1`)
  - Automatic JWT injection from localStorage
  - Response interceptor: 401 → redirect to login
  - Functions for every Citadel endpoint (typed):
    - `getEvents(params): Promise<Page<SecurityEvent>>`
    - `getEvent(id): Promise<SecurityEvent>`
    - `getEventStats(): Promise<EventStats>`
    - `getIncidents(params): Promise<Page<IncidentReport>>`
    - `approveIncident(id): Promise<void>`
    - `rejectIncident(id): Promise<void>`
    - `getPlaybooks(): Promise<Playbook[]>`
    - `updatePlaybook(id, data): Promise<Playbook>`
    - `getActiveBlocks(): Promise<ActiveBlock[]>`
    - `unblockIp(ip): Promise<void>`
    - `getActions(params): Promise<Page<ResponseAction>>`
    - `getActiveThreats(): Promise<ActiveBlock[]>`

- [ ] `services/auth.ts`:
  - `login(username, password): Promise<{ token, role }>`
  - `logout()` — clears token
  - `getToken(): string | null`
  - `getRole(): 'admin' | 'viewer' | null`
  - `isAdmin(): boolean`
  - Token stored in localStorage

**Acceptance criteria:**
- All API functions typed and callable
- 401 responses redirect to `/login`
- Token attached to every request automatically

---

### Task 3: JWT Authentication (Citadel + Lens)

**Requirements:**

**Citadel side (Java):**
- [ ] Add `spring-boot-starter-security` and `jjwt` dependencies to `pom.xml`
- [ ] `SecurityConfig.java`:
  - Stateless session (no cookies)
  - Permit `/auth/login` without authentication
  - Require JWT for all `/api/**` endpoints
  - Require JWT for WebSocket upgrade at `/ws/**`
  - CORS configured for Lens origin (`localhost:5173` in dev)
- [ ] `POST /auth/login`:
  - Accept `{ username, password }` JSON body
  - Validate against in-memory user store (credentials from env vars: `PROVIDENCE_ADMIN_USER`, `PROVIDENCE_ADMIN_PASS`, `PROVIDENCE_VIEWER_USER`, `PROVIDENCE_VIEWER_PASS`)
  - Return `{ token, role, expiresIn }` — JWT with 24-hour expiry
  - JWT claims: `sub` (username), `role` (admin/viewer), `iat`, `exp`
- [ ] `JwtAuthFilter.java` — OncePerRequestFilter:
  - Extract token from `Authorization: Bearer <token>`
  - Validate signature and expiry
  - Set `SecurityContext` with role-based authorities
- [ ] Role enforcement:
  - `@PreAuthorize("hasRole('ADMIN')")` on: PUT playbooks, DELETE blocks, POST approve/reject
  - Viewer can access all GET endpoints

**Lens side (React):**
- [ ] `Login.tsx`:
  - Username + password form
  - Calls `POST /auth/login`
  - Stores JWT + role in localStorage
  - Redirects to dashboard on success
  - Shows error on failure
- [ ] `App.tsx` routing:
  - `/login` → Login (public)
  - `/` → Dashboard (protected, redirects to login if no token)
- [ ] Role-aware UI:
  - Admin: sees approve/reject buttons, unblock buttons, playbook edit forms
  - Viewer: same views but mutation controls hidden or disabled
  - Role from `auth.getRole()`, passed via React context

**Acceptance criteria:**
- Login with admin credentials → JWT returned, dashboard accessible
- Login with viewer credentials → read-only dashboard
- Invalid credentials → error message
- Expired token → redirected to login
- Viewer cannot call admin-only endpoints (403 from Citadel)

---

### Task 4: WebSocket Integration

**Requirements:**
- [ ] `hooks/useWebSocket.ts`:
  ```typescript
  function useWebSocket(url: string): {
    events: SecurityEvent[];
    connected: boolean;
    error: string | null;
  }
  ```
  - Connect to `ws://host/ws/events` with JWT in query param: `?token=<jwt>`
  - Parse incoming JSON messages as `SecurityEvent`
  - Maintain a rolling buffer (last 200 events in memory)
  - Auto-reconnect on disconnect (exponential backoff: 1s, 2s, 4s, 8s, max 30s)
  - Connection status indicator (green dot = connected, red = disconnected)
  - On reconnect, fetch last 50 events via REST to backfill gap

- [ ] Update Citadel's `WebSocketConfig.java` if needed:
  - Extract JWT from query parameter during handshake
  - Validate token before accepting connection
  - Reject unauthenticated connections

**Acceptance criteria:**
- Dashboard shows real-time events as they arrive via WebSocket
- Connection indicator shows green when connected
- Disconnecting Citadel → red indicator → auto-reconnect when Citadel returns
- Events backfilled after reconnection gap

---

### Task 5: Dashboard Pages & Components

**Requirements:**

**Layout (`Layout.tsx`):**
- [ ] Sidebar navigation with links: Overview, Events, Incidents, Responses, Threats, Playbooks
- [ ] Header: connection status indicator, logged-in user + role badge, logout button
- [ ] Dark theme matching the Providence aesthetic (dark background, cyan/green accents)

**Overview Page (`StatsOverview.tsx`):**
- [ ] Stat cards row: total events, events last hour, events last 24h, active threats, active blocks
- [ ] Category distribution — pie or bar chart (Recharts) showing events by category
- [ ] Tier distribution — stacked bar: OBSERVE / RECOMMEND / ACT counts
- [ ] Timeline chart — events over time (area chart, last 24 hours, 1-hour buckets)
- [ ] Data from `GET /api/v1/events/stats` + `GET /api/v1/threats/active` + `GET /api/v1/blocks`
- [ ] Auto-refresh every 30 seconds (or on new WebSocket event)

**Attack Feed (`AttackFeed.tsx`):**
- [ ] Live scrolling table of events from WebSocket, newest at top
- [ ] Columns: timestamp, source IP, dest port, category, confidence (color-coded bar), tier badge, source component
- [ ] Color coding: OBSERVE = gray, RECOMMEND = yellow, ACT = red
- [ ] Click row → navigate to `EventDetail`
- [ ] Filter controls: category dropdown, tier dropdown, min confidence slider, source IP search
- [ ] Pagination for historical events via REST (infinite scroll or page buttons)

**Event Detail (`EventDetail.tsx`):**
- [ ] Full event fields displayed
- [ ] Feature importances — horizontal bar chart of top 10 features that contributed to classification
- [ ] Related incident (if any) — link to incident detail
- [ ] Response actions taken for this event
- [ ] Flow metadata: duration, packet count, byte count, JA3 hash

**Response Log (`ResponseLog.tsx`):**
- [ ] Two sections:
  1. **Active Blocks** — from `GET /api/v1/blocks`: IP, action, category, time remaining (countdown), unblock button (Admin only)
  2. **Action History** — from `GET /api/v1/actions`: paginated table of all past actions (block, rate_limit, unblock), with success/failure status, platform, timestamps
- [ ] Unblock button calls `DELETE /api/v1/blocks/{ip}` and refreshes the list

**Manual Override (`ManualOverride.tsx`):**
- [ ] Pending approvals section — incidents with `pendingApproval = true`:
  - Shows: source IP, category, confidence, recommended action, timestamp
  - Two buttons per row: **Approve** (green) and **Reject** (red) — Admin only
  - Approve calls `POST /api/v1/incidents/{id}/approve`
  - Reject calls `POST /api/v1/incidents/{id}/reject`
  - List refreshes after each action
- [ ] Manual block form (Admin only):
  - IP address input + TTL dropdown (1h, 6h, 24h, custom)
  - Calls `POST /api/v1/blocks` (or a new endpoint if needed — may require adding to Citadel)
  - Confirm dialog before execution

**Threat Map (`ThreatMap.tsx`):**

This component renders a 3D rotating globe with nation-state boundaries and threat markers. It is the most visually complex component in The Lens. The implementation is broken into sub-pieces below.

**Globe data source — GeoJSON boundaries:**
- [ ] Download Natural Earth 110m country boundaries GeoJSON (simplified, ~300KB):
  - URL: `https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json` (TopoJSON)
  - Or use the GeoJSON version: `https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson`
  - Save to `lens/public/world-110m.geojson` (loaded at runtime, not bundled into JS)
  - The 110m resolution is intentionally low-detail — it's a security dashboard globe, not Google Earth. Keeps render fast.

**Globe utility (`utils/globe.ts`):**
- [ ] Coordinate conversion — lat/lng to 3D point on a unit sphere:
  ```typescript
  // Converts geographic coordinates to 3D cartesian point on sphere surface
  // radius: sphere radius in Three.js units
  // lat: degrees, -90 to 90
  // lng: degrees, -180 to 180
  export function latLngToVector3(lat: number, lng: number, radius: number): THREE.Vector3 {
    const phi = (90 - lat) * (Math.PI / 180);    // polar angle from north pole
    const theta = (lng + 180) * (Math.PI / 180);  // azimuthal angle
    const x = -radius * Math.sin(phi) * Math.cos(theta);
    const y = radius * Math.cos(phi);
    const z = radius * Math.sin(phi) * Math.sin(theta);
    return new THREE.Vector3(x, y, z);
  }
  ```
- [ ] GeoJSON boundary line projection — convert GeoJSON polygons to 3D line segments:
  ```typescript
  // Takes a GeoJSON FeatureCollection (countries) and returns an array of
  // THREE.BufferGeometry line segments for rendering on the globe.
  //
  // For each polygon ring in each feature:
  //   1. Iterate over coordinate pairs [lng, lat]
  //   2. Convert each to 3D via latLngToVector3
  //   3. Add to a Float32Array as sequential line segment vertices
  //
  // Use THREE.LineSegments (not Line) for performance — avoids connecting
  // the last point of one country to the first point of the next.
  export function buildBoundaryGeometry(
    geojson: GeoJSON.FeatureCollection,
    radius: number
  ): THREE.BufferGeometry {
    const vertices: number[] = [];

    for (const feature of geojson.features) {
      const geometry = feature.geometry;
      const rings: number[][][] =
        geometry.type === 'Polygon'
          ? [geometry.coordinates[0]]            // outer ring only
          : geometry.type === 'MultiPolygon'
          ? geometry.coordinates.map(p => p[0])   // outer ring of each polygon
          : [];

      for (const ring of rings) {
        for (let i = 0; i < ring.length - 1; i++) {
          const [lng1, lat1] = ring[i];
          const [lng2, lat2] = ring[i + 1];
          const p1 = latLngToVector3(lat1, lng1, radius);
          const p2 = latLngToVector3(lat2, lng2, radius);
          vertices.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    return geo;
  }
  ```
- [ ] Arc line generator — curved line from source to destination on sphere surface:
  ```typescript
  // Creates a curved arc between two lat/lng points, raised above the sphere surface.
  // Used for threat source → your location visual arcs.
  // Returns a THREE.BufferGeometry curve.
  export function buildArcGeometry(
    lat1: number, lng1: number,
    lat2: number, lng2: number,
    radius: number,
    segments: number = 50,
    arcHeight: number = 0.3  // how far above the surface the arc peaks
  ): THREE.BufferGeometry {
    const start = latLngToVector3(lat1, lng1, radius);
    const end = latLngToVector3(lat2, lng2, radius);
    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    mid.normalize().multiplyScalar(radius + arcHeight); // raise midpoint above surface

    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    const points = curve.getPoints(segments);
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    return geo;
  }
  ```

**Globe component (`ThreatMap.tsx`) — Three.js scene setup:**
- [ ] React component structure:
  - `useRef<HTMLDivElement>` for the container div
  - `useEffect` on mount: create Scene, Camera, Renderer, attach to container
  - `useEffect` cleanup: dispose renderer, geometries, materials
  - Render loop via `requestAnimationFrame`
  - Resize handler for responsive canvas (`ResizeObserver` on container)

- [ ] Scene composition:
  1. **Sphere body** — `THREE.SphereGeometry(1, 64, 64)` with `THREE.MeshBasicMaterial`:
     - Color: `0x0a1a14` (dark Providence green-black)
     - Transparent: true, opacity: 0.95
     - This is the solid globe body, not wireframe
  2. **Country boundaries** — `THREE.LineSegments` using geometry from `buildBoundaryGeometry()`:
     - Material: `THREE.LineBasicMaterial({ color: 0x00ffc8, opacity: 0.25, transparent: true })`
     - Faint cyan lines on dark body — should be visible but not overpowering
  3. **Atmosphere glow** — `THREE.SphereGeometry(1.02, 64, 64)` with custom shader or simple:
     - `THREE.MeshBasicMaterial({ color: 0x00ffc8, opacity: 0.05, transparent: true, side: THREE.BackSide })`
     - Creates a subtle edge glow effect
  4. **Threat markers** — use `THREE.InstancedMesh` with `THREE.SphereGeometry(0.015, 8, 8)`:
     - One instance per threat source IP
     - Position set via instance matrix using `latLngToVector3(lat, lng, 1.005)` (slightly above surface)
     - Color set per instance via instance color buffer:
       - DOS: `0xff1744`, BRUTE_FORCE: `0xff6d00`, PROBE: `0xffd600`, INJECTION: `0x2979ff`, EXFILTRATION: `0xb388ff`, AI_AGENT: `0x00e5ff`
     - Scale set per instance based on `eventCount` (min 0.01, max 0.04 radius)
  5. **Arc lines** (optional) — from each threat source to a fixed destination point (your location):
     - Material: `THREE.LineBasicMaterial({ color: 0x00ffc8, opacity: 0.15, transparent: true })`
     - Only show arcs for ACT-tier events (to avoid clutter)

- [ ] Interaction:
  - **Auto-rotation:** Rotate globe group around Y axis at ~0.001 radians/frame
  - **Mouse drag:** On mousedown, record start position. On mousemove, compute delta and apply as rotation. On mouseup, resume auto-rotation. Use `pointer-events` on the canvas.
  - **Scroll zoom:** Adjust camera `position.z` between min 1.5 and max 4.0
  - **Hover detection:** Use `THREE.Raycaster` on mousemove to detect intersection with threat markers. On hit, show tooltip div (absolutely positioned HTML overlay, not a Three.js element) with IP, country, category, event count.
  - **Pause auto-rotation** while user is dragging or hovering a marker

- [ ] Data flow:
  - On mount and every 60 seconds: `GET /api/v1/events/geo?hours=24`
  - On new data: rebuild InstancedMesh instance matrices and colors
  - Keep a `Map<string, GeoThreat>` in state for tooltip lookups
  - New WebSocket events with geo data can incrementally add markers without full rebuild

- [ ] Layout:
  - Globe takes ~65% width of the page
  - Right panel (35%) shows: top 10 source countries table, total unique IPs, category breakdown
  - Globe container has a fixed aspect ratio (e.g., 1:1 or 4:3)

- [ ] Performance constraints:
  - Max 500 InstancedMesh instances (aggregate nearby IPs by rounding to 1 decimal degree if needed)
  - Max 50 arc lines (ACT-tier only, most recent)
  - `requestAnimationFrame` loop — no `setInterval`
  - Dispose all Three.js objects on unmount (prevents memory leaks)
  - Use `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))` to cap retina rendering

- [ ] Fallback: if `WebGLRenderingContext` is not available on the canvas:
  - Detect via `!!document.createElement('canvas').getContext('webgl')`
  - Show a flat SVG world outline with plotted circles instead (react-simple-maps or inline SVG)
  - Log warning: "WebGL unavailable, using flat map fallback"

- [ ] Top source countries summary panel beside the globe (top 10 by event count)

**Incident Detail (`IncidentDetail.tsx`):**
- [ ] All incident fields: event link, playbook used, actions taken, resolved status, notes
- [ ] Timeline: event detected → action taken → expiry/resolution
- [ ] Add notes form (Admin: `PATCH /api/v1/incidents/{id}`)
- [ ] Resolve button if not yet resolved

**Playbook Editor (`PlaybookEditor.tsx`):**
- [ ] List all playbooks from `GET /api/v1/playbooks`
- [ ] Each playbook expandable: shows category, actions, min confidence, TTL, enabled toggle
- [ ] Admin can edit: actions list, min confidence threshold, TTL, enabled status
- [ ] Save calls `PUT /api/v1/playbooks/{id}`
- [ ] Viewer sees playbooks read-only

**Model Metrics (`ModelMetrics.tsx`):**
- [ ] Classification confidence distribution — histogram of confidence values from recent events
- [ ] Per-category event counts over time
- [ ] False positive indicator: count of RECOMMEND events that were rejected (suggests over-classification)
- [ ] Data from `GET /api/v1/events/stats` and `GET /api/v1/incidents?resolved=false`
- [ ] Note: this is a basic view. Full model management (shadow scoring, swap, rollback) is Phase 6+.

**Acceptance criteria:**
- All pages render without errors
- Overview shows accurate stats from Citadel
- Attack feed updates in real-time via WebSocket
- Event detail shows feature importances chart
- Response log shows active blocks with working unblock button (Admin)
- Manual override shows pending approvals with working approve/reject (Admin)
- Playbook editor saves changes (Admin)
- Viewer role cannot see/use mutation buttons

---

### Task 6: Citadel — Geo IP Endpoint

**Requirements:**
- [ ] Add MaxMind GeoLite2 City database to Citadel (free, requires license key registration)
  - Or use `ip-api.com` as a server-side lookup with caching
- [ ] `GET /api/v1/events/geo?hours=24` — returns aggregated geo data:
  ```json
  [
    {
      "sourceIp": "185.220.101.34",
      "latitude": 51.2993,
      "longitude": 9.491,
      "country": "DE",
      "city": "Kassel",
      "category": "BRUTE_FORCE",
      "eventCount": 15,
      "lastSeen": "2026-04-11T08:30:00Z"
    }
  ]
  ```
- [ ] Cache geo lookups in Redis (IP → location, TTL 7 days) to avoid repeated lookups
- [ ] Group by source IP, return distinct IPs with location + aggregated counts

**Acceptance criteria:**
- `GET /api/v1/events/geo?hours=24` returns geo data for recent events
- Same IP doesn't trigger repeated geo lookups (Redis cache hit)
- Lens ThreatMap renders points at correct locations

---

### Task 7: Docker & CI

**Requirements:**
- [ ] `lens/Dockerfile`:
  ```dockerfile
  FROM node:20-alpine AS builder
  WORKDIR /app
  COPY package*.json ./
  RUN npm ci
  COPY . .
  RUN npm run build

  FROM nginx:alpine
  COPY --from=builder /app/dist /usr/share/nginx/html
  COPY nginx.conf /etc/nginx/conf.d/default.conf
  EXPOSE 3000
  ```
- [ ] `lens/nginx.conf`:
  - Serve static files from `/usr/share/nginx/html`
  - Proxy `/api/*` → `http://citadel:8080`
  - Proxy `/ws/*` → `ws://citadel:8080` (WebSocket upgrade)
  - SPA fallback: all non-API routes → `index.html`

- [ ] Update `docker-compose.yml`:
  ```yaml
  lens:
    build: ./lens
    ports:
      - "3000:3000"
    depends_on:
      - citadel
  ```

- [ ] `.github/workflows/ci-lens.yml`:
  ```yaml
  name: CI — Lens
  on:
    push:
      paths: ['lens/**']
    pull_request:
      paths: ['lens/**']
  jobs:
    build:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: 20
        - run: cd lens && npm ci
        - run: cd lens && npm run lint
        - run: cd lens && npm run build
  ```

**Acceptance criteria:**
- `docker-compose up --build` starts Lens + Citadel + PostgreSQL + Redis
- `http://localhost:3000` loads the dashboard login page
- Login → dashboard renders with live data from Citadel
- nginx proxies API and WebSocket requests correctly
- CI builds and lints without errors

---

## Scoped Out (Future Phases)

| Item | Phase |
|---|---|
| Model management UI (shadow scoring, swap, rollback) | Phase 6 |
| Cloud event views (Oracle-specific) | Phase 7 |
| Browser extension telemetry integration | Phase 8 |
| User registration / management | Out of scope (in-memory users are sufficient) |
| Mobile responsive layout | Stretch |

---

## Architecture Reference

```
┌─────────────────────────────────────────────────────┐
│                   THE LENS (React)                   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │ Login ──► JWT ──► localStorage                │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │  useWebSocket(/ws/events?token=...)           │   │
│  │  ├── Live events → AttackFeed                 │   │
│  │  ├── Live events → StatsOverview              │   │
│  │  └── Reconnect + backfill on disconnect       │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │  REST API (JWT in Authorization header)       │   │
│  │  ├── GET /events, /events/stats, /events/geo  │   │
│  │  ├── GET /incidents, POST approve/reject      │   │
│  │  ├── GET /blocks, DELETE /blocks/{ip}         │   │
│  │  ├── GET /actions                             │   │
│  │  ├── GET/PUT /playbooks                       │   │
│  │  └── GET /threats/active                      │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  Pages:                                              │
│  ├── Overview (stats + charts)                       │
│  ├── Events (live feed + historical)                 │
│  ├── Incidents (detail + approve/reject)             │
│  ├── Responses (active blocks + action history)      │
│  ├── Threats (geo map)                               │
│  ├── Playbooks (view/edit)                           │
│  └── Model Metrics (confidence + distribution)       │
└─────────────────────┬───────────────────────────────┘
                      │  nginx proxy
                      ▼
┌─────────────────────────────────────────────────────┐
│               THE CITADEL (:8080)                    │
│   REST + WebSocket + JWT Auth                        │
└─────────────────────────────────────────────────────┘
```

---

## Verification Checklist

When Phase 5 is complete, all of the following must be true:

- [ ] `docker-compose up --build` starts Lens + Citadel + PostgreSQL + Redis
- [ ] Login page authenticates with Admin and Viewer credentials
- [ ] JWT attached to all REST and WebSocket requests
- [ ] Admin sees mutation controls (approve, reject, unblock, edit playbooks)
- [ ] Viewer sees read-only dashboard (mutation controls hidden)
- [ ] WebSocket streams live events to AttackFeed in real-time
- [ ] WebSocket auto-reconnects with backfill on disconnect
- [ ] Overview page shows stats, category distribution, and timeline chart
- [ ] AttackFeed shows live + historical events with filtering
- [ ] EventDetail shows feature importances bar chart
- [ ] ResponseLog shows active blocks with countdown and unblock button
- [ ] ManualOverride shows pending approvals with approve/reject
- [ ] ThreatMap renders a rotating 3D globe with threat source IPs plotted from geo endpoint
- [ ] PlaybookEditor allows Admin to update playbook configurations
- [ ] ModelMetrics shows confidence distribution and per-category trends
- [ ] nginx proxies REST and WebSocket correctly in Docker
- [ ] CI builds and lints the Lens project
