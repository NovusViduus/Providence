import { useEffect, useRef, useState, useCallback } from 'react';
import type { SecurityEvent } from '../types/events';
import { getToken } from '../services/auth';
import { pingEvent, alertAct, lockSound, newCountryChime, spikeWarning, isSoundEnabled } from '../utils/sound';

const MAX_EVENTS = 200;
const MAX_RECONNECT_DELAY = 30000;
const seenCountries = new Set<string>();
const categoryRates: Record<string, number[]> = {};

export function useWebSocket(url: string) {
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);

  const connect = useCallback(() => {
    const token = getToken();
    const wsUrl = `${url}${token ? '?token=' + token : ''}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setError(null);
      // Backfill on reconnect, fetch recent events to fill the gap
      if (retryRef.current > 0) {
        fetch('/api/v1/events?size=50&sort=timestamp,desc', {
          headers: { Authorization: `Bearer ${token || ''}` },
        })
          .then(r => r.json())
          .then(data => {
            if (data.content) {
              setEvents(prev => {
                const ids = new Set(prev.map(e => e.eventId || e.id));
                const newEvents = data.content.filter((e: SecurityEvent) => !ids.has(e.eventId || e.id));
                return [...newEvents, ...prev].slice(0, MAX_EVENTS);
              });
            }
          })
          .catch(() => { /* backfill failed, continue with live stream */ });
      }
      retryRef.current = 0;
    };

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as SecurityEvent;
        setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS));

        if (isSoundEnabled()) {
          if (event.responseTier === 'ACT') {
            alertAct();
            setTimeout(() => lockSound(), 600);
          } else {
            pingEvent();
          }

          // New country detection
          // Use a simple heuristic from dest port to guess region
          const countryKey = event.sourceIp?.split('.').slice(0, 2).join('.');
          if (countryKey && !seenCountries.has(countryKey)) {
            seenCountries.add(countryKey);
            if (seenCountries.size > 3) { // skip the first few
              newCountryChime();
            }
          }

          // Spike detection
          const now = Date.now();
          const cat = event.category;
          if (!categoryRates[cat]) categoryRates[cat] = [];
          categoryRates[cat].push(now);
          categoryRates[cat] = categoryRates[cat].filter(t => now - t < 60000);
          if (categoryRates[cat].length === 10) {
            spikeWarning();
          }
        }
      } catch { /* ignore malformed */ }
    };

    ws.onclose = () => {
      setConnected(false);
      const delay = Math.min(1000 * 2 ** retryRef.current, MAX_RECONNECT_DELAY);
      retryRef.current++;
      setTimeout(connect, delay);
    };

    ws.onerror = () => setError('WebSocket connection error');
  }, [url]);

  useEffect(() => {
    connect();
    return () => { wsRef.current?.close(); };
  }, [connect]);

  return { events, connected, error };
}
