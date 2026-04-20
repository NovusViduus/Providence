# Providence - TODO

## Priority: High (Before Poster)

### AWS Deployment
- [ ] Deploy full Docker Compose stack to EC2 (t3.medium or larger)
- [ ] Set up ALB with ACM certificate for HTTPS
- [ ] Point domain at ALB
- [ ] Set environment variables for AWS credentials and bucket names in docker-compose
- [ ] Verify WebSocket works over wss:// through the ALB
- [ ] Test QR code on login screen resolves to the live HTTPS URL
- [ ] Assign Elastic IPs to honeypot instances (IPs change on stop/start)
- [ ] Update HONEYPOT_LOCATIONS in globe.ts if IPs change

### Live Data Pipeline
- [ ] Configure Oracle with real AWS credentials to pull VPC Flow Logs from S3
- [ ] Run one-time import of cached honeypot data (282,860 sessions) through the ingest API
- [ ] Set up cron job to rebuild timelapse.json from the database periodically
- [ ] Verify Eye on all 3 honeypots is forwarding events to the deployed Citadel
- [ ] Test end-to-end: attacker hits honeypot -> Eye classifies -> Citadel ingests -> Lens displays
- [ ] Verify notification bell fires on live ACT-tier events
- [ ] Verify sound effects play on live events
- [ ] Verify ambient drone triggers on ACT-tier events (20s burst)

### Rebuild and Deploy
- [ ] `docker compose build --no-cache citadel lens`
- [ ] `docker compose up -d citadel lens`
- [ ] Verify CORS works from production domain (SecurityConfig allows all origins)
- [ ] Verify admin password is `Khal` in production
- [ ] Verify Flyway V6 migration runs (fixes BENIGN tier in existing data)
- [ ] Test the native query for event filtering
- [ ] Verify new color palette renders correctly (navy backgrounds, teal accents)
- [ ] Test CRT effects (dot grid, snow, scan line, vignette)

### Demo Prep
- [ ] Record 15-20s demo GIF (globe with arcs -> timelapse -> terminal replay -> codex mascots)
  - Record with OBS, trim with ffmpeg
  - `ffmpeg -i demo.mp4 -vf "fps=15,scale=800:-1" -loop 0 demo.gif`
  - Keep under 10MB for GitHub
- [ ] Embed GIF in README.md (uncomment the placeholder)
- [ ] Test demo mode cycles through all 14 tabs with correct timing
- [ ] Test mobile layout on actual phones (have someone scan the QR code)
- [ ] Test screensaver mini-game works (ESC or button to dismiss)
- [ ] Test terminal replay sessions play correctly
- [ ] Test music player evolving synth doesn't conflict with sound effects
- [ ] Test notification bell + browser notifications in background tab
- [ ] Test report generation produces clean PDF

## Priority: Medium (Post-Poster Polish)

### Live Behavior Clustering
- [ ] Pull Cowrie JSON logs from S3 (`s3://providence-honeypot-data/`)
- [ ] Write Python script to extract command sequences per session
- [ ] Run TF-IDF vectorization on command sequences
- [ ] K-means clustering (k=5, validate with silhouette score)
- [ ] Map cluster labels back to source IPs
- [ ] Create API endpoint to serve cluster data from Citadel
- [ ] Replace static `clusters.json` with live data from the API
- [ ] Add cluster coloring to the 3D globe (color markers by behavioral archetype)

### Live Terminal Replays
- [ ] Ingest Cowrie JSON session logs into Citadel (new endpoint)
- [ ] Parse keystroke-level timing from Cowrie logs
- [ ] Create API endpoint: GET /api/v1/sessions/:ip
- [ ] Replace static `sessions.json` with live data from the API
- [ ] Add more session recordings from real Cowrie logs

### Live Command Heatmap
- [ ] Parse commands from Cowrie session logs
- [ ] Aggregate and categorize by MITRE ATT&CK tactics
- [ ] Create API endpoint to serve heatmap data
- [ ] Replace static `command_heatmap.json` with live data

### Claude AI Integration (Optional)
- [ ] Add `/api/v1/briefing` endpoint in Citadel that proxies to Anthropic API
- [ ] Pass event stats, geo data, and recent incidents as context
- [ ] Replace deterministic briefing generator with Claude-powered analysis
- [ ] Add chat input for ad-hoc questions ("what's unusual about this IP?")
- [ ] Rate limit API calls to control costs

### Attacker Dossier Enhancements
- [ ] Add Cowrie shell command history to dossier pages (requires Cowrie log ingestion)
- [ ] Add credential attempts (username/password pairs tried) from Cowrie logs
- [ ] Add "Related Attackers" section (same /24 subnet, same ISP, same behavioral cluster)
- [ ] Add IP reputation lookup (AbuseIPDB, Shodan) as optional enrichment
- [ ] Surface "Most Wanted" top 5 attackers on the Dashboard
- [ ] Add category background tints on dossier event rows (8% opacity)

### Mobile Responsiveness
- [ ] Test all 22 views on iPhone and Android
- [ ] Reduce Three.js quality on mobile (lower pixel ratio, fewer stars/arcs)
- [ ] Add touch controls for globe rotation (pinch to zoom, swipe to rotate)
- [ ] Test screensaver game with touch events
- [ ] Test notification bell dropdown positioning on mobile
- [ ] Test topology canvas renders correctly on small screens

### Security Hardening
- [ ] Add rate limiting to the login endpoint
- [ ] Add CSRF protection for non-API routes
- [ ] Rotate JWT secret via environment variable in production
- [ ] Add security group automation script (auto-add current IP for management SSH)
- [ ] Set up log rotation on honeypot instances

## Priority: Low (Future Enhancements)

### Ward Browser Extension
- [ ] Run `npm run build` in ward/
- [ ] Test in Chrome with developer mode
- [ ] Create icon PNGs for Chrome Web Store
- [ ] Submit to Chrome Web Store

### Additional ML
- [ ] Train Eye-native model on full 31 features (currently using 16 intersection features)
- [ ] Experiment with LSTM/CNN for AI agent detection
- [ ] Add model A/B testing support in the ML service
- [ ] Track model drift over time as attack patterns evolve

### Infrastructure
- [ ] Terraform automation for honeypot deployment
- [ ] GitHub Actions CD pipeline for auto-deploy on push
- [ ] Prometheus + Grafana for infrastructure monitoring
- [ ] S3 lifecycle policies for old honeypot logs
- [ ] Cost alerting via AWS Budgets

### Lens Features
- [ ] Dark/light theme toggle
- [ ] Export incident reports as PDF with globe screenshot
- [ ] Webhook notifications (Slack, Discord) for ACT-tier events
- [ ] Saved filters/views for the events table
- [ ] Keyboard shortcuts for power users
- [ ] Globe screenshot/share button
- [ ] Topology view: make nodes draggable
- [ ] Briefing: add "ask a question" input for future Claude integration
- [ ] Category background tints on event/attacker rows
