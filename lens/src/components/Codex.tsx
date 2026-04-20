import { useState } from 'react';
import MascotViewer from './MascotViewer';
import codexData from '../data/codex.json';

const CYBER_RESOURCES = [
  {
    name: 'MITRE ATT&CK',
    url: 'https://attack.mitre.org',
    logo: 'https://attack.mitre.org/theme/images/mitre_attack_logo.png',
    blurb: 'Industry-standard knowledge base of adversary tactics and techniques based on real-world observations. The foundation for threat modeling and detection engineering.',
  },
  {
    name: 'OWASP',
    url: 'https://owasp.org',
    logo: 'https://owasp.org/assets/images/logo.png',
    blurb: 'Open-source application security community. Home of the OWASP Top 10, ZAP scanner, and hundreds of security guides for developers.',
  },
  {
    name: 'NIST Cybersecurity',
    url: 'https://www.nist.gov/cybersecurity',
    logo: 'https://www.nist.gov/sites/default/files/styles/220_x_220_limit/public/images/2017/01/11/nist-logo_0.png',
    blurb: 'U.S. federal standards body. Publishes the Cybersecurity Framework (CSF), vulnerability database (NVD), and cryptographic standards used worldwide.',
  },
  {
    name: 'SANS Institute',
    url: 'https://www.sans.org',
    logo: 'https://www.sans.org/images/sans-logo.svg',
    blurb: 'Premier cybersecurity training and certification organization. Offers GIAC certifications, the Internet Storm Center, and free reading room papers.',
  },
  {
    name: 'Krebs on Security',
    url: 'https://krebsonsecurity.com',
    logo: 'https://krebsonsecurity.com/wp-content/uploads/2023/01/KrebsFavicon-150x150.png',
    blurb: 'Investigative journalism on cybercrime by Brian Krebs. Deep dives into breaches, threat actors, and the underground economy of stolen data.',
  },
  {
    name: 'Hack The Box',
    url: 'https://www.hackthebox.com',
    logo: 'https://www.hackthebox.com/images/landingv3/og/og_htb.jpg',
    blurb: 'Hands-on cybersecurity training platform with vulnerable machines, CTF challenges, and guided learning paths from beginner to advanced.',
  },
  {
    name: 'PortSwigger Web Security Academy',
    url: 'https://portswigger.net/web-security',
    logo: 'https://portswigger.net/content/images/logos/portswigger-logo.svg',
    blurb: 'Free interactive labs covering every major web vulnerability class. Created by the makers of Burp Suite, the industry-standard web security tool.',
  },
  {
    name: 'CyberChef',
    url: 'https://gchq.github.io/CyberChef',
    logo: 'https://gchq.github.io/CyberChef/images/cyberchef-128x128.png',
    blurb: 'Open-source data transformation tool by GCHQ. Encode, decode, encrypt, compress, and analyze data with a drag-and-drop recipe builder.',
  },
  {
    name: 'Shodan',
    url: 'https://www.shodan.io',
    logo: 'https://static.shodan.io/shodan/img/logo.png',
    blurb: 'Search engine for internet-connected devices. Discover exposed services, vulnerabilities, and misconfigurations across the global internet.',
  },
  {
    name: 'VirusTotal',
    url: 'https://www.virustotal.com',
    logo: 'https://www.virustotal.com/gui/images/favicon.png',
    blurb: 'Free file and URL analysis service backed by 70+ antivirus engines. Essential for malware analysis, threat intelligence, and incident response.',
  },
];

interface CodexEntry {
  id: string;
  category: string;
  name: string;
  mascot: string;
  danger: number;
  color: string;
  levels: Record<string, { title: string; body: string; features?: string[]; providence_query?: string; code?: string; code_lang?: string; detection_note?: string }>;
  resources?: { name: string; url: string; description: string }[];
  unlock: Record<string, string>;
}

const entries = codexData as CodexEntry[];

// For now, all users have level 1 unlocked. Level 2-3 unlock system
// will integrate with Academy progress tracking.
function getUserLevel(_entryId: string): number {
  return 4; // Show all content for demo/poster
}

