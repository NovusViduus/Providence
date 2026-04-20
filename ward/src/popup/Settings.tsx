/**
 * Settings page — opens in a new tab.
 * Citadel connection, sensitivity, blocklist management.
 */

import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getBlocklist, addToBlocklist } from '../shared/blocklist';

function SettingsApp() {
  const [citadelUrl, setCitadelUrl] = useState('');
  const [jwt, setJwt] = useState('');
  const [connected, setConnected] = useState(false);
  const [testResult, setTestResult] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [blocklist, setBlocklist] = useState<string[]>([]);

  useEffect(() => {
    chrome.storage.local.get(['citadelUrl', 'citadelJwt', 'connected'], (data) => {
      setCitadelUrl(data.citadelUrl || '');
      setJwt(data.citadelJwt || '');
      setConnected(!!data.connected);
    });
    setBlocklist(getBlocklist());
  }, []);

  const testConnection = async () => {
    try {
      const resp = await fetch(`${citadelUrl}/api/v1/events/stats`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      setTestResult(resp.ok ? '✓ Connected successfully' : `✗ HTTP ${resp.status}`);
    } catch (e) {
      setTestResult(`✗ Connection failed`);
    }
  };

  const toggleConnection = () => {
    const newState = !connected;
    chrome.storage.local.set({ citadelUrl, citadelJwt: jwt, connected: newState });
    setConnected(newState);
  };

  const addDomain = () => {
    if (newDomain.trim()) {
      addToBlocklist(newDomain.trim());
      setBlocklist(getBlocklist());
      setNewDomain('');
    }
  };

  const s: React.CSSProperties = { background: '#0a0f0d', color: '#e0e0e0', minHeight: '100vh', padding: 32, fontFamily: '-apple-system, sans-serif' };
  const input: React.CSSProperties = { background: '#111a16', border: '1px solid #1a2e25', borderRadius: 4, padding: '8px 12px', color: '#e0e0e0', width: '100%', marginBottom: 8 };
  const btn: React.CSSProperties = { background: '#00ffc820', color: '#00ffc8', border: 'none', borderRadius: 4, padding: '6px 16px', cursor: 'pointer' };

  return (
    <div style={s}>
      <h1 style={{ color: '#00ffc8', fontSize: 24 }}>Providence Ward — Settings</h1>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, color: '#888' }}>Citadel Connection</h2>
        <input style={input} placeholder="Citadel URL (e.g., https://providence.example.com)" value={citadelUrl} onChange={e => setCitadelUrl(e.target.value)} />
        <input style={input} type="password" placeholder="JWT Token" value={jwt} onChange={e => setJwt(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button style={btn} onClick={testConnection}>Test Connection</button>
          <button style={{ ...btn, background: connected ? '#d32f2f20' : '#4caf5020', color: connected ? '#d32f2f' : '#4caf50' }} onClick={toggleConnection}>
            {connected ? 'Disconnect' : 'Connect'}
          </button>
        </div>
        {testResult && <p style={{ fontSize: 13, marginTop: 8, color: testResult.startsWith('✓') ? '#4caf50' : '#d32f2f' }}>{testResult}</p>}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, color: '#888' }}>Custom Blocklist ({blocklist.length} entries)</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={{ ...input, flex: 1 }} placeholder="Add domain..." value={newDomain} onChange={e => setNewDomain(e.target.value)} />
          <button style={btn} onClick={addDomain}>Add</button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button style={btn} onClick={() => {
            const blob = new Blob([JSON.stringify(blocklist, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'blocklist.json'; a.click();
          }}>Export JSON</button>
          <button style={btn} onClick={() => {
            const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
            input.onchange = async () => {
              const file = input.files?.[0]; if (!file) return;
              const text = await file.text();
              const domains: string[] = JSON.parse(text);
              domains.forEach(d => addToBlocklist(d));
              setBlocklist(getBlocklist());
            };
            input.click();
          }}>Import JSON</button>
        </div>
        <div style={{ maxHeight: 200, overflow: 'auto', fontSize: 12, color: '#888', marginTop: 8 }}>
          {blocklist.slice(0, 50).map(d => <div key={d} style={{ padding: '2px 0' }}>{d}</div>)}
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <button style={{ ...btn, background: '#d32f2f20', color: '#d32f2f' }}
          onClick={() => { chrome.storage.session.clear(); alert('History cleared'); }}>
          Clear History
        </button>
      </section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<SettingsApp />);
