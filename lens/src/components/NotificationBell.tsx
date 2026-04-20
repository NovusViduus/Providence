import { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getCategoryHex } from '../utils/geoip';
import type { SecurityEvent } from '../types/events';

interface Alert {
  id: number;
  type: 'act' | 'spike' | 'new_country' | 'new_ip';
  title: string;
  detail: string;
  color: string;
  ip?: string;
  timestamp: Date;
  read: boolean;
}

// Track state across renders
let alertIdCounter = 0;
const seenCountries = new Set<string>();
const categoryRates: Record<string, number[]> = {};

function checkForAlerts(event: SecurityEvent, existingAlerts: Alert[]): Alert[] {
  const newAlerts: Alert[] = [];

  // ACT-tier events
  if (event.responseTier === 'ACT') {
    newAlerts.push({
      id: alertIdCounter++,
      type: 'act',
      title: `ACT-tier: ${event.category}`,
      detail: `${event.sourceIp} targeting :${event.destPort}`,
      color: '#ff1744',
      ip: event.sourceIp,
      timestamp: new Date(),
      read: false,
    });
  }

  // Track category rates for spike detection
  const now = Date.now();
  if (!categoryRates[event.category]) categoryRates[event.category] = [];
  categoryRates[event.category].push(now);
  // Keep last 5 minutes
  categoryRates[event.category] = categoryRates[event.category].filter(t => now - t < 300000);
  // Spike: more than 15 events of same category in 5 minutes
  if (categoryRates[event.category].length === 15) {
    newAlerts.push({
      id: alertIdCounter++,
      type: 'spike',
      title: `${event.category} spike detected`,
      detail: `${categoryRates[event.category].length} events in 5 minutes`,
      color: '#ffd600',
      timestamp: new Date(),
      read: false,
    });
  }

  return newAlerts;
}

export default function NotificationBell({ events }: { events: SecurityEvent[] }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [open, setOpen] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const lastProcessed = useRef(0);
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);

  // Request notification permission on first interaction
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'granted') {
      setPermissionGranted(true);
    }
  }, []);

  const requestPermission = useCallback(async () => {
    if ('Notification' in window) {
      const perm = await Notification.requestPermission();
      setPermissionGranted(perm === 'granted');
    }
  }, []);

  // Process new events
  useEffect(() => {
    if (events.length <= lastProcessed.current) return;

    const newEvents = events.slice(0, events.length - lastProcessed.current);
    lastProcessed.current = events.length;

    const newAlerts: Alert[] = [];
    for (const evt of newEvents) {
      newAlerts.push(...checkForAlerts(evt, alerts));
    }

    if (newAlerts.length > 0) {
      setAlerts(prev => [...newAlerts, ...prev].slice(0, 50));

      // Browser notification if tab is hidden
      if (permissionGranted && document.hidden) {
        const latest = newAlerts[0];
        try {
          new Notification(`Providence: ${latest.title}`, {
            body: latest.detail,
            icon: '/favicon.svg',
          });
        } catch { /* notifications not supported */ }
      }
    }
  }, [events.length]);

  // Close panel on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const unread = alerts.filter(a => !a.read).length;
  const markAllRead = () => setAlerts(prev => prev.map(a => ({ ...a, read: true })));

  return (
    <div className="relative" ref={panelRef}>
      <button onClick={() => { setOpen(!open); if (!permissionGranted) requestPermission(); }}
        className="relative text-gray-500 hover:text-gray-300 transition-colors">
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 rounded-full text-[9px] text-white flex items-center justify-center font-bold">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-8 w-80 max-h-[500px] bg-providence-bg border border-providence-border rounded-lg shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-providence-border">
            <span className="text-xs text-gray-400 font-semibold">Alerts</span>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button onClick={markAllRead} className="text-[10px] text-providence-accent hover:underline">
                  Mark all read
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-gray-600 hover:text-gray-400">
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="overflow-y-auto max-h-[440px] panel-scroll">
            {alerts.length === 0 ? (
              <p className="text-xs text-gray-600 p-4 text-center">No alerts yet. Alerts appear when ACT-tier events fire or traffic spikes are detected.</p>
            ) : (
              alerts.map(a => (
                <button key={a.id}
                  onClick={() => {
                    setAlerts(prev => prev.map(x => x.id === a.id ? { ...x, read: true } : x));
                    if (a.ip) navigate(`/dossier/${encodeURIComponent(a.ip)}`);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2.5 border-b border-providence-border/30 hover:bg-providence-accent/5 transition-colors ${
                    a.read ? 'opacity-60' : ''
                  }`}>
                  <div className="flex items-center gap-2 mb-0.5">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: a.color }} />
                    <span className="text-xs font-semibold text-gray-200">{a.title}</span>
                  </div>
                  <p className="text-[10px] text-gray-500 ml-3.5">{a.detail}</p>
                  <p className="text-[9px] text-gray-700 ml-3.5 mt-0.5">{a.timestamp.toLocaleTimeString()}</p>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
