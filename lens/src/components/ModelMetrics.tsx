import { useEffect, useRef } from 'react';
import { useApi } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket';
import { getEventStats, getIncidents, getActions, getActiveBlocks, getGeoEvents, getActiveThreats } from '../services/api';
import { startAmbient, stopAmbient, setAmbientIntensity, isSoundEnabled } from '../utils/sound';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from 'recharts';
import { getCategoryHex } from '../utils/geoip';
import type { SecurityEvent } from '../types/events';

const TIER_COLORS: Record<string, string> = { OBSERVE: '#4D5B6A', RECOMMEND: '#CC8B17', ACT: '#D64045' };
const TOOLTIP_STYLE = { backgroundColor: '#131A24', border: '1px solid #1E2A3A', borderRadius: '8px', fontSize: '11px' };

function buildTimeline(events: SecurityEvent[]): { label: string; count: number }[] {
  if (events.length === 0) return [];
  const buckets = new Map<string, number>();
  for (const e of events) {
    const d = new Date(e.timestamp);
    const label = `${d.getHours().toString().padStart(2, '0')}:${(Math.floor(d.getMinutes() / 10) * 10).toString().padStart(2, '0')}`;
    buckets.set(label, (buckets.get(label) || 0) + 1);
  }
  return Array.from(buckets.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => ({ label, count }));
}

