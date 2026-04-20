import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

interface TabResult {
  score: number;
  level: string;
  reasons: string[];
  url: string;
  hostname: string;
}

interface HistoryEntry {
  url: string;
  hostname: string;
  score: number;
  level: string;
  timestamp: number;
}

const LEVEL_COLORS: Record<string, string> = { low: '#4caf50', medium: '#ffd600', high: '#d32f2f' };
const LEVEL_LABELS: Record<string, string> = { low: 'Safe', medium: 'Caution', high: 'Danger' };

function App() {
  const [current, setCurrent] = useState<TabResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.storage.session.get(`tab_${tabs[0].id}`, (data) => {
          setCurrent(data[`tab_${tabs[0].id}`] || null);
        });
      }
    });
    chrome.storage.session.get('history', (data) => setHistory(data.history || []));
    chrome.storage.local.get('connected', (data) => setConnected(!!data.connected));
  }, []);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#00ffc8' }}>Providence Ward</span>
      </div>

      {current ? (
        <div>
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 48, fontWeight: 700, color: LEVEL_COLORS[current.level] || '#888' }}>
              {current.score}
            </div>
            <div style={{ fontSize: 14, color: LEVEL_COLORS[current.level], fontWeight: 600 }}>
              {LEVEL_LABELS[current.level] || current.level}
            </div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 4, wordBreak: 'break-all' }}>
              {current.hostname}
            </div>
          </div>

          {current.reasons.length > 0 && (
            <div style={{ background: '#111a16', borderRadius: 8, padding: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>Threat Signals</div>
              {current.reasons.map((r, i) => (
                <div key={i} style={{ fontSize: 12, color: '#ccc', padding: '2px 0' }}>• {r}</div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ color: '#666', fontSize: 13, textAlign: 'center', padding: 20 }}>
          Navigate to a page to see its threat analysis
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>Recent Pages</div>
        {history.slice(0, 10).map((h, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12 }}>
            <span style={{ color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
              {h.hostname}
            </span>
            <span style={{ color: LEVEL_COLORS[h.level] || '#888', fontWeight: 600 }}>{h.score}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16, borderTop: '1px solid #1a2e25', paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
        <a href="#" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') })}
           style={{ color: '#00ffc8', textDecoration: 'none' }}>Settings</a>
        <span style={{ color: connected ? '#4caf50' : '#666' }}>
          {connected ? '● Connected' : '○ Standalone'}
        </span>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
