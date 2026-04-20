import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/events': 'Events',
  '/incidents': 'Incidents',
  '/responses': 'Responses',
  '/attackers': 'Attackers',
  '/clusters': 'Behavior Clusters',
  '/sessions': 'Session Replays',
  '/threats': 'Threat Map',
  '/timelapse': 'Timelapse',
  '/topology': 'Network Topology',
  '/briefing': 'Threat Briefing',
  '/heatmap': 'Command Heatmap',
  '/reports': 'Reports',
  '/codex': 'Codex',
  '/playbooks': 'Playbooks',
  '/news': 'News',
  '/stack': 'Tech Stack',
  '/about': 'About',
};

export function usePageTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    const base = 'Providence';
    const page = TITLES[pathname] || (pathname.startsWith('/dossier/') ? 'Dossier' : null);
    document.title = page ? `${page} | ${base}` : base;
  }, [pathname]);
}
