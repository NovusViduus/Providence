# Chrome Web Store Listing — Providence Ward

## Name
Providence Ward

## Short Description (132 chars)
Real-time web threat detection — phishing, cryptominers, malicious scripts. Part of the Providence security platform.

## Detailed Description
Providence Ward protects you while browsing by analyzing every page for web-layer threats in real-time.

Detects:
- Phishing pages (lookalike domains, urgency language, credential harvesting)
- Cryptominer scripts (known miner hosts, WebAssembly patterns)
- Malicious script injections (obfuscated code, suspicious external scripts)
- Excessive tracking and fingerprinting

Two modes:
- Standalone: All analysis happens locally in your browser. No data leaves your machine.
- Connected: Optionally connect to a Providence Citadel server for enriched threat intelligence and centralized monitoring.

## Privacy Policy
- All page analysis happens locally in the browser
- No data is sent to any server in standalone mode
- Connected mode sends threat telemetry only to a user-configured Providence Citadel server
- No user tracking, no analytics, no ads, no third-party data sharing
- The extension reads page content solely for security analysis

## Category
Developer Tools

## Screenshots Needed
1. Popup on a clean page (score 0, green "Safe")
2. Popup on a dangerous page (score 85, red "Danger" with reasons)
3. Warning banner injected on a phishing page
4. Settings page with Citadel connection
5. Recent history view in popup
