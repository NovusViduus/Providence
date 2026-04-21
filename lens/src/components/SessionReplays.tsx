import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import TerminalReplay from './TerminalReplay';
import sessionsData from '../data/sessions.json';

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  crypto_miner: { label: 'Crypto Miner', color: '#ff9800' },
  credential_harvester: { label: 'Credential Harvester', color: '#b388ff' },
  lateral_mover: { label: 'Lateral Mover', color: '#2979ff' },
  botnet_recruiter: { label: 'Botnet Recruiter', color: '#ff1744' },
  recon_only: { label: 'Recon Only', color: '#4caf50' },
};

export default function SessionReplays() {
  const [searchParams] = useSearchParams();
  const playParam = searchParams.get('play');
  const [activeId, setActiveId] = useState<string | null>(null);
  const sessions = sessionsData as any[];

  // Auto-select session from URL param (used by demo mode)
  useEffect(() => {
    if (playParam && sessions.some(s => s.id === playParam)) {
      setActiveId(playParam);
    }
  }, [playParam]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-200 mb-1">Session Replays</h2>
        <p className="text-xs text-gray-500">
          Real attacker sessions captured by Providence's honeypots. Watch attackers navigate the fake filesystem,
          steal planted credentials, and deploy malware in real-time.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sessions.map(s => {
          const cat = CATEGORY_LABELS[s.category] || { label: s.category, color: '#888' };
          return (
            <button key={s.id} onClick={() => setActiveId(activeId === s.id ? null : s.id)}
              className={`text-left bg-providence-surface border rounded-lg p-3 transition-all ${
                activeId === s.id ? 'border-providence-accent/50' : 'border-providence-border hover:border-providence-accent/20'
              }`}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-sm text-gray-200">{s.ip}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{ color: cat.color, backgroundColor: cat.color + '18' }}>
                  {cat.label}
                </span>
              </div>
              <p className="text-xs text-gray-500">{s.label}</p>
              <div className="flex gap-3 mt-1 text-[10px] text-gray-600">
                <span>{s.country}</span>
                <span>{s.duration}s session</span>
                <span>{s.lines.filter((l: any) => l.type === 'input').length} commands</span>
              </div>
            </button>
          );
        })}
      </div>

      {activeId && (
        <TerminalReplay
          session={sessions.find(s => s.id === activeId)!}
          autoPlay
        />
      )}
    </div>
  );
}
