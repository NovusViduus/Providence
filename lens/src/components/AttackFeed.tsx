import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Cloud, Shield } from 'lucide-react';
import { useWebSocket } from '../hooks/useWebSocket';
import { getEvents } from '../services/api';
import { displayTier } from '../utils/tier';
import IpLink from './IpLink';
import type { SecurityEvent, Page } from '../types/events';

const TIER_BADGE: Record<string, string> = {
  OBSERVE: 'bg-gray-600', RECOMMEND: 'bg-yellow-600', ACT: 'bg-red-600',
};
const CATEGORIES = ['DOS', 'PROBE', 'BRUTE_FORCE', 'INJECTION', 'EXFILTRATION', 'AI_AGENT',
  'IAM_ESCALATION', 'RESOURCE_ABUSE', 'DATA_EXPOSURE', 'WEB_PHISHING', 'WEB_CRYPTOMINER',
  'WEB_INJECTION', 'WEB_TRACKING', 'BENIGN'];

export default function AttackFeed() {
  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/events`;
  const { events: liveEvents } = useWebSocket(wsUrl);
  const navigate = useNavigate();

  const [category, setCategory] = useState('');
  const [tier, setTier] = useState('');
  const [minConf, setMinConf] = useState(0);
  const [ipSearch, setIpSearch] = useState('');
  const [debouncedIp, setDebouncedIp] = useState('');
  const [page, setPage] = useState(0);

  const [historical, setHistorical] = useState<Page<SecurityEvent> | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Debounce IP search
  const ipTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    ipTimer.current = setTimeout(() => { setDebouncedIp(ipSearch); setPage(0); }, 400);
    return () => clearTimeout(ipTimer.current);
  }, [ipSearch]);

  // Fetch events whenever any filter or page changes
  useEffect(() => {
    let cancelled = false;
    const p = new URLSearchParams();
    if (category) p.set('category', category);
    if (tier) p.set('tier', tier);
    if (minConf > 0) p.set('minConfidence', String(minConf));
    if (debouncedIp.trim()) p.set('sourceIp', debouncedIp.trim());
    p.set('page', String(page));
    p.set('size', '50');

    setError(null);
    getEvents(p.toString())
      .then((data) => { if (!cancelled) setHistorical(data); })
      .catch((e) => { if (!cancelled) setError(e.message); });

    return () => { cancelled = true; };
  }, [category, tier, minConf, debouncedIp, page]);

  const hasFilters = !!(category || tier || minConf > 0 || debouncedIp.trim());
  const displayEvents = hasFilters
    ? (historical?.content || [])
    : Array.from(
        new Map([...liveEvents, ...(historical?.content || [])].map((e) => [e.eventId || e.id, e])).values()
      );
  const total = historical?.totalElements || displayEvents.length;

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap items-end">
        <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(0); }}
          aria-label="Filter by category"
          className="bg-providence-bg border border-providence-border rounded px-3 py-1.5 text-sm text-gray-300">
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={tier} onChange={(e) => { setTier(e.target.value); setPage(0); }}
          aria-label="Filter by tier"
          className="bg-providence-bg border border-providence-border rounded px-3 py-1.5 text-sm text-gray-300">
          <option value="">All Tiers</option>
          <option value="OBSERVE">OBSERVE</option>
          <option value="RECOMMEND">RECOMMEND</option>
          <option value="ACT">ACT</option>
        </select>
        <label className="text-xs text-gray-500 flex items-center gap-2">
          Min Confidence: {minConf > 0 ? minConf.toFixed(2) : 'Any'}
          <input type="range" min="0" max="1" step="0.05" value={minConf}
            onChange={(e) => { setMinConf(parseFloat(e.target.value)); setPage(0); }}
            className="w-24 accent-providence-accent" />
        </label>
        <input type="text" placeholder="Search IP..." value={ipSearch}
          onChange={(e) => setIpSearch(e.target.value)}
          aria-label="Search by IP address"
          className="bg-providence-bg border border-providence-border rounded px-3 py-1.5 text-sm text-gray-300 w-40" />
      </div>

      <p className="text-xs text-gray-500">
        {error ? <span className="text-red-400">Failed to load events: {error}</span>
          : <>Showing {Math.min(displayEvents.length, 50)} of {total} events</>}
      </p>

      <div className="bg-providence-surface border border-providence-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-providence-border text-gray-500 text-xs">
              <th className="text-left px-4 py-2">Time</th>
              <th className="text-left px-4 py-2">Source IP</th>
              <th className="text-left px-4 py-2">Dest Port</th>
              <th className="text-left px-4 py-2">Category</th>
              <th className="text-left px-4 py-2">Confidence</th>
              <th className="text-left px-4 py-2">Tier</th>
            </tr>
          </thead>
          <tbody>
            {displayEvents.slice(0, 50).map((e, i) => (
              <tr key={e.eventId || e.id} onClick={() => navigate(`/events/${e.id}`)}
                className="border-b border-providence-border/50 hover:bg-providence-accent/5 cursor-pointer row-enter"
                style={{ animationDelay: `${i * 20}ms` }}>
                <td className="px-4 py-2 text-gray-400">{new Date(e.timestamp).toLocaleTimeString()}</td>
                <td className="px-4 py-2"><IpLink ip={e.sourceIp} className="text-gray-300 text-sm" /></td>
                <td className="px-4 py-2 text-gray-400">{e.destPort || '-'}</td>
                <td className="px-4 py-2">
                  {e.category === 'AI_AGENT' ? <span className="flex items-center gap-1 text-cyan-400"><Bot size={14} /> AI_AGENT</span>
                   : e.sourceComponent === 'ward' ? <span className="flex items-center gap-1 text-emerald-400"><Shield size={14} /> {e.category}</span>
                   : e.sourceComponent === 'oracle' ? <span className="flex items-center gap-1 text-purple-400"><Cloud size={14} /> {e.category}</span>
                   : e.category}
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <div className="w-12 bg-gray-700 rounded-full h-1.5">
                      <div className="h-1.5 rounded-full bg-providence-accent" style={{ width: `${e.confidence * 100}%` }} />
                    </div>
                    <span className="text-xs text-gray-400 tabular-nums">{(e.confidence * 100).toFixed(0)}%</span>
                  </div>
                </td>
                <td className="px-4 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded ${TIER_BADGE[displayTier(e)] || 'bg-gray-600'}`}>{displayTier(e)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 justify-center">
        <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
          className="px-3 py-1 text-xs bg-providence-surface border border-providence-border rounded disabled:opacity-30 text-gray-300">
          ← Previous
        </button>
        <span className="text-xs text-gray-500 py-1">Page {page + 1}</span>
        <button disabled={!historical || (page + 1) * 50 >= total} onClick={() => setPage(p => p + 1)}
          className="px-3 py-1 text-xs bg-providence-surface border border-providence-border rounded disabled:opacity-30 text-gray-300">
          Next →
        </button>
      </div>

      <style>{`
        .row-enter:hover td:first-child { border-left: 2px solid #0A9396; }
      `}</style>
    </div>
  );
}
