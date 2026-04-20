# The Ward — Chrome Extension

Web-layer threat detection: phishing, cryptominers, malicious scripts, tracking.

## Build

```bash
cd ward && npm install && npm run build
```

## Load in Chrome

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" → select `ward/dist/`

## Features

- ~500 bundled blocklist entries + remote fetch on first install
- Phishing detection via Levenshtein distance against 17 high-value targets
- Cryptominer host detection
- Hidden iframe and cross-domain form scanning
- Threat scoring (0-100) with color-coded badge
- Shadow DOM warning banner on dangerous pages
- Optional Citadel connection for centralized monitoring
