import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Shield, AlertTriangle, Globe } from 'lucide-react';
import { getEventsByIp, getIncidentsByIp, getActionsByIp, getGeoEvents } from '../services/api';
import { getCategoryHex } from '../utils/geoip';
import { displayTier } from '../utils/tier';
import TerminalReplay from './TerminalReplay';
import sessionsData from '../data/sessions.json';
import type { SecurityEvent, IncidentReport, ResponseAction, GeoThreat } from '../types/events';

function computeThreatScore(events: SecurityEvent[], honeypots: string[]): number {
  let score = 0;
  // Frequency: more events = higher score
  score += Math.min(events.length * 2, 40);
  // Severity: ACT-tier events are worth more
  score += events.filter(e => e.responseTier === 'ACT').length * 5;
  score += events.filter(e => e.responseTier === 'RECOMMEND').length * 2;
  // Breadth: hitting multiple honeypots shows sophistication
  score += (honeypots.length - 1) * 15;
  // Category diversity
  const cats = new Set(events.map(e => e.category));
  score += (cats.size - 1) * 5;
  return Math.min(score, 100);
}

function ScoreBadge({ score }: { score: number }) {
  const color = score > 70 ? '#D64045' : score > 40 ? '#CC8B17' : '#3A9D68';
  const label = score > 70 ? 'CRITICAL' : score > 40 ? 'ELEVATED' : 'LOW';
  return (
    <div className="flex items-center gap-2">
      <div className="w-12 h-12 rounded-full border-2 flex items-center justify-center font-mono font-bold text-lg"
        style={{ borderColor: color, color }}>
        {score}
      </div>
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Threat Score</p>
        <p className="text-xs font-semibold" style={{ color }}>{label}</p>
      </div>
    </div>
  );
}