function DangerRating({ level }: { level: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} viewBox="0 0 16 16" className="w-3.5 h-3.5">
          <path
            d="M8 1L10 6H15L11 9.5L12.5 15L8 11.5L3.5 15L5 9.5L1 6H6L8 1Z"
            fill={i <= level ? '#ff1744' : 'transparent'}
            stroke={i <= level ? '#ff1744' : '#333'}
            strokeWidth="1"
          />
        </svg>
      ))}
    </div>
  );
}

function EntryDetail({ entry, onBack }: { entry: CodexEntry; onBack: () => void }) {
  const userLevel = getUserLevel(entry.id);

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-gray-400 hover:text-gray-200 flex items-center gap-1">
        ← Back to Codex
      </button>

      <div className="flex gap-6">
        {/* Mascot */}
        <div className="flex-shrink-0">
          <div className="bg-providence-surface border border-providence-border rounded-lg p-2">
            <MascotViewer type={entry.mascot} state="active" size={220} />
          </div>
        </div>

        {/* Header info */}
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-2xl font-bold text-gray-100">{entry.name}</h2>
            <span className="text-xs px-2 py-0.5 rounded uppercase tracking-wider"
              style={{ color: entry.color, backgroundColor: entry.color + '18' }}>
              {entry.category}
            </span>
          </div>
          <DangerRating level={entry.danger} />
        </div>
      </div>

      {/* Level tabs */}
      <div className="space-y-4">
        {Object.entries(entry.levels).map(([levelNum, level]) => {
          const num = parseInt(levelNum);
          const unlocked = num <= userLevel;
          const levelLabels = ['', 'Recon', 'Analysis', 'Incident Response', 'Code Lab'];

          return (
            <div key={levelNum}
              className={`border rounded-lg p-4 transition-all ${
                unlocked
                  ? 'border-providence-border bg-providence-surface'
                  : 'border-providence-border/30 bg-providence-surface/30'
              }`}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-xs font-mono px-2 py-0.5 rounded ${
                  unlocked ? 'bg-providence-accent/20 text-providence-accent' : 'bg-gray-700/30 text-gray-600'
                }`}>
                  LVL {levelNum}
                </span>
                <span className={`text-xs uppercase tracking-wider ${unlocked ? 'text-gray-400' : 'text-gray-600'}`}>
                  {levelLabels[num]}
                </span>
                <h3 className={`text-sm font-semibold ${unlocked ? 'text-gray-200' : 'text-gray-600'}`}>
                  {level.title}
                </h3>
              </div>

              {unlocked ? (
                <div>
                  <p className="text-sm text-gray-400 leading-relaxed">{level.body}</p>

                  {level.code && (
                    <pre className="mt-4 mb-1 bg-providence-bg border border-providence-border rounded-lg p-4 overflow-x-auto text-xs font-mono text-gray-300 leading-relaxed relative">
                      <code>{level.code}</code>
                    </pre>
                  )}

                  {level.detection_note && (
                    <div className="mt-4 bg-providence-accent/5 border border-providence-accent/20 rounded-lg px-4 py-3 relative">
                      <p className="text-[10px] text-providence-accent uppercase tracking-wider mb-1">Providence Detection</p>
                      <p className="text-xs text-gray-400 leading-relaxed">{level.detection_note}</p>
                    </div>
                  )}

                  {level.features && level.features.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <span className="text-[10px] text-gray-500 uppercase tracking-wider mr-1">Key features:</span>
                      {level.features.map((f) => (
                        <span key={f} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-providence-accent/10 text-providence-accent">
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="h-3 bg-gray-800/50 rounded w-full" />
                  <div className="h-3 bg-gray-800/50 rounded w-4/5" />
                  <div className="h-3 bg-gray-800/50 rounded w-3/5" />
                  <p className="text-xs text-gray-600 mt-2">
                    🔒 Complete "{entry.unlock[levelNum]}" to unlock
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* External Resources */}
      {entry.resources && entry.resources.length > 0 && (
        <div className="bg-providence-surface border border-providence-border rounded-lg p-4">
          <h3 className="text-sm text-gray-400 mb-3">External Resources</h3>
          <div className="space-y-2">
            {entry.resources.map((r) => (
              <a key={r.url} href={r.url} target="_blank" rel="noopener noreferrer"
                className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-providence-accent/5 transition-colors group">
                <span className="text-providence-accent/60 group-hover:text-providence-accent mt-0.5 text-sm">↗</span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-300 group-hover:text-providence-accent transition-colors">{r.name}</p>
                  <p className="text-[10px] text-gray-500 leading-relaxed mt-0.5">{r.description}</p>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Codex() {
  const [selected, setSelected] = useState<CodexEntry | null>(null);

  const attacks = entries.filter((e) => e.category === 'attack');
  const network = entries.filter((e) => e.category === 'network');

  if (selected) {
    return <EntryDetail entry={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-200 mb-1">The Codex</h2>
        <p className="text-sm text-gray-500">Interactive threat encyclopedia. Click an entry to explore.</p>
      </div>

      <style>{`
        @property --angle { syntax: '<angle>'; initial-value: 0deg; inherits: false; }
        @keyframes border-rotate { to { --angle: 360deg; } }
        @keyframes glow-pulse { 0%,100% { box-shadow: 0 0 0 0 transparent; } 50% { box-shadow: 0 0 12px -3px var(--glow-color, rgba(0,255,200,0.15)); } }
        .codex-card {
          position: relative;
        }
        .codex-card::before {
          content: '';
          position: absolute;
          inset: -1px;
          border-radius: 0.5rem;
          padding: 1px;
          background: conic-gradient(from var(--angle), transparent 40%, var(--card-color, #0A9396) 50%, transparent 60%);
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          opacity: 0;
          transition: opacity 0.3s;
          animation: border-rotate 3s linear infinite;
        }
        .codex-card:hover::before { opacity: 1; }
        .codex-card:hover { animation: glow-pulse 2s ease-in-out infinite; }
      `}</style>

      {/* Attack Types */}
      <div>
        <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Attack Types</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {attacks.map((entry) => (
            <button key={entry.id} onClick={() => setSelected(entry)}
              className="codex-card bg-providence-surface border border-providence-border rounded-lg p-3 text-left hover:border-providence-accent/50 transition-all group" style={{ "--card-color": entry.color } as React.CSSProperties}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-gray-200 group-hover:text-gray-100">
                  {entry.name}
                </span>
                {entry.danger > 0 && <DangerRating level={entry.danger} />}
              </div>
              <div className="flex justify-center my-2">
                <MascotViewer type={entry.mascot} state="idle" size={120} />
              </div>
              <p className="text-[10px] text-gray-500 line-clamp-2">
                {entry.levels['1']?.body.slice(0, 100) ?? ''}...
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Network Foundations */}
      <div>
        <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Network Foundations</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {network.map((entry) => (
            <button key={entry.id} onClick={() => setSelected(entry)}
              className="codex-card bg-providence-surface border border-providence-border rounded-lg p-3 text-left hover:border-providence-accent/50 transition-all group" style={{ "--card-color": entry.color } as React.CSSProperties}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-gray-200 group-hover:text-gray-100">
                  {entry.name}
                </span>
                {entry.danger > 0 && <DangerRating level={entry.danger} />}
              </div>
              <div className="flex justify-center my-2">
                <MascotViewer type={entry.mascot} state="idle" size={120} />
              </div>
              <p className="text-[10px] text-gray-500 line-clamp-2">
                {entry.levels['1']?.body.slice(0, 100) ?? ''}...
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Learning Resources */}
      <div>
        <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Learning Resources</h3>
        <div className="grid grid-cols-2 gap-3">
          {CYBER_RESOURCES.map((r) => (
            <a key={r.name} href={r.url} target="_blank" rel="noopener noreferrer"
              className="bg-providence-surface border border-providence-border rounded-lg p-4 hover:border-providence-accent/30 transition-all group flex gap-4 items-start">
              <img src={r.logo} alt={r.name} className="w-10 h-10 rounded object-contain flex-shrink-0 mt-0.5 bg-white/5 p-1"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-200 group-hover:text-providence-accent transition-colors">{r.name}</p>
                <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">{r.blurb}</p>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

