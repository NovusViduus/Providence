import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { getEvent, getIncidents, getActions } from '../services/api';
import { displayTier } from '../utils/tier';
import IpLink from './IpLink';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export default function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: event, error } = useApi(() => getEvent(id!), [id]);
  const { data: incidents } = useApi(() => getIncidents(`size=5`), [id]);
  const { data: actions } = useApi(() => getActions(`size=10`), [id]);

  if (!event) {
    if (error) return <div className="text-red-400 text-sm">Failed to load event: {error}</div>;
    return <div className="text-gray-500">Loading...</div>;
  }

  const importances = event.featureImportances
    ? Object.entries(event.featureImportances).sort(([, a], [, b]) => b - a).slice(0, 10).map(([k, v]) => ({ name: k, value: v }))
    : [];

  const CATEGORY_EXPLANATIONS: Record<string, string> = {
    EXFILTRATION: 'Data transfer detected from the target to an external IP. The flow shows high outbound bytes, longer duration, and patterns consistent with file downloads or reverse shell activity.',
    BRUTE_FORCE: 'Repeated authentication attempts detected. Short-lived flows with minimal payload, high SYN count, and rapid connection cycling from the same source IP.',
    DOS: 'Denial of service pattern detected. Extremely high packet rate, SYN flood signatures, or bandwidth saturation from the source.',
    PROBE: 'Port scanning or reconnaissance activity. Many short flows from one source, each targeting different ports with minimal data exchange.',
    INJECTION: 'Potential code injection attempt. Unusual payload patterns in the flow data suggesting SQL injection, command injection, or similar attacks.',
    BENIGN: 'Normal network traffic. Flow characteristics match expected patterns for legitimate communication.',
  };

  return (
    <div className="space-y-6">
      <button onClick={() => navigate('/events')}
        className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-providence-accent transition-colors mb-2">
        <ArrowLeft size={16} /> Back to Events
      </button>
      <h2 className="text-lg font-semibold text-gray-200">Event: {event.eventId}</h2>

      {/* Category explanation banner */}
      <div className="bg-providence-surface border border-providence-border rounded-lg p-4 flex gap-4">
        <div className="flex-shrink-0 w-1 rounded-full" style={{ backgroundColor: event.category === 'BENIGN' ? '#4caf50' : '#ff1744' }} />
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-gray-200">{event.category}</span>
            <span className="text-xs px-2 py-0.5 rounded bg-providence-accent/10 text-providence-accent">{displayTier(event)}</span>
            <span className="text-xs text-gray-500">{(event.confidence * 100).toFixed(1)}% confidence</span>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed">
            {CATEGORY_EXPLANATIONS[event.category] || 'Classification details not available for this category.'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Source', value: `${event.sourceIp}:${event.sourcePort}` },
          { label: 'Destination', value: `${event.destIp}:${event.destPort}` },
          { label: 'Protocol', value: event.protocol },
          { label: 'Category', value: event.category },
          { label: 'Confidence', value: `${(event.confidence * 100).toFixed(1)}%` },
          { label: 'Tier', value: displayTier(event) },
          { label: 'Duration', value: event.flowDuration ? `${event.flowDuration.toFixed(1)}s` : '-' },
          { label: 'Packets', value: event.packetCount ?? '-' },
          { label: 'Bytes', value: event.byteCount ?? '-' },
          { label: 'JA3', value: event.ja3Hash || '-' },
          { label: 'Component', value: event.sourceComponent },
          { label: 'Time', value: new Date(event.timestamp).toLocaleString() },
        ].map(({ label, value }) => (
          <div key={label} className="bg-providence-surface border border-providence-border rounded p-3">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-sm text-gray-200 font-mono">{value}</p>
          </div>
        ))}
      </div>
      {importances.length > 0 && (
        <div className="bg-providence-surface border border-providence-border rounded-lg p-4">
          <h3 className="text-sm text-gray-400 mb-3">Feature Importances (Top 10)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={importances} layout="vertical">
              <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={150} tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0C1017', border: '1px solid #1E2A3A', borderRadius: '8px', fontSize: '11px' }}
                itemStyle={{ color: '#e5e7eb' }}
              />
              <Bar dataKey="value" fill="#0A9396" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {incidents?.content && incidents.content.length > 0 && (
        <div className="bg-providence-surface border border-providence-border rounded-lg p-4">
          <h3 className="text-sm text-gray-400 mb-3">Related Incidents</h3>
          {incidents.content.filter(i => i.sourceIp === event.sourceIp).slice(0, 3).map(i => (
            <Link key={i.id} to={`/incidents/${i.id}`}
              className="block px-3 py-2 rounded hover:bg-providence-accent/5 text-sm">
              <span className="text-gray-300">{i.category}</span>
              <span className="text-gray-500 ml-2">{displayTier(i)}</span>
              <span className="text-gray-500 ml-2">{new Date(i.createdAt).toLocaleString()}</span>
            </Link>
          ))}
        </div>
      )}

      {actions?.content && actions.content.length > 0 && (
        <div className="bg-providence-surface border border-providence-border rounded-lg p-4">
          <h3 className="text-sm text-gray-400 mb-3">Response Actions</h3>
          {actions.content.filter(a => a.sourceIp === event.sourceIp).slice(0, 5).map(a => (
            <div key={a.id} className="flex justify-between px-3 py-1.5 text-sm">
              <span className="text-gray-300">{a.actionType}</span>
              <span className={a.success ? 'text-green-400' : 'text-red-400'}>{a.success ? '✓' : '✗'}</span>
              <span className="text-gray-500">{a.platform}</span>
              <span className="text-gray-500">{new Date(a.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
