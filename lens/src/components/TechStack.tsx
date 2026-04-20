const COMPONENTS = [
  {
    name: 'The Eye',
    lang: 'C++17',
    color: '#00599C',
    icon: '👁',
    description: 'Real-time packet capture and feature extraction engine deployed on AWS honeypots. Captures raw network traffic, extracts 31 flow-level features, and sends classified events to Citadel via gRPC.',
    tech: ['libpcap', 'gRPC', 'Protocol Buffers', 'CMake', 'Ubuntu 24.04 LTS'],
    stats: '22K+ flows classified across 3 AWS regions',
  },
  {
    name: 'The Citadel',
    lang: 'Java / Spring Boot',
    color: '#5382a1',
    icon: '🏰',
    description: 'Central command server. Ingests classified events, runs the tiered response engine (OBSERVE → RECOMMEND → ACT), manages firewall rules, and serves the REST/WebSocket/gRPC APIs.',
    tech: ['Spring Boot 3', 'Spring Security', 'JPA/Hibernate', 'PostgreSQL', 'Redis', 'gRPC', 'Flyway', 'JWT', 'WebSocket'],
    stats: 'Handles event ingestion, incident management, and automated response',
  },
  {
    name: 'The Oracle',
    lang: 'Python',
    color: '#3776AB',
    icon: '🔮',
    description: 'Cloud intelligence pipeline. Pulls AWS VPC Flow Logs and CloudTrail events from S3, classifies them using the ML model, and pushes results to Citadel for correlation with honeypot data.',
    tech: ['boto3', 'AWS S3', 'VPC Flow Logs', 'CloudTrail', 'REST client'],
    stats: 'Processes flow logs from 3 AWS regions',
  },
  {
    name: 'ML Pipeline',
    lang: 'Python',
    color: '#F7931E',
    icon: '🧠',
    description: 'Machine learning training and serving pipeline. Trained on 2.8M CICIDS-2017 network flows, validated against live honeypot traffic. Serves predictions via gRPC for real-time classification.',
    tech: ['scikit-learn', 'LightGBM', 'PyTorch', 'pandas', 'NumPy', 'gRPC', 'CICIDS-2017'],
    stats: '2.8M training flows, 6 attack categories, validated on live traffic',
  },
  {
    name: 'The Lens',
    lang: 'TypeScript / React',
    color: '#61DAFB',
    icon: '🔭',
    description: 'Real-time security dashboard and visualization frontend. Features a 3D threat globe, timelapse playback, interactive codex, and the full incident management workflow.',
    tech: ['React 18', 'TypeScript', 'Three.js', 'Vite', 'Tailwind CSS', 'Recharts', 'WebSocket', 'React Router'],
    stats: '15 interactive views, 3D globe with live attack arcs, screensaver mini-game',
  },
  {
    name: 'The Ward',
    lang: 'TypeScript',
    color: '#4FC08D',
    icon: '🛡',
    description: 'Browser extension for client-side threat detection. Analyzes visited URLs for phishing indicators, cryptominer scripts, and malicious injection patterns in real-time.',
    tech: ['Chrome Extension API', 'TypeScript', 'Content Scripts', 'URL analysis'],
    stats: 'Real-time browser-level protection',
  },
  {
    name: 'The Lure',
    lang: 'Cowrie / Dionaea',
    color: '#ff6d00',
    icon: '🍯',
    description: 'Global honeypot fleet across 3 AWS regions. Each instance disguises as a high-value target: GPU server (US), fintech API (EU), ML training rig (Singapore), with planted fake credentials, SSH keys, and API secrets.',
    tech: ['Cowrie 2.9.10', 'AWS EC2', 'authbind', 'systemd', 'S3 log shipping'],
    stats: '282,860 sessions captured across 56 days, 3 distinct server personalities',
  },
];

const INFRASTRUCTURE = [
  { name: 'AWS EC2', detail: '3 honeypot instances across us-east-1, eu-west-1, ap-southeast-1', icon: '☁️' },
  { name: 'PostgreSQL 16', detail: 'Primary data store for events, incidents, playbooks, and response actions', icon: '🐘' },
  { name: 'Redis 7', detail: 'Pub/sub for real-time WebSocket events, active block cache, threat cache', icon: '⚡' },
  { name: 'Docker Compose', detail: 'Full stack orchestration: Citadel, ML service, Oracle, Lens, Postgres, Redis', icon: '🐳' },
  { name: 'Nginx', detail: 'Reverse proxy and static asset serving for the Lens frontend', icon: '🌐' },
  { name: 'gRPC + Protobuf', detail: 'High-performance binary protocol between Eye → Citadel and ML service', icon: '📡' },
  { name: 'Flyway', detail: 'Database migration management, 6 versioned migrations', icon: '✈️' },
  { name: 'JWT', detail: 'Stateless authentication with role-based access control (admin/viewer)', icon: '🔑' },
];

const LANGUAGES = [
  { name: 'C++17', pct: 15, color: '#00599C', use: 'Eye: packet capture & feature extraction' },
  { name: 'Java', pct: 30, color: '#5382a1', use: 'Citadel: backend API, response engine, firewall' },
  { name: 'Python', pct: 25, color: '#3776AB', use: 'ML pipeline, Oracle, scripts, poster plots' },
  { name: 'TypeScript', pct: 28, color: '#3178C6', use: 'Lens frontend, Ward extension, globe visualization' },
  { name: 'SQL', pct: 2, color: '#e38c00', use: 'Flyway migrations, database schema' },
];

