import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { getEventStats, getGeoEvents, getActiveBlocks, getIncidents, getActions } from '../services/api';
import { FileText, Printer } from 'lucide-react';
import { getCategoryHex } from '../utils/geoip';
import type { GeoThreat } from '../types/events';

function generateReportHtml(
  stats: any,
  geo: GeoThreat[],
  blocks: Record<string, string>,
  incidents: any,
  actions: any,
  timeRange: string
): string {
  const now = new Date();
  const totalEvents = stats.total || 0;
  const actCount = stats.byTier?.ACT || 0;
  const recCount = stats.byTier?.RECOMMEND || 0;
  const obsCount = stats.byTier?.OBSERVE || 0;
  const blockCount = blocks ? Object.keys(blocks).length : 0;
  const incidentCount = incidents?.totalElements || 0;
  const actionCount = actions?.totalElements || 0;
  const successActions = actions?.content?.filter((a: any) => a.success)?.length || 0;

  const cats = Object.entries(stats.byCategory || {})
    .filter(([, v]) => (v as number) > 0)
    .sort(([, a], [, b]) => (b as number) - (a as number)) as [string, number][];

  const countryMap: Record<string, number> = {};
  for (const t of (geo || [])) {
    countryMap[t.country] = (countryMap[t.country] || 0) + t.eventCount;
  }
  const topCountries = Object.entries(countryMap).sort(([, a], [, b]) => b - a).slice(0, 10);
  const topAttackers = [...(geo || [])].sort((a, b) => b.eventCount - a.eventCount).slice(0, 10);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Providence Threat Report - ${now.toLocaleDateString()}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; padding: 40px; max-width: 800px; margin: 0 auto; font-size: 12px; line-height: 1.6; }
  h1 { font-size: 24px; color: #0C1017; margin-bottom: 4px; }
  h2 { font-size: 16px; color: #333; margin: 24px 0 12px; padding-bottom: 6px; border-bottom: 2px solid #00c9a0; }
  h3 { font-size: 13px; color: #555; margin: 16px 0 8px; }
  .subtitle { color: #666; font-size: 11px; margin-bottom: 24px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #e0e0e0; }
  .logo { font-size: 28px; font-weight: bold; color: #00c9a0; letter-spacing: 3px; }
  .meta { text-align: right; font-size: 10px; color: #888; }
  .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }
  .stat-card { background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 6px; padding: 12px; text-align: center; }
  .stat-value { font-size: 22px; font-weight: bold; color: #0C1017; }
  .stat-label { font-size: 9px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 11px; }
  th { background: #f0f0f0; text-align: left; padding: 6px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #555; }
  td { padding: 6px 10px; border-bottom: 1px solid #eee; }
  tr:nth-child(even) { background: #fafafa; }
  .bar-container { height: 8px; background: #e8e8e8; border-radius: 4px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 4px; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e0e0e0; font-size: 9px; color: #aaa; text-align: center; }
  .classification { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 10px; font-weight: 600; }
  .act { background: #ffebee; color: #c62828; }
  .recommend { background: #fff8e1; color: #f57f17; }
  .observe { background: #f5f5f5; color: #616161; }
  @media print { body { padding: 20px; } }
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="logo">PROVIDENCE</div>
    <div class="subtitle">Threat Intelligence Report</div>
  </div>
  <div class="meta">
    <div>Generated: ${now.toLocaleString()}</div>
    <div>Period: ${timeRange}</div>
    <div>Classification: UNCLASSIFIED</div>
  </div>
</div>

<h2>Executive Summary</h2>
<p>Providence processed <strong>${totalEvents.toLocaleString()}</strong> security events during the reporting period across 3 honeypot instances in us-east-1, eu-west-1, and ap-southeast-1. The response engine triggered <strong>${actCount}</strong> automatic blocks (ACT-tier), flagged <strong>${recCount}</strong> events for human review (RECOMMEND-tier), and logged <strong>${obsCount.toLocaleString()}</strong> events for intelligence (OBSERVE-tier). <strong>${blockCount}</strong> IP addresses are currently blocked. <strong>${(geo || []).length}</strong> unique source IPs were observed from <strong>${Object.keys(countryMap).length}</strong> countries.</p>

<div class="stats-grid">
  <div class="stat-card"><div class="stat-value">${totalEvents.toLocaleString()}</div><div class="stat-label">Total Events</div></div>
  <div class="stat-card"><div class="stat-value" style="color:#c62828">${actCount}</div><div class="stat-label">ACT-tier</div></div>
  <div class="stat-card"><div class="stat-value">${blockCount}</div><div class="stat-label">Active Blocks</div></div>
  <div class="stat-card"><div class="stat-value">${(geo || []).length}</div><div class="stat-label">Unique IPs</div></div>
</div>

<h2>Attack Category Breakdown</h2>
<table>
  <tr><th>Category</th><th>Events</th><th>Percentage</th><th>Distribution</th></tr>
  ${cats.map(([cat, count]) => `
  <tr>
    <td><strong>${cat}</strong></td>
    <td>${count.toLocaleString()}</td>
    <td>${totalEvents > 0 ? ((count / totalEvents) * 100).toFixed(1) : 0}%</td>
    <td><div class="bar-container"><div class="bar-fill" style="width:${totalEvents > 0 ? (count / totalEvents) * 100 : 0}%;background:${getCategoryHex(cat)}"></div></div></td>
  </tr>`).join('')}
</table>

<h2>Response Tier Distribution</h2>
<table>
  <tr><th>Tier</th><th>Count</th><th>Action</th></tr>
  <tr><td><span class="classification act">ACT</span></td><td>${actCount}</td><td>Automatic firewall block with TTL expiry</td></tr>
  <tr><td><span class="classification recommend">RECOMMEND</span></td><td>${recCount}</td><td>Queued for human approval</td></tr>
  <tr><td><span class="classification observe">OBSERVE</span></td><td>${obsCount.toLocaleString()}</td><td>Logged for intelligence</td></tr>
</table>

<h2>Geographic Analysis</h2>
<h3>Top Source Countries</h3>
<table>
  <tr><th>#</th><th>Country</th><th>Events</th><th>Distribution</th></tr>
  ${topCountries.map(([country, count], i) => `
  <tr>
    <td>${i + 1}</td>
    <td>${country}</td>
    <td>${count.toLocaleString()}</td>
    <td><div class="bar-container"><div class="bar-fill" style="width:${(count / (topCountries[0]?.[1] || 1)) * 100}%;background:#00c9a0"></div></div></td>
  </tr>`).join('')}
</table>

<h3>Top Attacker IPs</h3>
<table>
  <tr><th>#</th><th>Source IP</th><th>Country</th><th>City</th><th>Category</th><th>Events</th></tr>
  ${topAttackers.map((t, i) => `
  <tr>
    <td>${i + 1}</td>
    <td><code>${t.sourceIp}</code></td>
    <td>${t.country}</td>
    <td>${t.city || '-'}</td>
    <td>${t.category}</td>
    <td>${t.eventCount}</td>
  </tr>`).join('')}
</table>

<h2>Response Effectiveness</h2>
<table>
  <tr><th>Metric</th><th>Value</th></tr>
  <tr><td>Total Response Actions</td><td>${actionCount}</td></tr>
  <tr><td>Successful Blocks</td><td>${successActions}</td></tr>
  <tr><td>Success Rate</td><td>${actionCount > 0 ? ((successActions / (actions?.content?.length || 1)) * 100).toFixed(0) : '-'}%</td></tr>
  <tr><td>Currently Blocked IPs</td><td>${blockCount}</td></tr>
  <tr><td>Open Incidents</td><td>${incidents?.content?.filter((i: any) => !i.resolved)?.length || 0}</td></tr>
  <tr><td>Pending Approval</td><td>${incidents?.content?.filter((i: any) => i.pendingApproval)?.length || 0}</td></tr>
</table>

<h2>Infrastructure Status</h2>
<table>
  <tr><th>Honeypot</th><th>Region</th><th>Profile</th><th>Status</th></tr>
  <tr><td>prod-web-01</td><td>us-east-1</td><td>GPU Server (4x A100)</td><td>Active</td></tr>
  <tr><td>prod-api-eu</td><td>eu-west-1</td><td>Fintech API</td><td>Active</td></tr>
  <tr><td>prod-db-sg</td><td>ap-southeast-1</td><td>ML Training (2x H100)</td><td>Active</td></tr>
</table>

<div class="footer">
  Providence v1.0 | Per Providentiam, Securitas | Generated by The Lens<br>
  This report is auto-generated from live Providence data. All planted credentials referenced in honeypot configurations are fake and monitored.
</div>
</body>
</html>`;
}

export default function ReportGenerator() {
  const { data: stats } = useApi(() => getEventStats(), []);
  const { data: geo } = useApi(() => getGeoEvents(720), []);
  const { data: blocks } = useApi(() => getActiveBlocks(), []);
  const { data: incidents } = useApi(() => getIncidents('size=200'), []);
  const { data: actions } = useApi(() => getActions('size=200'), []);
  const [generating, setGenerating] = useState(false);

  const generate = () => {
    if (!stats) return;
    setGenerating(true);

    const html = generateReportHtml(
      stats, geo || [], blocks || {}, incidents, actions, 'Last 30 days'
    );

    // Open in new window and trigger print
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
      setTimeout(() => {
        win.print();
        setGenerating(false);
      }, 500);
    } else {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-200">Reports</h2>
          <p className="text-xs text-gray-500">Generate PDF threat intelligence reports from live Providence data</p>
        </div>
        <button onClick={generate} disabled={!stats || generating}
          className="flex items-center gap-2 px-4 py-2 bg-providence-accent/20 text-providence-accent rounded-lg hover:bg-providence-accent/30 transition-colors disabled:opacity-50 text-sm">
          {generating ? (
            <><Printer size={15} className="animate-spin" /> Generating...</>
          ) : (
            <><FileText size={15} /> Generate Report</>
          )}
        </button>
      </div>

      {/* Preview */}
      <div className="bg-providence-surface border border-providence-border rounded-lg p-6">
        <h3 className="text-sm text-gray-400 mb-4">Report Preview</h3>
        {stats ? (
          <div className="space-y-4 text-xs text-gray-400">
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Total Events', value: stats.total?.toLocaleString() },
                { label: 'ACT-tier', value: stats.byTier?.ACT || 0 },
                { label: 'Active Blocks', value: blocks ? Object.keys(blocks).length : 0 },
                { label: 'Unique IPs', value: geo?.length || 0 },
              ].map(s => (
                <div key={s.label} className="bg-providence-bg rounded p-3 text-center">
                  <p className="text-lg font-mono font-bold text-gray-200">{s.value}</p>
                  <p className="text-[9px] text-gray-600 uppercase tracking-wider">{s.label}</p>
                </div>
              ))}
            </div>
            <p className="text-gray-500 leading-relaxed">
              The report will include: executive summary, attack category breakdown with distribution bars,
              response tier analysis, geographic source analysis with top countries and IPs,
              response effectiveness metrics, and infrastructure status for all 3 honeypots.
              Output is a print-ready HTML document that can be saved as PDF via the browser print dialog.
            </p>
          </div>
        ) : (
          <p className="text-gray-600">Loading data...</p>
        )}
      </div>
    </div>
  );
}
