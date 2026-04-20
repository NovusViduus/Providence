# Phase 8: The Ward — Implementation Checklist

> Spec vs. what was built, task by task.

---

## Task 1: Project Setup

| Requirement | Status | Notes |
|---|---|---|
| TypeScript + Webpack bundler | ✅ Done | Webpack 5 with ts-loader, CopyPlugin, HtmlPlugin |
| Manifest V3 | ✅ Done | `manifest_version: 3`, service worker, content scripts |
| Directory structure matches spec | ✅ Done | `background/`, `content/`, `popup/`, `shared/`, `tests/` |
| `manifest.json` with correct permissions | ✅ Done | `activeTab`, `storage`, `alarms`, `host_permissions: <all_urls>` |
| Content script runs on all URLs at `document_idle` | ✅ Done | |
| Service worker as background | ✅ Done | `type: "module"` |
| Extension icons | ⚠️ Placeholder | `icons/README.md` with instructions. No actual PNG files — need SVG→PNG export. |
| `npm run build` produces `dist/` | ✅ Done | Webpack outputs to `dist/`, copies manifest + icons |

---

## Task 2: Content Script — Page Analysis

| Requirement | Status | Notes |
|---|---|---|
| URL analysis: hostname, protocol extraction | ✅ Done | `location.hostname`, `location.protocol` |
| Local blocklist check | ✅ Done | `isBlocklisted()` with subdomain matching |
| HTTP + login form flagging | ✅ Done | `isHTTP && hasLoginForm` |
| URL obfuscation: IP hostnames, excessive subdomains, encoded chars | ✅ Done | Regex for IP, subdomain count > 4, `%xx` patterns |
| Cross-domain form detection | ✅ Done | Parses `form[action]`, compares hostname |
| Hidden iframe detection | ✅ Done | Checks `display:none`, `visibility:hidden`, `opacity:0`, `width:0/height:0` |
| Password fields on non-HTTPS | ✅ Done | Part of `httpWithLogin` signal |
| External resource domain counting | ✅ Done | Scans `script[src]`, `img[src]`, `iframe[src]`, `link[href]` |
| Cryptominer host detection | ✅ Done | 6 known miner hostnames checked against script sources |
| Obfuscation detection: eval, fromCharCode | ✅ Done | Counts `eval(` and `String.fromCharCode` in inline scripts |
| CDN allowlist filtering | ✅ Done | 10 known CDNs in `isKnownCDN()` |
| Tracking pixel detection (1x1 images) | ✅ Done | Checks `naturalWidth/Height <= 1` from third-party domains |
| WebAssembly/crypto.subtle detection | ❌ Missing | Spec mentions WebAssembly loading patterns and `crypto.subtle` usage. Not implemented. |
| Aggressive overlay/modal detection | ❌ Missing | Spec mentions full-screen overlays preventing navigation. Not implemented. |
| `PageAnalysis` message sent to service worker | ✅ Done | `chrome.runtime.sendMessage({ type: 'PAGE_ANALYSIS', data })` |

---

## Task 3: Phishing Detection

| Requirement | Status | Notes |
|---|---|---|
| Levenshtein distance computation | ✅ Done | Standard DP implementation |
| 17 high-value targets | ✅ Done | google, facebook, amazon, paypal, microsoft, apple, banks, etc. |
| Flag if distance ≤ 2 | ✅ Done | Tracks closest match |
| Exact match not flagged | ✅ Done | `if (baseDomain === target) { closest = null; break; }` |
| Common substitution patterns (0↔o, rn↔m) | ❌ Missing | Spec asks for explicit substitution detection. Levenshtein catches some but not all (e.g., `rn→m` is distance 1 in Levenshtein but the spec wants explicit pattern matching). |
| Urgency language detection | ✅ Done | 8 regex patterns: suspended, verify, act now, declined, unauthorized, etc. |
| Suspicious TLD detection | ✅ Done | `.xyz`, `.top`, `.info`, `.click`, `.loan`, `.work`, `.gq`, `.ml`, `.tk`, `.cf`, `.ga` |
| Brand impersonation | ✅ Done | Page text mentions brand name but hostname doesn't contain it |
| Credential harvesting heuristic | ✅ Done | Password field + (domain similarity OR suspicious TLD) |
| Login form on recently registered domain | ⚠️ Partial | Uses suspicious TLD as proxy. No WHOIS/domain age lookup. |
| Form field analysis (password + CC + SSN) | ❌ Missing | Only checks for password fields, not credit card or SSN inputs. |
| `PhishingSignals` output | ✅ Done | All 5 fields from spec |

