# Phase 8: The Ward — Browser Extension

> Providence Network Security Intelligence Platform
> Component: The Ward — TypeScript Chrome Extension for Web-Layer Threat Detection
> Timeline: Weeks 21–22
> Prerequisites: Phase 5 (The Lens) complete for connected mode

---

## Goal

Build a Chrome extension (Manifest V3) that detects web-layer threats — phishing pages, cryptominers, malicious script injections, and suspicious tracking — directly in the user's browser. The Ward operates in two modes: standalone (local scoring, no backend dependency) and connected (dispatches telemetry to The Citadel, receives enriched threat intel). Publish to the Chrome Web Store.

---

## Deliverable

A published Chrome extension with standalone threat detection and optional Citadel connection. Content scripts analyze every page. Service worker coordinates scoring and alerting. Popup UI shows threat status and settings. Connected mode surfaces browser threats in The Lens dashboard alongside network and cloud events.

---

## Context

### Architecture (ADR-004)

The Ward is standalone by default with optional Citadel connection. This mirrors real security product freemium architecture — the extension works without Providence infrastructure, but gains enriched threat intelligence when connected.

### Data Flow

```
User browses the web
    │
    ▼
[Content Script — runs on every page]
    │  ├── URL reputation check (local blocklist)
    │  ├── DOM analysis (form targets, hidden iframes, suspicious inputs)
    │  ├── Script analysis (cryptominer patterns, injected code, obfuscation)
    │  ├── Phishing heuristics (domain similarity, urgency patterns, form targets)
    │  └── Resource analysis (external domains, suspicious CDN patterns)
    │
    ▼
[Service Worker — background processing]
    │  ├── Aggregates signals from content script
    │  ├── Computes threat score (0-100)
    │  ├── Updates badge icon (green/yellow/red)
    │  └── [Connected mode] Dispatches telemetry to Citadel
    │
    ▼
[Popup UI — user-facing]
    │  ├── Current page threat score + breakdown
    │  ├── Recent threat history
    │  └── Settings (Citadel connection, sensitivity)
```

### Communication with Citadel (Connected Mode)

| Path | Protocol | Data |
|---|---|---|
| Ward → Citadel | REST `POST /api/v1/events/ingest` | Classified web threat events (`source_component = "ward"`) |
| Citadel → Ward | REST `GET /api/v1/threats/active` | Active threat IPs (enrichment: "this IP was flagged by The Eye") |

---

## Tasks

### Task 1: Project Setup

**Requirements:**
- [ ] Initialize `ward/` project with TypeScript + Webpack/Vite bundler:
  ```
  ward/
  ├── manifest.json
  ├── package.json
  ├── tsconfig.json
  ├── webpack.config.js          # or vite.config.ts
  ├── src/
  │   ├── background/
  │   │   └── service-worker.ts
  │   ├── content/
  │   │   ├── page-analyzer.ts
  │   │   └── phishing-detector.ts
  │   ├── popup/
  │   │   ├── Popup.tsx
  │   │   ├── Settings.tsx
  │   │   └── popup.html
  │   └── shared/
  │       ├── threat-scorer.ts
  │       ├── blocklist.ts
  │       ├── api-client.ts
  │       └── types.ts
  ├── icons/
  │   ├── icon-16.png
  │   ├── icon-48.png
  │   └── icon-128.png
  └── tests/
      ├── test-page-analyzer.ts
      ├── test-phishing-detector.ts
      └── test-threat-scorer.ts
  ```

- [ ] `manifest.json` (Manifest V3):
  ```json
  {
    "manifest_version": 3,
    "name": "Providence Ward",
    "version": "1.0.0",
    "description": "Web-layer threat detection — phishing, cryptominers, malicious scripts",
    "permissions": ["activeTab", "storage", "alarms"],
    "host_permissions": ["<all_urls>"],
    "background": {
      "service_worker": "service-worker.js",
      "type": "module"
    },
    "content_scripts": [
      {
        "matches": ["<all_urls>"],
        "js": ["content-script.js"],
        "run_at": "document_idle"
      }
    ],
    "action": {
      "default_popup": "popup.html",
      "default_icon": {
        "16": "icons/icon-16.png",
        "48": "icons/icon-48.png",
        "128": "icons/icon-128.png"
      }
    },
    "icons": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  }
  ```