export default function Dossier() {
  const { ip } = useParams<{ ip: string }>();
  const navigate = useNavigate();
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [incidents, setIncidents] = useState<IncidentReport[]>([]);
  const [actions, setActions] = useState<ResponseAction[]>([]);
  const [geo, setGeo] = useState<GeoThreat | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ip) return;
    setLoading(true);
    setError(null);

    Promise.all([
      getEventsByIp(ip).catch(() => ({ content: [], totalElements: 0 })),
      getIncidentsByIp(ip).catch(() => ({ content: [], totalElements: 0 })),
      getActionsByIp(ip).catch(() => ({ content: [], totalElements: 0 })),
      getGeoEvents(720).catch(() => []),
    ]).then(([evtPage, incPage, actPage, geoData]) => {
      const evts = (evtPage as any).content || [];
      setEvents(evts);
      setIncidents(((incPage as any).content || []).filter((i: IncidentReport) => i.sourceIp === ip));
      setActions(((actPage as any).content || []).filter((a: ResponseAction) => a.sourceIp === ip));
      const geoMatch = (geoData as GeoThreat[]).find(g => g.sourceIp === ip);
      setGeo(geoMatch || null);
      setLoading(false);
    }).catch(() => {
      setError('Failed to load dossier data');
      setLoading(false);
    });
  }, [ip]);

  if (loading) return <div className="text-gray-500">Loading dossier...</div>;
  if (error) return <div className="text-red-400 text-sm">{error}</div>;

  // Compute derived data
  const honeypots = [...new Set(events.map(e => e.destIp))];
  const categories: Record<string, number> = {};
  events.forEach(e => { categories[e.category] = (categories[e.category] || 0) + 1; });
  const sorted = [...events].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const firstSeen = sorted[0]?.timestamp;
  const lastSeen = sorted[sorted.length - 1]?.timestamp;
  const threatScore = computeThreatScore(events, honeypots);
  const matchingSessions = (sessionsData as any[]).filter((s: any) => s.ip === ip);

  return (
    <div className="space-y-6">
      <button onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-providence-accent transition-colors">
        <ArrowLeft size={16} /> Back
      </button>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold font-mono text-gray-100">{ip}</h2>
          <p className="text-sm text-gray-500 mt-1">
            {geo ? `${geo.city ? geo.city + ', ' : ''}${geo.country}` : 'Location unknown'}
          </p>
          {firstSeen && (
            <p className="text-xs text-gray-600 mt-1">
              First seen {new Date(firstSeen).toLocaleDateString()} · Last seen {new Date(lastSeen).toLocaleDateString()}
            </p>
          )}
        </div>
        <ScoreBadge score={threatScore} />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Total Events', value: events.length },
          { label: 'Categories', value: Object.keys(categories).length },
          { label: 'Honeypots Hit', value: honeypots.length, color: honeypots.length > 1 ? '#ff9800' : undefined },
          { label: 'Incidents', value: incidents.length, color: incidents.length > 0 ? '#ff1744' : undefined },
          { label: 'Blocks', value: actions.filter(a => a.actionType === 'BLOCK').length, color: '#ff1744' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-providence-surface border border-providence-border rounded-lg p-3">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
            <p className="text-xl font-bold font-mono" style={{ color: color || '#e5e7eb' }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Category breakdown */}
      <div className="bg-providence-surface border border-providence-border rounded-lg p-4">
        <h3 className="text-sm text-gray-400 mb-3">Attack Categories</h3>
        <div className="space-y-2">
          {Object.entries(categories).sort(([,a],[,b]) => b - a).map(([cat, count]) => {
            const pct = (count / events.length) * 100;
            return (
              <div key={cat} className="flex items-center gap-3">
                <span className="text-xs w-24 text-gray-300">{cat}</span>
                <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: getCategoryHex(cat) }} />
                </div>
                <span className="text-xs text-gray-400 font-mono w-12 text-right">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Activity timeline */}
      <div className="bg-providence-surface border border-providence-border rounded-lg p-4">
        <h3 className="text-sm text-gray-400 mb-3">Activity Timeline</h3>
        <div className="space-y-1 max-h-[400px] overflow-y-auto panel-scroll">
          {sorted.map((e, i) => (
            <div key={e.eventId || i} className="flex items-center gap-3 py-1.5 border-b border-providence-border/30 text-xs">
              <span className="text-gray-600 font-mono w-36">{new Date(e.timestamp).toLocaleString()}</span>
              <span className="px-1.5 py-0.5 rounded text-[10px]"
                style={{ color: getCategoryHex(e.category), backgroundColor: getCategoryHex(e.category) + '18' }}>
                {e.category}
              </span>
              <span className="text-gray-500">:{e.destPort}</span>
              <span className="text-gray-600">{(e.confidence * 100).toFixed(0)}%</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                displayTier(e) === 'ACT' ? 'bg-red-600' : displayTier(e) === 'RECOMMEND' ? 'bg-yellow-600' : 'bg-gray-600'
              }`}>{displayTier(e)}</span>
              {e.flowDuration && <span className="text-gray-600">{e.flowDuration.toFixed(1)}s</span>}
            </div>
          ))}
          {events.length === 0 && <p className="text-gray-600 text-sm">No events recorded</p>}
        </div>
      </div>

      {/* Incidents */}
      {incidents.length > 0 && (
        <div className="bg-providence-surface border border-providence-border rounded-lg p-4">
          <h3 className="text-sm text-gray-400 mb-3">Incidents ({incidents.length})</h3>
          {incidents.map(inc => (
            <div key={inc.id} onClick={() => navigate(`/incidents/${inc.id}`)}
              className="flex items-center justify-between py-2 border-b border-providence-border/30 cursor-pointer hover:bg-providence-accent/5 px-2 rounded">
              <div className="flex items-center gap-3 text-xs">
                <AlertTriangle size={13} className="text-yellow-500" />
                <span className="text-gray-300">{inc.category}</span>
                <span className="text-gray-500">{new Date(inc.createdAt).toLocaleString()}</span>
              </div>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${inc.resolved ? 'bg-green-600/20 text-green-400' : 'bg-yellow-600/20 text-yellow-400'}`}>
                {inc.resolved ? 'Resolved' : inc.pendingApproval ? 'Pending' : 'Open'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Response actions */}
      {actions.length > 0 && (
        <div className="bg-providence-surface border border-providence-border rounded-lg p-4">
          <h3 className="text-sm text-gray-400 mb-3">Response Actions ({actions.length})</h3>
          {actions.map(a => (
            <div key={a.id} className="flex items-center justify-between py-2 border-b border-providence-border/30 text-xs">
              <div className="flex items-center gap-3">
                <Shield size={13} className={a.success ? 'text-green-400' : 'text-red-400'} />
                <span className="text-gray-300">{a.actionType}</span>
                <span className="text-gray-500">{a.platform}</span>
                <span className="text-gray-600">{new Date(a.createdAt).toLocaleString()}</span>
              </div>
              <span className={a.success ? 'text-green-400' : 'text-red-400'}>{a.success ? 'Success' : 'Failed'}</span>
            </div>
          ))}
        </div>
      )}

      {/* Session replays */}
      {matchingSessions.length > 0 && (
        <div>
          <h3 className="text-sm text-gray-400 mb-3">Session Replays ({matchingSessions.length})</h3>
          <div className="space-y-4">
            {matchingSessions.map(s => (
              <TerminalReplay key={s.id} session={s} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