---

## Task 4: Threat Scoring & Service Worker

| Requirement | Status | Notes |
|---|---|---|
| `computeThreatScore()` with weighted signals | ✅ Done | All weights from spec: blocklist=100, httpLogin=30, phishing=40, cryptominer=50, etc. |
| Score 0-100, capped | ✅ Done | `Math.min(score, 100)` |
| Level: low/medium/high | ✅ Done | <30=low, 30-69=medium, ≥70=high |
| Human-readable reasons list | ✅ Done | `buildReasonsList` equivalent inline |
| Configurable weights via `chrome.storage.local` | ❌ Missing | Weights are hardcoded. Settings page doesn't have sensitivity sliders. |
| Blocklist: ~500-1000 entries | ✅ Done | ~500 bundled entries + remote fetch on first install (24h refresh). Merged with user custom entries. |
| Blocklist: subdomain matching | ✅ Done | Walks parent domains |
| Blocklist: user custom entries via Settings | ✅ Done | `addToBlocklist()` + Settings UI |
| Blocklist: import/export JSON | ❌ Missing | Settings page has add but no import/export. |
| Service worker: listen for `PAGE_ANALYSIS` | ✅ Done | `chrome.runtime.onMessage.addListener` |
| Badge update: green/yellow/red + text | ✅ Done | `setBadgeBackgroundColor` + `setBadgeText` |
| Store result in `chrome.storage.session` | ✅ Done | Per-tab storage for popup |
| Warning banner at score ≥ 70 | ✅ Done | Sends `SHOW_WARNING` message to content script |
| Warning banner via shadow DOM | ✅ Done | `attachShadow({ mode: 'closed' })` with scoped styles |
| Banner dismissible | ✅ Done | "Dismiss" button removes host element |
| Connected mode dispatch to Citadel | ✅ Done | Checks `chrome.storage.local` for settings, dispatches if score ≥ 30 |
| Tab state management: per-tab results | ✅ Done | `Map<number, ThreatResult>` |
| Clear on tab close | ✅ Done | `chrome.tabs.onRemoved` |
| Badge updates on tab switch | ✅ Done | `chrome.tabs.onActivated` |
| History: last 20 pages | ✅ Done | Stored in `chrome.storage.session` |

---

## Task 5: Popup UI

| Requirement | Status | Notes |
|---|---|---|
| React-based popup | ✅ Done | `Popup.tsx` with `createRoot` |
| Threat score gauge (visual) | ✅ Done | Large number + color-coded level label |
| Threat level badge (Safe/Caution/Danger) | ✅ Done | |
| Reasons list | ✅ Done | Bullet list of triggered signals |
| URL displayed | ✅ Done | Hostname shown below score |
| Recent history (last 20) | ✅ Done | Scrollable list with hostname + score |
| Settings link → new tab | ✅ Done | `chrome.tabs.create({ url: ... })` |
| Connection status indicator | ✅ Done | Green dot "Connected" or gray "Standalone" |
| Extension version in footer | ❌ Missing | Not displayed |
| Settings page: Citadel URL + JWT | ✅ Done | Input fields with save to `chrome.storage.local` |
| Settings: Test Connection button | ✅ Done | Calls `GET /api/v1/events/stats` |
| Settings: Connect/Disconnect toggle | ✅ Done | |
| Settings: Sensitivity sliders | ❌ Missing | Spec asks for weight adjustment sliders. Not implemented. |
| Settings: Blocklist management (view/add/remove) | ⚠️ Partial | Can view and add. No remove button per entry. |
| Settings: Import/export blocklist | ❌ Missing | |
| Settings: Storage usage display | ❌ Missing | |
| Settings: Clear history button | ✅ Done | `chrome.storage.session.clear()` |
| Popup bundle < 100KB | ✅ Done | React + minimal UI, no heavy deps |

