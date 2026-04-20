import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { getIncidents, approveIncident, rejectIncident } from '../services/api';
import { displayTier } from '../utils/tier';
import IpLink from './IpLink';
import { isAdmin } from '../services/auth';

export default function ManualOverride() {
  const { data: incidents, error, refresh } = useApi(() => getIncidents('resolved=false'), []);
  const navigate = useNavigate();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const pending = incidents?.content.filter((i) => i.pendingApproval) || [];
  const other = incidents?.content.filter((i) => !i.pendingApproval) || [];

  const handleApprove = async (id: string) => {
    setActionLoading(id);
    setActionError(null);
    try {
      await approveIncident(id);
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to approve');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (id: string) => {
    setActionLoading(id);
    setActionError(null);
    try {
      await rejectIncident(id);
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to reject');
    } finally {
      setActionLoading(null);
    }
  };

  if (!incidents && !error) return <div className="text-gray-500">Loading...</div>;
  if (error) return <div className="text-red-400 text-sm">Failed to load incidents: {error}</div>;

  return (
    <div className="space-y-6">
      {actionError && (
        <div className="text-sm text-red-400 bg-red-400/10 rounded py-2 px-4">{actionError}</div>
      )}
      <div className="bg-providence-surface border border-providence-border rounded-lg p-4">
        <h3 className="text-sm text-gray-400 mb-3">Pending Approvals ({pending.length})</h3>
        {pending.length > 0 ? (
          <div className="space-y-2">
            {pending.map((i, idx) => (
              <div key={i.id} className="flex items-center justify-between bg-providence-bg rounded px-4 py-3 row-enter"
                style={{ animationDelay: `${idx * 30}ms` }}>
                <div className="cursor-pointer hover:text-providence-accent transition-colors"
                  onClick={() => navigate(`/incidents/${i.id}`)}>
                  <IpLink ip={i.sourceIp} className="text-sm text-gray-300" />
                  <span className="text-xs text-gray-500 ml-3">{i.category} · {(i.confidence * 100).toFixed(0)}%</span>
                  <span className="text-xs text-yellow-500 ml-3">{displayTier(i)}</span>
                </div>
                {isAdmin() && (
                  <div className="flex gap-2">
                    <button onClick={() => handleApprove(i.id)}
                      disabled={actionLoading === i.id}
                      className="text-xs px-3 py-1 bg-green-600/20 text-green-400 rounded hover:bg-green-600/30 disabled:opacity-50">
                      {actionLoading === i.id ? '...' : 'Approve'}
                    </button>
                    <button onClick={() => handleReject(i.id)}
                      disabled={actionLoading === i.id}
                      className="text-xs px-3 py-1 bg-red-600/20 text-red-400 rounded hover:bg-red-600/30 disabled:opacity-50">
                      {actionLoading === i.id ? '...' : 'Reject'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : <p className="text-gray-500 text-sm">No pending approvals</p>}
      </div>
      <div className="bg-providence-surface border border-providence-border rounded-lg p-4">
        <h3 className="text-sm text-gray-400 mb-3">Open Incidents ({other.length})</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 text-xs border-b border-providence-border">
              <th className="text-left px-3 py-2">Time</th>
              <th className="text-left px-3 py-2">IP</th>
              <th className="text-left px-3 py-2">Category</th>
              <th className="text-left px-3 py-2">Tier</th>
              <th className="text-left px-3 py-2">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {other.map((i, idx) => (
              <tr key={i.id} onClick={() => navigate(`/incidents/${i.id}`)}
                className="border-b border-providence-border/50 hover:bg-providence-accent/5 cursor-pointer row-enter"
                style={{ animationDelay: `${idx * 30}ms` }}>
                <td className="px-3 py-2 text-gray-400">{new Date(i.createdAt).toLocaleString()}</td>
                <td className="px-3 py-2"><IpLink ip={i.sourceIp} className="text-sm text-gray-300" /></td>
                <td className="px-3 py-2">{i.category}</td>
                <td className="px-3 py-2">{displayTier(i)}</td>
                <td className="px-3 py-2">{(i.confidence * 100).toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
