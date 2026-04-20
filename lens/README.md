# The Lens — React Dashboard

Real-time security monitoring with 3D threat globe, attack feed, response log, and manual override panel.

## Development

```bash
cd lens && npm install && npm run dev
# Opens at http://localhost:5173, proxies API to localhost:8080
```

## Build

```bash
npm run build  # Output in dist/
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| VITE_API_URL | /api/v1 | Citadel API base URL |