export default function ModelMetrics() {
  const { data: stats, error: statsErr, refresh } = useApi(() => getEventStats(), []);
  const { data: incidents } = useApi(() => getIncidents('size=200'), []);
  const { data: actions } = useApi(() => getActions('size=200'), []);
  const { data: blocks } = useApi(() => getActiveBlocks(), []);
  const { data: geo } = useApi(() => getGeoEvents(24), []);
  const { data: activeThreats } = useApi(() => getActiveThreats(), []);
  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/events`;
  const { events: liveEvents } = useWebSocket(wsUrl);

  // Auto-refresh stats every 60 seconds
  useEffect(() => {
    const interval = setInterval(refresh, 60000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Adaptive ambient sound responds to threat level
  const threatScore = stats
    ? Math.min(100, Math.round(((stats.byTier?.ACT ?? 0) * 3 + (stats.byTier?.RECOMMEND ?? 0) + (stats.lastHour ?? 0) * 0.5)))
    : 0;

  // Ambient sound: fires for 20 seconds when an ACT-tier event appears
  const prevActCount = useRef(0);

  useEffect(() => {
    if (!stats || !isSoundEnabled()) return;
    const actCount = stats.byTier?.ACT ?? 0;
    if (actCount > prevActCount.current && prevActCount.current > 0) {
      startAmbient();
      setAmbientIntensity(threatScore);
      const timer = setTimeout(() => stopAmbient(), 20000);
      prevActCount.current = actCount;
      return () => { clearTimeout(timer); stopAmbient(); };
    }
    prevActCount.current = actCount;
  }, [stats?.byTier?.ACT]);

  if (statsErr) return <div className="text-red-400 text-sm">Failed to load dashboard: {statsErr}</div>;
  if (!stats) return <div className="text-gray-500">Loading...</div>;

  const blockCount = blocks ? Object.keys(blocks).length : 0;
  const threatCount = activeThreats ? Object.keys(activeThreats).length : 0;
  const totalActions = actions?.totalElements || 0;
  const successActions = actions?.content.filter(a => a.success).length || 0;
  const failedActions = actions?.content.filter(a => !a.success).length || 0;
  const reversedActions = actions?.content.filter(a => a.reversedAt).length || 0;
  const pendingIncidents = incidents?.content.filter(i => i.pendingApproval).length || 0;
  const resolvedIncidents = incidents?.content.filter(i => i.resolved).length || 0;
  const openIncidents = incidents?.content.filter(i => !i.resolved && !i.pendingApproval).length || 0;
  const rejectedCount = incidents?.content.filter(i => i.notes?.includes('Rejected')).length || 0;

  // Threat gauge
  const actCount = stats.byTier?.ACT ?? 0;
  const recCount = stats.byTier?.RECOMMEND ?? 0;
  const threatColor = threatScore > 70 ? '#D64045' : threatScore > 35 ? '#CC8B17' : '#3A9D68';
  const threatLabel = threatScore > 70 ? 'CRITICAL' : threatScore > 35 ? 'ELEVATED' : 'NOMINAL';
  const gaugeRadius = 70;
  const gaugeCirc = Math.PI * gaugeRadius;
  const gaugeFill = (threatScore / 100) * gaugeCirc;

  const categoryData = Object.entries(stats.byCategory).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).map(([k, v]) => ({ name: k, value: v }));
  const tierData = Object.entries(stats.byTier).filter(([, v]) => v > 0).map(([k, v]) => ({ name: k, value: v }));
  const timeline = buildTimeline(liveEvents);

  const countryRollup = geo
    ? Object.entries(geo.reduce<Record<string, number>>((acc, t) => { acc[t.country] = (acc[t.country] || 0) + t.eventCount; return acc; }, {}))
        .sort(([, a], [, b]) => b - a).slice(0, 8).map(([name, value]) => ({ name, value }))
    : [];

  const incidentPie = [
    { name: 'Resolved', value: resolvedIncidents, color: '#4caf50' },
    { name: 'Open', value: openIncidents, color: '#ffd600' },
    { name: 'Pending', value: pendingIncidents, color: '#ff9800' },
  ].filter(d => d.value > 0);

  const actionRate = totalActions > 0 ? ((successActions / (actions?.content.length || 1)) * 100).toFixed(0) : '-';

  return (
    <div className="space-y-6">
      {/* Row 1: Threat gauge + key metrics */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="bg-providence-surface border border-providence-border rounded-lg p-4 flex flex-col items-center justify-center w-48">
          <svg width="140" height="85" viewBox="0 0 160 100">
            <path d="M 10 90 A 70 70 0 0 1 150 90" fill="none" stroke="#1E2A3A" strokeWidth="8" strokeLinecap="round" />
            <path d="M 10 90 A 70 70 0 0 1 150 90" fill="none" stroke={threatColor} strokeWidth="8" strokeLinecap="round"
              strokeDasharray={`${gaugeFill} ${gaugeCirc}`}
              style={{ filter: `drop-shadow(0 0 6px ${threatColor}40)`, transition: 'stroke-dasharray 1s ease' }} />
            <text x="80" y="72" textAnchor="middle" fill={threatColor} fontSize="26" fontWeight="bold" fontFamily="monospace">{threatScore}</text>
            <text x="80" y="92" textAnchor="middle" fill="#6b7280" fontSize="9" letterSpacing="0.1em">{threatLabel}</text>
          </svg>
          <p className="text-[10px] text-gray-600 mt-1 uppercase tracking-wider">Threat Level</p>
        </div>

        <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {[
            { label: 'Total Events', value: stats.total + liveEvents.length, sub: `${stats.lastHour} last hour` },
            { label: 'Active Threats', value: threatCount, color: threatCount > 0 ? '#ff1744' : undefined },
            { label: 'Active Blocks', value: blockCount, color: blockCount > 0 ? '#ff9800' : undefined },
            { label: 'Pending Review', value: pendingIncidents, color: pendingIncidents > 0 ? '#ffd600' : undefined },
            { label: 'Action Success', value: `${actionRate}%`, sub: `${totalActions} total` },
          ].map(({ label, value, sub, color }) => (
            <div key={label} className="bg-providence-surface border border-providence-border rounded-lg p-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
              <p className="text-xl font-bold tabular-nums" style={{ color: color || '#e5e7eb' }}>{value}</p>
              {sub && <p className="text-[10px] text-gray-600 mt-0.5">{sub}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* Row 2: Live timeline */}
      {timeline.length > 0 ? (
        <div className="bg-providence-surface border border-providence-border rounded-lg p-4">
          <h3 className="text-sm text-gray-400 mb-3">Events Over Time</h3>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={timeline}>
              <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: '#e5e7eb' }} />
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0A9396" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#0A9396" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="count" stroke="#0A9396" fill="url(#areaGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="bg-providence-surface border border-providence-border rounded-lg p-4">
          <h3 className="text-sm text-gray-400 mb-3">Events Over Time</h3>
          <div className="flex items-center justify-center h-[160px] text-gray-600 text-sm">Waiting for live event data…</div>
        </div>
      )}

      {/* Row 3: Charts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-providence-surface border border-providence-border rounded-lg p-4">
          <h3 className="text-sm text-gray-400 mb-3">Attack Distribution</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={categoryData} layout="vertical">
              <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <YAxis type="category" dataKey="name" width={100} tick={{ fill: '#9ca3af', fontSize: 10 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: '#e5e7eb' }} />
              <Bar dataKey="value">
                {categoryData.map(d => <Cell key={d.name} fill={getCategoryHex(d.name)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-providence-surface border border-providence-border rounded-lg p-4">
          <h3 className="text-sm text-gray-400 mb-3">Response Tiers</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={tierData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                {tierData.map(d => <Cell key={d.name} fill={TIER_COLORS[d.name] || '#888'} />)}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: '#e5e7eb' }}
                formatter={(value: number, name: string) => [`${value.toLocaleString()} events`, name]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-4 mt-2">
            {tierData.map(d => (
              <div key={d.name} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: TIER_COLORS[d.name] }} />
                <span className="text-[10px] text-gray-400">{d.name}</span>
                <span className="text-[10px] text-gray-300 font-mono">{d.value.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-providence-surface border border-providence-border rounded-lg p-4">
          <h3 className="text-sm text-gray-400 mb-3">Incident Status</h3>
          {incidentPie.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={incidentPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                    {incidentPie.map(d => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: '#e5e7eb' }}
                    formatter={(value: number, name: string) => [`${value}`, name]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-4 mt-2">
                {incidentPie.map(d => (
                  <div key={d.name} className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
                    <span className="text-[10px] text-gray-400">{d.name}</span>
                    <span className="text-[10px] text-gray-300 font-mono">{d.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-[220px] text-gray-600 text-sm">No incidents</div>
          )}
        </div>
      </div>

      {/* Row 4: Intel panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-providence-surface border border-providence-border rounded-lg p-4">
          <h3 className="text-sm text-gray-400 mb-3">Top Source Countries (24h)</h3>
          {countryRollup.length > 0 ? (
            <div className="space-y-1.5">
              {countryRollup.map((c, i) => {
                const maxVal = countryRollup[0].value;
                const pct = (c.value / maxVal) * 100;
                return (
                  <div key={c.name} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-4 text-right">{i + 1}</span>
                    <span className="text-xs text-gray-300 w-20">{c.name}</span>
                    <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-providence-accent/60 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-gray-400 font-mono w-16 text-right">{c.value.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-gray-600 text-sm">No geo data available</p>
          )}
        </div>

        <div className="bg-providence-surface border border-providence-border rounded-lg p-4">
          <h3 className="text-sm text-gray-400 mb-3">Response Effectiveness</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Successful Blocks', value: successActions, color: '#4caf50' },
              { label: 'Failed Blocks', value: failedActions, color: '#ff1744' },
              { label: 'Reversed', value: reversedActions, color: '#ffd600' },
              { label: 'Rejected by Operator', value: rejectedCount, color: '#ff9800' },
              { label: 'Unique Source IPs', value: geo?.length || 0, color: '#0A9396' },
              { label: 'AI Agent Detections', value: stats.byCategory.AI_AGENT || 0, color: '#00e5ff' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-providence-bg rounded px-3 py-2">
                <p className="text-[10px] text-gray-500">{label}</p>
                <p className="text-lg font-mono font-bold" style={{ color }}>{value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
