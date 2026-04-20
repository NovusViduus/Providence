import { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { getActiveBlocks, getActions, unblockIp } from '../services/api';
import { isAdmin } from '../services/auth';
import IpLink from './IpLink';

function useCountdown() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function formatRemaining(expiresAt: string, now: number): string {
  const diff = new Date(expiresAt).getTime() - now;
  if (diff <= 0) return 'Expired';
  const m = Math.floor(diff / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function CollapsibleSection({ title, count, defaultOpen = true, children }: {
  title: string; count?: number; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-providence-surface border border-providence-border rounded-lg overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.01] transition-colors">
        <div className="flex items-center gap-2">
          <h3 className="text-sm text-gray-400">{title}</h3>
          {count !== undefined && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-providence-accent/10 text-providence-accent">
              {count}
            </span>
          )}
        </div>
        <ChevronDown size={14} className={`text-gray-600 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

export default function ResponseLog() {
  const { data: blocks, error: blocksError, refresh: refreshBlocks } = useApi(() => getActiveBlocks(), []);
  const [page, setPage] = useState(0);
  const { data: actions, error: actionsError } = useApi(() => getActions(`size=50&page=${page}`), [page]);
  const now = useCountdown();
  const [unblocking, setUnblocking] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleUnblock = async (ip: string) => {
    setUnblocking(ip);
    setActionError(null);
    try {
      await unblockIp(ip);
      refreshBlocks();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to unblock');
    } finally {
      setUnblocking(null);
    }
  };

  const blockCount = blocks ? Object.keys(blocks).length : 0;
  const total = actions?.totalElements || 0;

  return (
    <div className="space-y-4">
      {actionError && (
        <div className="text-sm text-red-400 bg-red-400/10 rounded py-2 px-4">{actionError}</div>
      )}

      <CollapsibleSection title="Active Blocks" count={blockCount}>
        {blocksError ? (
          <p className="text-red-400 text-sm">Failed to load blocks: {blocksError}</p>
        ) : !blocks ? (
          <p className="text-gray-500 text-sm">Loading...</p>
        ) : blockCount > 0 ? (
          <div className="space-y-2">
            {Object.entries(blocks).map(([ip, json], idx) => {
              let info: Record<string, string> = {};
              try { info = JSON.parse(json); } catch { /* */ }
              return (
                <div key={ip} className="flex items-center justify-between bg-providence-bg rounded px-3 py-2 row-enter"
                  style={{ animationDelay: `${idx * 30}ms` }}>
                  <div>
                    <IpLink ip={ip} className="text-sm text-gray-300" />
                    <span className="text-xs text-gray-500 ml-3">{info.action} · {info.category}</span>
                    {info.expiresAt && (
                      <span className={`text-xs ml-2 ${formatRemaining(info.expiresAt, now) === 'Expired' ? 'text-red-400' : 'text-yellow-500'}`}>
                        {formatRemaining(info.expiresAt, now)}
                      </span>
                    )}
                  </div>
                  {isAdmin() && (
                    <button onClick={() => handleUnblock(ip)}
                      disabled={unblocking === ip}
                      className="text-xs px-2 py-1 bg-providence-danger/20 text-providence-danger rounded hover:bg-providence-danger/30 disabled:opacity-50">
                      {unblocking === ip ? '...' : 'Unblock'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : <p className="text-gray-500 text-sm">No active blocks</p>}
      </CollapsibleSection>

      <CollapsibleSection title="Action History" count={total}>
        {actionsError ? (
          <p className="text-red-400 text-sm">Failed to load actions: {actionsError}</p>
        ) : !actions ? (
          <p className="text-gray-500 text-sm">Loading...</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-xs border-b border-providence-border">
                    <th className="text-left px-3 py-2">Time</th>
                    <th className="text-left px-3 py-2">IP</th>
                    <th className="text-left px-3 py-2">Action</th>
                    <th className="text-left px-3 py-2">Platform</th>
                    <th className="text-left px-3 py-2">Status</th>
                    <th className="text-left px-3 py-2">Reversed</th>
                  </tr>
                </thead>
                <tbody>
                  {actions.content.map((a, idx) => (
                    <tr key={a.id} className="border-b border-providence-border/50 row-enter"
                      style={{ animationDelay: `${idx * 20}ms` }}>
                      <td className="px-3 py-2 text-gray-400">{new Date(a.createdAt).toLocaleString()}</td>
                      <td className="px-3 py-2"><IpLink ip={a.sourceIp} className="text-sm text-gray-300" /></td>
                      <td className="px-3 py-2">{a.actionType}</td>
                      <td className="px-3 py-2 text-gray-500">{a.platform}</td>
                      <td className="px-3 py-2">
                        <span className={a.success ? 'text-green-400' : 'text-red-400'}>{a.success ? '✓ Success' : '✗ Failed'}</span>
                      </td>
                      <td className="px-3 py-2 text-gray-500">
                        {a.reversedAt
                          ? <span className="text-yellow-400">{a.reversedReason || 'Reversed'}</span>
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2 justify-center mt-4">
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1 text-xs bg-providence-surface border border-providence-border rounded disabled:opacity-30 text-gray-300">
                ← Previous
              </button>
              <span className="text-xs text-gray-500 py-1">Page {page + 1}</span>
              <button disabled={(page + 1) * 50 >= total} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1 text-xs bg-providence-surface border border-providence-border rounded disabled:opacity-30 text-gray-300">
                Next →
              </button>
            </div>
          </>
        )}
      </CollapsibleSection>
    </div>
  );
}
