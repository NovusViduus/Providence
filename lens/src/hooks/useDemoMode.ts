import { useEffect, useRef, useState, useCallback } from 'react';
import sessionsData from '../data/sessions.json';
import codexData from '../data/codex.json';

const DEMO_STORAGE_KEY = 'providence_demo_active';
const DEMO_INDEX_KEY = 'providence_demo_index';

/**
 * Pick a random element from an array.
 */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Build the demo route sequence. Some routes are randomized each cycle
 * so repeated loops feel different.
 */
function buildRoutes(): { path: string; duration: number }[] {
  // Pick a random session replay
  const sessions = sessionsData as { id: string }[];
  const randomSession = pick(sessions);

  // Pick a random codex entry to deep-dive
  const codex = codexData as { id: string }[];
  const randomCodex = pick(codex);

  // Pick a random attacker IP from known interesting ones
  const dossierIps = [
    '185.220.101.34',  // crypto miner (NL)
    '203.0.113.42',    // brute force
    '45.148.10.240',   // exfiltration
    '176.65.132.254',  // exfiltration
    '109.191.252.59',  // exfiltration
  ];
  const randomIp = pick(dossierIps);

  return [
    // ── Login screen (QR code visible for mobile users) ──
    { path: '/login',                     duration: 20_000 },

    // ── Overview ──
    { path: '/',                          duration: 12_000 },
    { path: '/briefing',                  duration: 20_000 },

    // ── Operations ──
    { path: '/events',                    duration: 10_000 },
    { path: '/attackers',                 duration: 10_000 },
    { path: `/dossier/${randomIp}`,       duration: 12_000 },
    { path: '/clusters',                  duration: 10_000 },
    { path: `/sessions?play=${randomSession.id}`, duration: 25_000 },
    { path: '/incidents',                 duration: 8_000  },
    { path: '/responses',                 duration: 8_000  },

    // ── Visualization (longer pauses) ──
    { path: '/threats',                   duration: 35_000 },
    { path: '/timelapse?autoplay',        duration: 45_000 },
    { path: '/topology',                  duration: 18_000 },

    // ── Knowledge ──
    { path: '/codex',                     duration: 8_000  },
    { path: `/codex?entry=${randomCodex.id}`, duration: 15_000 },
    { path: '/heatmap',                   duration: 10_000 },
    { path: '/playbooks',                 duration: 8_000  },
    { path: '/news',                      duration: 8_000  },

    // ── System (longer pauses) ──
    { path: '/reports',                   duration: 8_000  },
    { path: '/stack',                     duration: 18_000 },
    { path: '/about',                     duration: 18_000 },

    // ── Screensaver ──
    { path: '__screensaver__',            duration: 20_000 },

    // ── Metrics before loop ──
    { path: '/',                          duration: 8_000  },
  ];
}

/**
 * Custom event for demo mode to control the screensaver from Layout.
 */
export const DEMO_SCREENSAVER_EVENT = 'demo:screensaver';

/**
 * Check if demo mode is active (works across components/routes).
 */
export function isDemoActive(): boolean {
  return localStorage.getItem(DEMO_STORAGE_KEY) === 'true';
}

export function useDemoMode(navigate: (path: string) => void) {
  const [active, setActive] = useState(() => isDemoActive());
  const indexRef = useRef(
    parseInt(localStorage.getItem(DEMO_INDEX_KEY) || '0', 10)
  );
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const navigateRef = useRef(navigate);
  const routesRef = useRef<ReturnType<typeof buildRoutes>>(buildRoutes());
  navigateRef.current = navigate;

  const start = useCallback(() => {
    routesRef.current = buildRoutes();
    indexRef.current = 0;
    localStorage.setItem(DEMO_STORAGE_KEY, 'true');
    localStorage.setItem(DEMO_INDEX_KEY, '0');
    setActive(true);
  }, []);

  const stop = useCallback(() => {
    setActive(false);
    localStorage.removeItem(DEMO_STORAGE_KEY);
    localStorage.removeItem(DEMO_INDEX_KEY);
    clearTimeout(timerRef.current);
    // Dismiss screensaver if it's showing
    window.dispatchEvent(new CustomEvent(DEMO_SCREENSAVER_EVENT, { detail: { show: false } }));
  }, []);

  useEffect(() => {
    if (!active) return;

    function goToNext() {
      const routes = routesRef.current;
      const route = routes[indexRef.current];

      // Persist current index so we can resume after remount
      localStorage.setItem(DEMO_INDEX_KEY, String(indexRef.current));

      if (route.path === '__screensaver__') {
        // Tell Layout to show the screensaver
        window.dispatchEvent(new CustomEvent(DEMO_SCREENSAVER_EVENT, { detail: { show: true } }));
      } else {
        // Dismiss screensaver if it was showing
        window.dispatchEvent(new CustomEvent(DEMO_SCREENSAVER_EVENT, { detail: { show: false } }));
        navigateRef.current(route.path);
      }

      timerRef.current = setTimeout(() => {
        const nextIndex = (indexRef.current + 1) % routes.length;
        // Rebuild routes at the start of each cycle for fresh random picks
        if (nextIndex === 0) {
          routesRef.current = buildRoutes();
        }
        indexRef.current = nextIndex;
        goToNext();
      }, route.duration);
    }

    goToNext();
    return () => clearTimeout(timerRef.current);
  }, [active]);

  return { active, start, stop };
}