const ML_DETAILS = [
  { label: 'Training Dataset', value: 'CICIDS-2017 (2.8M flows)' },
  { label: 'Categories', value: 'BENIGN, DOS, PROBE, BRUTE_FORCE, INJECTION, EXFILTRATION' },
  { label: 'Primary Model', value: 'LightGBM (gradient boosted trees)' },
  { label: 'Features', value: '31 flow-level network features' },
  { label: 'Validation', value: 'Lab-trained → tested on live honeypot traffic' },
  { label: 'Serving', value: 'gRPC microservice with sub-10ms inference' },
  { label: 'Response Tiers', value: 'OBSERVE (<60%) → RECOMMEND (60-85%) → ACT (>85%)' },
  { label: 'Honeypot Data', value: '282,860 sessions across 56 days, 3 regions' },
];

export default function TechStack() {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-gray-200 mb-1">Tech Stack</h2>
        <p className="text-xs text-gray-500">Everything that powers Providence: 7 components, 4 languages, 3 AWS regions</p>
      </div>

      {/* Language breakdown bar */}
      <div className="bg-providence-surface border border-providence-border rounded-lg p-4">
        <h3 className="text-sm text-gray-400 mb-3">Language Distribution</h3>
        <div className="flex h-4 rounded-full overflow-hidden mb-3">
          {LANGUAGES.map(l => (
            <div key={l.name} style={{ width: `${l.pct}%`, backgroundColor: l.color }}
              className="transition-all hover:opacity-80" title={`${l.name} ${l.pct}%`} />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {LANGUAGES.map(l => (
            <div key={l.name} className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: l.color }} />
              <span className="text-xs text-gray-300">{l.name}</span>
              <span className="text-[10px] text-gray-500">{l.pct}%</span>
              <span className="text-[10px] text-gray-600">{l.use}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Components */}
      <div>
        <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Components</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {COMPONENTS.map(c => (
            <div key={c.name} className="bg-providence-surface border border-providence-border rounded-lg p-4">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl">{c.icon}</span>
                <div>
                  <h4 className="text-sm font-semibold text-gray-200">{c.name}</h4>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                    style={{ color: c.color, backgroundColor: c.color + '18' }}>
                    {c.lang}
                  </span>
                </div>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed mb-3">{c.description}</p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {c.tech.map(t => (
                  <span key={t} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-providence-bg text-gray-500 border border-providence-border/50">
                    {t}
                  </span>
                ))}
              </div>
              <p className="text-[10px] text-gray-600">{c.stats}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Infrastructure */}
      <div>
        <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Infrastructure</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {INFRASTRUCTURE.map(i => (
            <div key={i.name} className="bg-providence-surface border border-providence-border rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-lg">{i.icon}</span>
                <span className="text-xs font-semibold text-gray-200">{i.name}</span>
              </div>
              <p className="text-[10px] text-gray-500 leading-relaxed">{i.detail}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ML Pipeline Details */}
      <div className="bg-providence-surface border border-providence-border rounded-lg p-4">
        <h3 className="text-sm text-gray-400 mb-3">ML Pipeline</h3>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2">
          {ML_DETAILS.map(d => (
            <div key={d.label} className="flex justify-between py-1 border-b border-providence-border/30">
              <span className="text-xs text-gray-500">{d.label}</span>
              <span className="text-xs text-gray-300 font-mono text-right">{d.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Architecture flow */}
      <div className="bg-providence-surface border border-providence-border rounded-lg p-4">
        <h3 className="text-sm text-gray-400 mb-3">Data Flow</h3>
        <div className="flex items-center justify-center gap-2 text-xs py-4 flex-wrap">
          {[
            { label: 'Attacker', icon: '💀' },
            { label: '→', icon: '' },
            { label: 'Honeypot', icon: '🍯' },
            { label: '→', icon: '' },
            { label: 'Eye (C++)', icon: '👁' },
            { label: '→ gRPC →', icon: '' },
            { label: 'ML Model', icon: '🧠' },
            { label: '→', icon: '' },
            { label: 'Citadel', icon: '🏰' },
            { label: '→', icon: '' },
            { label: 'Response', icon: '🛡' },
          ].map((step, i) => (
            step.icon ? (
              <div key={i} className="flex flex-col items-center gap-1 px-2">
                <span className="text-xl">{step.icon}</span>
                <span className="text-gray-400 font-mono">{step.label}</span>
              </div>
            ) : (
              <span key={i} className="text-gray-600 font-mono">{step.label}</span>
            )
          ))}
        </div>
        <div className="flex items-center justify-center gap-2 text-xs mt-2 flex-wrap">
          {[
            { label: 'AWS Logs', icon: '☁️' },
            { label: '→', icon: '' },
            { label: 'Oracle', icon: '🔮' },
            { label: '→ REST →', icon: '' },
            { label: 'Citadel', icon: '🏰' },
            { label: '→ WebSocket →', icon: '' },
            { label: 'Lens (UI)', icon: '🔭' },
          ].map((step, i) => (
            step.icon ? (
              <div key={i} className="flex flex-col items-center gap-1 px-2">
                <span className="text-xl">{step.icon}</span>
                <span className="text-gray-400 font-mono">{step.label}</span>
              </div>
            ) : (
              <span key={i} className="text-gray-600 font-mono">{step.label}</span>
            )
          ))}
        </div>
      </div>
    </div>
  );
}
