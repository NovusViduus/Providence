import { useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { getGeoEvents } from '../services/api';
import { getCategoryHex } from '../utils/geoip';
import type { GeoThreat } from '../types/events';

function threatScore(t: GeoThreat, allThreats: GeoThreat[]): number {
  let score = 0;
  score += Math.min(t.eventCount * 2, 40);
  // Check if this IP hit multiple honeypots
  const honeypots = allThreats.filter(o => o.sourceIp === t.sourceIp);
  const uniqueDests = new Set(honeypots.map(h => `${h.destLatitude},${h.destLongitude}`));
  score += (uniqueDests.size - 1) * 15;
  // Category from name
  if (t.category === 'EXFILTRATION') score += 20;
  else if (t.category === 'BRUTE_FORCE') score += 10;
  else if (t.category === 'DOS') score += 15;
  return Math.min(score, 100);
}

function ScoreDot({ score }: { score: number }) {
  const color = score > 70 ? '#D64045' : score > 40 ? '#CC8B17' : '#3A9D68';
  return (
    <div className="w-8 h-8 rounded-full border flex items-center justify-center text-[10px] font-mono font-bold"
      style={{ borderColor: color, color }}>
      {score}
    </div>
  );
}

export default function AttackerList() {
  const { data: geo, error } = useApi(() => getGeoEvents(720), []);
  const navigate = useNavigate();

  if (error) return <div className="text-red-400 text-sm">Failed to load attacker data: {error}</div>;
  if (!geo) return <div className="text-gray-500">Loading...</div>;

  // Dedupe by IP, keep highest event count
  const byIp = new Map<string, GeoThreat>();
  for (const t of geo) {
    const existing = byIp.get(t.sourceIp);
    if (!existing || t.eventCount > existing.eventCount) {
      byIp.set(t.sourceIp, t);
    }
  }

  const sorted = [...byIp.values()]
    .map(t => ({ ...t, score: threatScore(t, geo) }))
    .sort((a, b) => b.score - a.score || b.eventCount - a.eventCount);

  const critical = sorted.filter(t => t.score > 70);
  const elevated = sorted.filter(t => t.score > 40 && t.score <= 70);
  const low = sorted.filter(t => t.score <= 40);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-200 mb-1">Attacker Dossiers</h2>
        <p className="text-xs text-gray-500">{sorted.length} unique source IPs. Click any row to view full dossier.</p>
      </div>

      {critical.length > 0 && (
        <div>
          <h3 className="text-xs text-red-400 uppercase tracking-wider mb-2">Critical ({critical.length})</h3>
          <div className="space-y-1">
            {critical.slice(0, 20).map((t, i) => (
              <AttackerRow key={t.sourceIp} threat={t} score={t.score} index={i} onClick={() => navigate(`/dossier/${encodeURIComponent(t.sourceIp)}`)} />
            ))}
          </div>
        </div>
      )}

      {elevated.length > 0 && (
        <div>
          <h3 className="text-xs text-yellow-400 uppercase tracking-wider mb-2">Elevated ({elevated.length})</h3>
          <div className="space-y-1">
            {elevated.slice(0, 30).map((t, i) => (
              <AttackerRow key={t.sourceIp} threat={t} score={t.score} index={i} onClick={() => navigate(`/dossier/${encodeURIComponent(t.sourceIp)}`)} />
            ))}
          </div>
        </div>
      )}

      {low.length > 0 && (
        <div>
          <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Low ({low.length})</h3>
          <div className="space-y-1">
            {low.slice(0, 50).map((t, i) => (
              <AttackerRow key={t.sourceIp} threat={t} score={t.score} index={i} onClick={() => navigate(`/dossier/${encodeURIComponent(t.sourceIp)}`)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AttackerRow({ threat, score, onClick, index }: { threat: GeoThreat & { score: number }; score: number; onClick: () => void; index: number }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-3 bg-providence-surface border border-providence-border rounded-lg px-3 py-2.5 hover:border-providence-accent/30 transition-all text-left row-enter"
      style={{ animationDelay: `${index * 30}ms` }}>
      <ScoreDot score={score} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-gray-200">{threat.sourceIp}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ color: getCategoryHex(threat.category), backgroundColor: getCategoryHex(threat.category) + '18' }}>
            {threat.category}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-gray-500 mt-0.5">
          <span>{threat.city ? `${threat.city}, ` : ''}{threat.country}</span>
          <span>{threat.eventCount} events</span>
          <span>{new Date(threat.lastSeen).toLocaleDateString()}</span>
        </div>
      </div>
    </button>
  );
}