- [ ] Extension icons: Providence Eye logo in 16, 48, 128px variants (simple SVG → PNG export)
- [ ] Build pipeline: `npm run build` produces a `dist/` directory loadable as an unpacked extension

**Acceptance criteria:**
- `npm run build` produces valid extension in `dist/`
- Load unpacked in `chrome://extensions` → extension appears with icon
- Popup opens on click
- Content script runs on page load (verify via console log)

---

### Task 2: Content Script — Page Analysis

**Requirements:**
- [ ] `content/page-analyzer.ts` — runs on every page at `document_idle`:

  **URL analysis:**
  - Extract hostname, path, query parameters, protocol
  - Check against local blocklist (`shared/blocklist.ts`)
  - Flag HTTP (not HTTPS) pages with login forms as high risk
  - Detect URL obfuscation patterns: excessive subdomains, IP addresses as hostnames, encoded characters, lookalike unicode characters (homograph attacks)

  **DOM analysis:**
  - Scan for `<form>` elements: check `action` attribute — does the form submit to a different domain than the current page? (credential phishing indicator)
  - Detect hidden iframes: `<iframe>` with `display:none`, `visibility:hidden`, `width:0/height:0`, `opacity:0`
  - Detect password fields on non-HTTPS pages
  - Count external resource loads: how many distinct domains are scripts/images loaded from?
  - Detect aggressive overlay/modal patterns (full-screen overlays that prevent navigation)

  **Script analysis:**
  - Scan inline `<script>` content and loaded script URLs for patterns:
    - **Cryptominer detection:** known miner hostnames (`coinhive.com`, `cryptoloot.com`, `coin-hive.com`, etc.) + WebAssembly loading patterns + `crypto.subtle` usage in non-crypto contexts + high CPU Web Worker creation
    - **Obfuscation detection:** excessive `eval()`, `Function()` constructor, `atob()` chains, `String.fromCharCode()` patterns, packed/minified code with entropy > 5.0 in inline scripts
    - **Injection markers:** scripts loaded from unexpected domains (not the page's own domain, not known CDNs)
  - Known CDN allowlist: `cdnjs.cloudflare.com`, `unpkg.com`, `cdn.jsdelivr.net`, `ajax.googleapis.com`, `fonts.googleapis.com`, etc.

  **Resource analysis:**
  - Count total external domains loaded (scripts, images, iframes, stylesheets)
  - Flag pages loading from > 15 distinct external domains (fingerprinting/tracking indicator)
  - Detect tracking pixel patterns: 1x1 images from third-party domains

- [ ] Output: send a `PageAnalysis` message to the service worker via `chrome.runtime.sendMessage`:
  ```typescript
  interface PageAnalysis {
    url: string;
    hostname: string;
    timestamp: number;
    signals: {
      blocklisted: boolean;
      httpWithLogin: boolean;
      urlObfuscation: boolean;
      crossDomainForms: string[];        // list of external form action domains
      hiddenIframes: number;
      cryptominerPatterns: string[];      // matched pattern descriptions
      obfuscatedScripts: number;
      suspiciousScriptDomains: string[];  // script sources not on CDN allowlist
      externalDomainCount: number;
      trackingPixels: number;
    };
  }
  ```

**Acceptance criteria:**
- Content script runs on page load and sends analysis to service worker
- Test page with a hidden iframe → `hiddenIframes: 1`
- Test page with cross-domain form → `crossDomainForms` populated
- Known cryptominer domain in script src → detected
- Normal page (e.g., example.com) → all signals clean

---

### Task 3: Phishing Detection

**Requirements:**
- [ ] `content/phishing-detector.ts` — specialized phishing heuristics:

  **Domain similarity scoring:**
  - Compare current hostname against a list of high-value targets: `google.com`, `facebook.com`, `amazon.com`, `paypal.com`, `microsoft.com`, `apple.com`, `bankofamerica.com`, `chase.com`, `wellsfargo.com`, etc.
  - Compute Levenshtein distance from each target
  - Flag if distance ≤ 2 (e.g., `g00gle.com`, `paypai.com`, `arnazon.com`)
  - Detect common substitution patterns: `0↔o`, `1↔l`, `rn↔m`, `vv↔w`

  **Page content heuristics:**
  - Urgency language detection: scan visible text for patterns like "your account has been suspended", "verify your identity immediately", "act now", "your payment was declined", "unusual activity detected"
  - Login form on recently registered domain (if WHOIS data available via API, or use domain age heuristic: `.xyz`, `.top`, `.info` TLDs with random-looking domain names)
  - Brand impersonation: page contains logos/text of high-value targets but hostname doesn't match
  - Form field analysis: presence of password + credit card + SSN fields on same page

  **TLS certificate checks (limited in content scripts):**
  - Content scripts can't directly access cert info, but can detect:
    - `http://` scheme on a page requesting credentials
    - Mixed content warnings (HTTP resources on HTTPS pages)

- [ ] Output: `PhishingAnalysis` merged into the `PageAnalysis` message:
  ```typescript
  interface PhishingSignals {
    domainSimilarity: { target: string; distance: number } | null;
    urgencyLanguage: boolean;
    suspiciousTLD: boolean;
    brandImpersonation: boolean;
    credentialHarvesting: boolean;  // login form + non-matching domain
  }
  ```

**Acceptance criteria:**
- `paypai.com` → flagged with `domainSimilarity: { target: "paypal.com", distance: 1 }`
- Page with "your account has been suspended" → `urgencyLanguage: true`
- Login form on `.xyz` domain → `suspiciousTLD: true`
- `google.com` → all signals clean (exact match, not flagged)

---

### Task 4: Threat Scoring & Service Worker

**Requirements:**
- [ ] `shared/threat-scorer.ts` — computes a 0-100 threat score from `PageAnalysis`:
  ```typescript
  function computeThreatScore(analysis: PageAnalysis): ThreatResult {
    let score = 0;

    // URL signals
    if (analysis.signals.blocklisted) score += 100;  // instant max
    if (analysis.signals.httpWithLogin) score += 30;
    if (analysis.signals.urlObfuscation) score += 25;

    // Phishing signals
    if (analysis.phishing?.domainSimilarity && analysis.phishing.domainSimilarity.distance <= 2) score += 40;
    if (analysis.phishing?.urgencyLanguage) score += 15;
    if (analysis.phishing?.credentialHarvesting) score += 35;
    if (analysis.phishing?.brandImpersonation) score += 30;

    // Script signals
    if (analysis.signals.cryptominerPatterns.length > 0) score += 50;
    if (analysis.signals.obfuscatedScripts > 2) score += 20;
    score += Math.min(analysis.signals.suspiciousScriptDomains.length * 5, 25);

    // DOM signals
    if (analysis.signals.hiddenIframes > 0) score += 15;
    if (analysis.signals.crossDomainForms.length > 0) score += 25;
    if (analysis.signals.trackingPixels > 5) score += 10;

    return {
      score: Math.min(score, 100),
      level: score >= 70 ? "high" : score >= 30 ? "medium" : "low",
      reasons: buildReasonsList(analysis),  // human-readable list of why
    };
  }
  ```
  - Weights are configurable via `chrome.storage.local` (user can adjust sensitivity)
  - Returns: `{ score, level, reasons[] }`

- [ ] `shared/blocklist.ts`:
  - Hardcoded list of known malicious domains (~500-1000 entries)
  - Sources: PhishTank top domains, known cryptominer hosts, common malware C2 domains
  - Stored as a `Set<string>` for O(1) lookup
  - User can add custom entries via Settings page
  - Check both exact match and subdomain match (e.g., blocklist entry `evil.com` matches `sub.evil.com`)

- [ ] `background/service-worker.ts`:
  - Listen for `chrome.runtime.onMessage` from content scripts
  - On `PageAnalysis` received:
    1. Compute threat score via `computeThreatScore()`
    2. Update extension badge:
       - Score 0-29: green badge, no text
       - Score 30-69: yellow badge, text "!"
       - Score 70-100: red badge, text "⚠"
       - Use `chrome.action.setBadgeBackgroundColor()` and `chrome.action.setBadgeText()`
    3. Store result in `chrome.storage.session` for popup to read
    4. If score ≥ 70: show a warning banner by sending a message back to content script
    5. [Connected mode] If Citadel URL configured: dispatch event via `api-client.ts`

  - **Warning banner injection** (content script side):
    - On receiving "show warning" message from service worker:
    - Inject a fixed-position banner at top of page: red background, white text, "Providence Ward: This page may be dangerous — [Details] [Dismiss]"
    - "Details" opens the popup. "Dismiss" hides the banner (user choice respected).
    - Banner injected via shadow DOM to avoid CSS conflicts with the page

  - **Tab state management:**
    - Track per-tab analysis results: `Map<number, ThreatResult>`
    - Clear on tab close (`chrome.tabs.onRemoved`)
    - Update badge per active tab (`chrome.tabs.onActivated`)

**Acceptance criteria:**
- Service worker receives page analysis and updates badge color/text
- Blocklisted domain → score 100, red badge
- Clean page → score 0, green badge
- Score ≥ 70 → warning banner injected on page (dismissible)
- Tab switching updates badge to reflect the active tab's score

---

### Task 5: Popup UI

**Requirements:**
- [ ] `popup/Popup.tsx` — React-based popup (small footprint, bundled into popup.html):

  **Current page view (default):**
  - Threat score gauge: circular or bar visualization (0-100, color-coded)
  - Threat level badge: "Safe" / "Caution" / "Danger"
  - Reasons list: what triggered the score (human-readable, e.g., "Cross-domain login form detected", "Domain similar to paypal.com")
  - URL displayed at top

  **Recent history view:**
  - Last 20 pages visited with their scores
  - Stored in `chrome.storage.session`
  - Click an entry to see its breakdown

  **Footer:**
  - "Settings" link → opens Settings page
  - Connection status: "Standalone" or "Connected to Providence" (with green/gray dot)
  - Extension version

- [ ] `popup/Settings.tsx` — full-page settings (opens in new tab via `chrome.tabs.create`):

  **Citadel connection:**
  - Citadel URL input (e.g., `https://my-providence.example.com`)
  - JWT token input (or username/password that authenticates against `POST /auth/login`)
  - "Test Connection" button → calls `GET /api/v1/events/stats`, shows success/failure
  - "Connect" / "Disconnect" toggle
  - Connection status displayed

  **Sensitivity adjustment:**
  - Sliders or dropdowns for score weights (phishing, cryptominer, scripts, tracking)
  - "Reset to defaults" button

  **Blocklist management:**
  - View current blocklist entries
  - Add custom domain
  - Remove domain
  - Import/export as JSON

  **Data:**
  - "Clear history" button
  - Storage usage display

- [ ] Settings stored in `chrome.storage.local` (persists across sessions)
- [ ] Popup uses React but should be lightweight — aim for < 100KB total popup bundle

**Acceptance criteria:**
- Popup shows current page's threat score and reasons
- History shows last 20 pages
- Settings page opens in new tab
- Citadel connection can be configured and tested
- Custom blocklist entries persist across browser restarts

---

### Task 6: Connected Mode — Citadel Integration

**Requirements:**
- [ ] `shared/api-client.ts`:
  - `dispatchThreatEvent(analysis, score)`:
    - Build a `ClassifiedEvent`-compatible JSON body:
      ```json
      {
        "sourceIp": "<page hostname — not a real IP, but the domain>",
        "destIp": "127.0.0.1",
        "destPort": 443,
        "protocol": "HTTPS",
        "category": "<WEB_PHISHING | WEB_CRYPTOMINER | WEB_INJECTION | WEB_TRACKING>",
        "confidence": 0.85,
        "sourceComponent": "ward",
        "eventId": "<generated UUID>"
      }
      ```
    - POST to `{citadelUrl}/api/v1/events/ingest` with JWT
    - Fire-and-forget: don't block the UI on network failures
    - Rate limit: max 1 event per domain per 10 minutes (avoid flooding Citadel with repeat visits)

  - `fetchActiveThreatIps()`:
    - GET `{citadelUrl}/api/v1/threats/active`
    - Returns list of IPs currently blocked by Providence (from Eye/Oracle detections)
    - Used for enrichment: if the page loads resources from a threat IP, boost the score
    - Cached for 5 minutes

  - Only active when user has configured and connected Citadel in Settings

- [ ] **New web threat categories** — add to Providence taxonomy:
  - `WEB_PHISHING`: phishing page detected
  - `WEB_CRYPTOMINER`: cryptominer script detected
  - `WEB_INJECTION`: suspicious script injection detected
  - `WEB_TRACKING`: excessive tracking/fingerprinting detected

- [ ] **Citadel side:**
  - The existing `POST /api/v1/events/ingest` endpoint handles Ward events (same as Oracle)
  - Seed web playbooks via Flyway migration:
    - WEB_PHISHING → CRITICAL_ALERT, no firewall action (can't block a website from the server)
    - WEB_CRYPTOMINER → ALERT
    - WEB_INJECTION → ALERT
    - WEB_TRACKING → OBSERVE (info only)
  - Ward events appear in The Lens with a `Shield` icon (lucide-react) for `source_component = "ward"`

- [ ] **Lens updates:**
  - AttackFeed: Ward events show shield icon
  - Category filter: includes WEB_PHISHING, WEB_CRYPTOMINER, WEB_INJECTION, WEB_TRACKING
  - EventDetail: for Ward events, show URL, threat score, reasons list instead of flow metadata

**Acceptance criteria:**
- With Citadel connected: visiting a blocklisted page creates an event in Citadel
- Event appears in The Lens with shield icon and WEB_PHISHING category
- Without Citadel: extension works fully standalone (no errors, no network calls)
- Rate limiting prevents duplicate events for the same domain

---

### Task 7: Chrome Web Store Publishing

**Requirements:**
- [ ] Prepare store listing:
  - Extension name: "Providence Ward"
  - Short description (132 chars max): "Real-time web threat detection — phishing, cryptominers, malicious scripts. Part of the Providence security platform."
  - Detailed description: explain standalone + connected modes, what it detects, privacy stance
  - Screenshots: popup on clean page, popup on dangerous page, warning banner, settings page (4-5 screenshots)
  - Category: "Productivity" or "Developer Tools"
  - Privacy policy: document what data is collected (nothing leaves the browser in standalone mode; connected mode sends threat events to user-configured server only)

- [ ] Prepare privacy disclosures:
  - Extension reads page content for security analysis only
  - No data sent to any server in standalone mode
  - Connected mode sends threat telemetry only to user-configured Citadel server
  - No user tracking, no analytics, no ads
  - All analysis happens locally in the browser

- [ ] Build production bundle:
  - `npm run build:prod` → minified, optimized `dist/`
  - Zip `dist/` for upload
  - Test the zip file loads correctly as unpacked extension

- [ ] Submit to Chrome Web Store Developer Dashboard
  - Requires $5 one-time developer registration fee
  - Review typically takes 1-3 business days
  - Address any review feedback

**Acceptance criteria:**
- Store listing draft complete with description, screenshots, privacy policy
- Production zip builds and loads correctly
- Submitted to Chrome Web Store (acceptance may be pending review)

---

### Task 8: Tests & CI

**Requirements:**
- [ ] `tests/test-page-analyzer.ts`:
  - Unit test: hidden iframe detection (various hiding techniques)
  - Unit test: cross-domain form detection
  - Unit test: cryptominer pattern matching
  - Unit test: CDN allowlist filtering
  - Unit test: external domain counting

- [ ] `tests/test-phishing-detector.ts`:
  - Unit test: Levenshtein distance computation
  - Unit test: `paypai.com` → distance 1 from `paypal.com`
  - Unit test: `google.com` → exact match, not flagged
  - Unit test: urgency language detection
  - Unit test: suspicious TLD detection

- [ ] `tests/test-threat-scorer.ts`:
  - Unit test: clean analysis → score 0
  - Unit test: blocklisted domain → score 100
  - Unit test: phishing signals combine correctly
  - Unit test: score capped at 100
  - Unit test: reasons list generated

- [ ] `.github/workflows/ci-ward.yml`:
  ```yaml
  name: CI — Ward
  on:
    push:
      paths: ['ward/**']
    pull_request:
      paths: ['ward/**']
  jobs:
    build:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: 20
        - run: cd ward && npm ci
        - run: cd ward && npm run lint
        - run: cd ward && npm test
        - run: cd ward && npm run build
  ```

**Acceptance criteria:**
- `npm test` passes all unit tests
- `npm run build` produces valid extension
- CI passes on push to `ward/`

---

## Scoped Out

| Item | Phase |
|---|---|
| Firefox extension port | Stretch |
| Safari extension port | Stretch |
| Page content blocking (like uBlock) | Out of scope — Ward detects, doesn't block content |
| Machine learning in the extension | Out of scope — analysis is heuristic/rule-based |
| Real-time page content modification | Out of scope beyond warning banner |

---

## Architecture Reference

```
┌───────────────────────────────────────────────────┐
│              CHROME BROWSER                        │
│                                                    │
│  ┌──────────────────────────────────────────────┐ │
│  │         CONTENT SCRIPTS (per tab)             │ │
│  │  page-analyzer.ts + phishing-detector.ts      │ │
│  │  ├── URL analysis                             │ │
│  │  ├── DOM scanning (forms, iframes)            │ │
│  │  ├── Script pattern matching                  │ │
│  │  ├── Phishing heuristics                      │ │
│  │  └── sendMessage(PageAnalysis) ──────────┐    │ │
│  │                                           │    │ │
│  │  [Warning banner injection via shadow DOM]│    │ │
│  └───────────────────────────────────────────┘    │ │
│                                              │    │ │
│  ┌───────────────────────────────────────────▼──┐ │
│  │         SERVICE WORKER (background)          │ │
│  │  ├── Receive PageAnalysis                    │ │
│  │  ├── computeThreatScore()                    │ │
│  │  ├── Update badge (green/yellow/red)         │ │
│  │  ├── Store result (chrome.storage.session)   │ │
│  │  ├── [score ≥ 70] → inject warning banner   │ │
│  │  └── [connected] → dispatch to Citadel       │ │
│  └──────────────────────────────────────────────┘ │
│                                                    │
│  ┌──────────────────────────────────────────────┐ │
│  │         POPUP UI (React)                      │ │
│  │  ├── Threat score gauge + reasons             │ │
│  │  ├── Recent history (last 20)                 │ │
│  │  └── Settings link                            │ │
│  └──────────────────────────────────────────────┘ │
│                                                    │
│  ┌──────────────────────────────────────────────┐ │
│  │         SETTINGS PAGE (React, new tab)        │ │
│  │  ├── Citadel URL + JWT config                 │ │
│  │  ├── Sensitivity sliders                      │ │
│  │  └── Blocklist management                     │ │
│  └──────────────────────────────────────────────┘ │
└────────────────────┬──────────────────────────────┘
                     │ REST (connected mode only)
                     ▼
          ┌──────────────────────┐
          │    THE CITADEL       │
          │  POST /events/ingest │
          │  source_component:   │
          │  "ward"              │
          └──────────────────────┘
```

---

## Verification Checklist

When Phase 8 is complete, all of the following must be true:

- [ ] Extension loads in Chrome from unpacked `dist/` directory
- [ ] Content scripts analyze every page and send signals to service worker
- [ ] Blocklisted domains score 100, badge turns red, warning banner injected
- [ ] Phishing detection flags lookalike domains (Levenshtein ≤ 2)
- [ ] Cryptominer script patterns detected (known hosts + WebAssembly indicators)
- [ ] Hidden iframes and cross-domain forms detected
- [ ] Popup shows threat score, level, and human-readable reasons
- [ ] Settings page allows Citadel connection + blocklist management
- [ ] Standalone mode works fully without any Citadel connection
- [ ] Connected mode dispatches web threat events to Citadel via REST
- [ ] Ward events appear in The Lens with shield icon and web categories
- [ ] Web playbooks seeded in Citadel
- [ ] Badge updates per tab (switching tabs shows correct score)
- [ ] Warning banner uses shadow DOM (no CSS conflicts with page)
- [ ] Chrome Web Store listing prepared and submitted
- [ ] Unit tests pass for page analysis, phishing detection, and threat scoring
- [ ] CI builds and tests the extension