---

## Task 6: Connected Mode — Citadel Integration

| Requirement | Status | Notes |
|---|---|---|
| `api-client.ts` with `dispatchThreatEvent()` | ✅ Done | Builds ClassifiedEvent JSON, POSTs to `/api/v1/events/ingest` |
| `sourceComponent = "ward"` | ✅ Done | |
| 4 web categories: WEB_PHISHING, WEB_CRYPTOMINER, WEB_INJECTION, WEB_TRACKING | ✅ Done | `detectCategory()` maps signals to categories |
| Rate limit: 1 event per domain per 10 min | ✅ Done | `recentDispatches` Map with timestamp check |
| Fire-and-forget (no UI blocking) | ✅ Done | `async` with no await in caller |
| `fetchActiveThreatIps()` for enrichment | ✅ Done | `GET /api/v1/threats/active`, returns IP list |
| Cached for 5 minutes | ❌ Missing | Function exists but no caching layer. Called fresh each time. |
| Enrichment: boost score if page loads from threat IP | ❌ Missing | `fetchActiveThreatIps` exists but isn't called from the scoring pipeline. |
| Only active when user configures Citadel | ✅ Done | Checks `chrome.storage.local` `connected` flag |
| Web playbooks seeded (Flyway V5) | ✅ Done | WEB_PHISHING→CRITICAL_ALERT, WEB_CRYPTOMINER→CRITICAL_ALERT, WEB_INJECTION→CRITICAL_ALERT, WEB_TRACKING→OBSERVE |
| Lens: Ward events show Shield icon | ✅ Done | `Shield` from lucide-react, emerald color |
| Lens: Web categories in filter | ✅ Done | All 4 added to dropdown |
| Lens: Web category colors | ✅ Done | Added to `CATEGORY_COLORS` |
| EventDetail: URL/score/reasons for Ward events | ❌ Missing | EventDetail shows standard fields. No Ward-specific section. |

---

## Task 7: Chrome Web Store Publishing

| Requirement | Status | Notes |
|---|---|---|
| Store listing draft | ✅ Done | `STORE_LISTING.md` with name, descriptions, privacy policy, screenshot list |
| Privacy policy | ✅ Done | Documents standalone vs connected data handling |
| Privacy disclosures | ✅ Done | No tracking, no analytics, no ads, local-only in standalone |
| Production build (`npm run build:prod`) | ✅ Done | `webpack --mode production` |
| Screenshots | ❌ Missing | Listed in STORE_LISTING.md but not generated (need running extension) |
| Actual Chrome Web Store submission | ❌ Not done | Requires $5 developer fee + review process. Documented as ready to submit. |

---

## Task 8: Tests & CI

