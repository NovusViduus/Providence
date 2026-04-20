import { useEffect, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { getEventStats, getGeoEvents, getActiveBlocks, getIncidents } from '../services/api';
import { Bot } from 'lucide-react';
import type { GeoThreat } from '../types/events';

interface Briefing {
  timestamp: string;
  paragraphs: string[];
  highlights: { label: string; value: string; color: string }[];
}

function generateBriefing(
  stats: any,
  geo: GeoThreat[],
  blocks: Record<string, string>,
  incidents: any
): Briefing {
  const paragraphs: string[] = [];
  const highlights: { label: string; value: string; color: string }[] = [];
  const now = new Date();
  const timeStr = now.toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' });

  // Overall activity
  const totalEvents = stats.total || 0;
  const lastHour = stats.lastHour || 0;
  const lastDay = stats.lastDay || 0;
  const actCount = stats.byTier?.ACT || 0;
  const recCount = stats.byTier?.RECOMMEND || 0;

  paragraphs.push(
    `As of ${timeStr}, Providence has processed ${totalEvents.toLocaleString()} total events across all honeypots. ` +
    `${lastDay.toLocaleString()} events were recorded in the last 24 hours, with ${lastHour} in the last hour. ` +
    (lastHour > lastDay / 24 * 1.5
      ? `This represents elevated activity, approximately ${Math.round(lastHour / (lastDay / 24) * 100)}% of the hourly average.`
      : `Activity levels are within normal parameters.`)
  );

  highlights.push(
    { label: 'Total Events', value: totalEvents.toLocaleString(), color: '#0A9396' },
    { label: 'Last 24h', value: lastDay.toLocaleString(), color: '#0A9396' },
    { label: 'ACT-tier', value: String(actCount), color: '#ff1744' },
  );

  // Category breakdown
  const cats = Object.entries(stats.byCategory || {})
    .filter(([, v]) => (v as number) > 0)
    .sort(([, a], [, b]) => (b as number) - (a as number)) as [string, number][];

  if (cats.length > 0) {
    const topCat = cats[0];
    const topPct = totalEvents > 0 ? Math.round((topCat[1] / totalEvents) * 100) : 0;
    paragraphs.push(
      `The dominant attack category is ${topCat[0]} at ${topPct}% of all traffic (${topCat[1].toLocaleString()} events). ` +
      (cats.length > 1
        ? `This is followed by ${cats.slice(1, 3).map(([k, v]) => `${k} (${v.toLocaleString()})`).join(' and ')}.`
        : '')
    );
  }

  // Geographic analysis
  if (geo && geo.length > 0) {
    const countryMap: Record<string, number> = {};
    for (const t of geo) {
      countryMap[t.country] = (countryMap[t.country] || 0) + t.eventCount;
    }
    const topCountries = Object.entries(countryMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);

    // Per-honeypot breakdown
    const honeypotTraffic: Record<string, number> = {};
    for (const t of geo) {
      const dest = t.destCountry || 'Unknown';
      honeypotTraffic[dest] = (honeypotTraffic[dest] || 0) + t.eventCount;
    }

    paragraphs.push(
      `Geographic analysis shows ${geo.length} unique source IPs across ${Object.keys(countryMap).length} countries. ` +
      `Top sources: ${topCountries.map(([c, n]) => `${c} (${n} events)`).join(', ')}.`
    );

    highlights.push(
      { label: 'Unique IPs', value: String(geo.length), color: '#b388ff' },
      { label: 'Countries', value: String(Object.keys(countryMap).length), color: '#2979ff' },
    );
  }

  // Threat response
  const blockCount = blocks ? Object.keys(blocks).length : 0;
  const pendingIncidents = incidents?.content?.filter((i: any) => i.pendingApproval)?.length || 0;
  const openIncidents = incidents?.content?.filter((i: any) => !i.resolved && !i.pendingApproval)?.length || 0;

  if (actCount > 0 || blockCount > 0 || pendingIncidents > 0) {
    let responsePara = `Response engine status: `;
    const parts: string[] = [];
    if (actCount > 0) parts.push(`${actCount} ACT-tier events triggered automatic firewall blocks`);
    if (blockCount > 0) parts.push(`${blockCount} IP${blockCount > 1 ? 's' : ''} currently blocked`);
    if (pendingIncidents > 0) parts.push(`${pendingIncidents} incident${pendingIncidents > 1 ? 's' : ''} pending human approval`);
    if (openIncidents > 0) parts.push(`${openIncidents} open incident${openIncidents > 1 ? 's' : ''} under investigation`);
    responsePara += parts.join('. ') + '.';
    paragraphs.push(responsePara);

    highlights.push(
      { label: 'Active Blocks', value: String(blockCount), color: '#ff9800' },
    );
  }

  // Recommendation
  if (actCount > 5) {
    paragraphs.push(
      `Recommendation: The elevated ACT-tier activity warrants review of the incident queue. ` +
      `Consider tightening playbook confidence thresholds if false positive rates are acceptable.`
    );
  } else if (pendingIncidents > 3) {
    paragraphs.push(
      `Recommendation: ${pendingIncidents} incidents are awaiting approval. Review the incident queue to clear the backlog.`
    );
  } else {
    paragraphs.push(
      `Assessment: Threat levels are within expected parameters. The honeypot fleet is operating normally across all three regions. No immediate action required.`
    );
  }

  return { timestamp: now.toISOString(), paragraphs, highlights };
}

export default function ThreatBriefing() {
  const { data: stats } = useApi(() => getEventStats(), []);
  const { data: geo } = useApi(() => getGeoEvents(24), []);
  const { data: blocks } = useApi(() => getActiveBlocks(), []);
  const { data: incidents } = useApi(() => getIncidents('size=200'), []);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [typing, setTyping] = useState(false);
  const [visibleChars, setVisibleChars] = useState(0);

  useEffect(() => {
    if (!stats) return;
    const b = generateBriefing(stats, geo || [], blocks || {}, incidents);
    setBriefing(b);
    // Typewriter effect
    setTyping(true);
    setVisibleChars(0);
    const fullText = b.paragraphs.join('\n\n');
    let i = 0;
    const interval = setInterval(() => {
      i += 2;
      setVisibleChars(i);
      if (i >= fullText.length) {
        clearInterval(interval);
        setTyping(false);
      }
    }, 8);
    return () => clearInterval(interval);
  }, [stats, geo, blocks, incidents]);

  if (!briefing) return <div className="text-gray-500">Generating briefing...</div>;

  const fullText = briefing.paragraphs.join('\n\n');
  const displayText = fullText.slice(0, visibleChars);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-providence-accent/10 flex items-center justify-center">
          <Bot size={20} className="text-providence-accent" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-200">Threat Briefing</h2>
          <p className="text-xs text-gray-500">
            Auto-generated intelligence summary from live Providence data
          </p>
        </div>
      </div>

      {/* Highlights */}
      <div className="flex flex-wrap gap-3">
        {briefing.highlights.map(h => (
          <div key={h.label} className="bg-providence-surface border border-providence-border rounded-lg px-3 py-2">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">{h.label}</p>
            <p className="text-lg font-mono font-bold" style={{ color: h.color }}>{h.value}</p>
          </div>
        ))}
      </div>

      {/* Briefing text */}
      <div className="bg-providence-surface border border-providence-border rounded-lg p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2 h-2 rounded-full bg-providence-accent animate-pulse" />
          <span className="text-[10px] text-gray-500 uppercase tracking-wider">
            {new Date(briefing.timestamp).toLocaleString()}
          </span>
        </div>
        <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap font-light">
          {displayText}
          {typing && <span className="animate-pulse text-providence-accent">|</span>}
        </div>
      </div>

      <p className="text-[10px] text-gray-700 text-center">
        Generated from live event data. Not powered by an LLM. Analysis is deterministic and based on statistical thresholds.
      </p>
    </div>
  );
}