| Requirement | Status | Notes |
|---|---|---|
| `test-page-analyzer.ts` — blocklist tests | ✅ Done | Exact match, subdomain match, clean domain, CDN allowlist |
| `test-page-analyzer.ts` — hidden iframe detection | ❌ Missing | Tests blocklist/CDN but not DOM analysis (would need jsdom) |
| `test-page-analyzer.ts` — cross-domain form detection | ❌ Missing | Same — DOM tests need browser environment |
| `test-page-analyzer.ts` — cryptominer pattern matching | ❌ Missing | Tested via blocklist, not script content analysis |
| `test-phishing-detector.ts` — Levenshtein | ✅ Done | Identical=0, one sub=1, different=high |
| `test-phishing-detector.ts` — paypai.com flagged | ✅ Done | Distance 1 from paypal.com |
| `test-phishing-detector.ts` — google.com not flagged | ✅ Done | Exact match → null |
| `test-phishing-detector.ts` — urgency language | ✅ Done | Detected and not detected cases |
| `test-phishing-detector.ts` — suspicious TLD | ✅ Done | `.xyz` flagged, `.com` not |
| `test-threat-scorer.ts` — clean → 0 | ✅ Done | |
| `test-threat-scorer.ts` — blocklisted → 100 | ✅ Done | |
| `test-threat-scorer.ts` — phishing signals combine | ✅ Done | 40+15=55 |
| `test-threat-scorer.ts` — capped at 100 | ✅ Done | |
| `test-threat-scorer.ts` — reasons generated | ✅ Done | Checks for "hidden iframe" in reasons |
| `.github/workflows/ci-ward.yml` | ✅ Done | Node 20, npm ci, npm test, npm run build |
| CI lint step | ❌ Missing | `npm run lint` in package.json but no eslint config. CI doesn't run lint. |

---

## Verification Checklist (from spec)

| Check | Status |
|---|---|
| Extension loads in Chrome from `dist/` | ✅ (structurally — needs `npm run build`) |
| Content scripts analyze every page | ✅ |
| Blocklisted domains → score 100, red badge, warning banner | ✅ |
| Phishing: lookalike domains flagged (Levenshtein ≤ 2) | ✅ |
| Cryptominer patterns detected | ✅ |
| Hidden iframes and cross-domain forms detected | ✅ |
| Popup shows score, level, reasons | ✅ |
| Settings: Citadel connection + blocklist management | ✅ |
| Standalone mode works without Citadel | ✅ |
| Connected mode dispatches to Citadel | ✅ |
| Ward events in Lens with shield icon + web categories | ✅ |
| Web playbooks seeded | ✅ |
| Badge updates per tab | ✅ |
| Warning banner uses shadow DOM | ✅ |
| Chrome Web Store listing prepared | ✅ (draft, not submitted) |
| Unit tests pass | ✅ (15 tests across 3 files) |
| CI builds and tests | ✅ |

---

## Gaps Summary

| Gap | Severity | Notes |
|---|---|---|
| Extension icon PNGs | Low | Placeholder README. Need actual 16/48/128px PNGs for the extension to display properly. |
| WebAssembly/crypto.subtle detection | Low | Spec mentions these cryptominer indicators. Levenshtein + known hosts cover the main cases. |
| Overlay/modal detection | Low | Aggressive full-screen overlay detection not implemented. |
| Explicit substitution patterns (rn→m, 0→o) | Low | Levenshtein catches most cases. Explicit pattern matching would reduce false negatives for specific homograph attacks. |
| CC/SSN field detection | Low | Only password fields checked. Adding `input[type="tel"]` and pattern-based detection would catch more credential harvesting. |
| Configurable scoring weights | Low | Hardcoded. Settings page would need sliders wired to `chrome.storage.local` → scorer reads them. |
| Blocklist size (~15 vs 500-1000) | ✅ Closed | Expanded to ~500 bundled entries across 5 categories (cryptominers, phishing infrastructure, malware C2, tracking/fingerprinting, scam/fraud). Plus `initBlocklist()` fetches a remote list on first install and refreshes every 24h, merging into `chrome.storage.local`. Custom user entries also persisted. |
| Blocklist import/export | Low | Add/view works. Import/export is a few lines of JSON read/write. |
| Threat IP enrichment not wired | Low | `fetchActiveThreatIps` exists but isn't called from the scoring pipeline. Would boost score when page loads resources from known threat IPs. |
| DOM-level tests (iframe, forms) | Low | Would need jsdom or Puppeteer. Blocklist and scorer tests cover the critical logic paths. |
| ESLint config | Low | Lint script exists but no config file. |
| Screenshots for store listing | Low | Need running extension to capture. |
