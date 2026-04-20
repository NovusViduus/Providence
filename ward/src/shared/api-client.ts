/**
 * Connected mode — dispatches threat events to The Citadel.
 */

import type { PageAnalysis, ThreatResult } from './types';

const RATE_LIMIT_MS = 10 * 60 * 1000; // 10 minutes per domain
const recentDispatches = new Map<string, number>();

const CATEGORY_MAP: Record<string, string> = {
  cryptominer: 'WEB_CRYPTOMINER',
  phishing: 'WEB_PHISHING',
  injection: 'WEB_INJECTION',
  tracking: 'WEB_TRACKING',
};

function detectCategory(analysis: PageAnalysis): string {
  if (analysis.signals.cryptominerPatterns.length > 0) return 'WEB_CRYPTOMINER';
  if (analysis.phishing?.domainSimilarity || analysis.phishing?.credentialHarvesting) return 'WEB_PHISHING';
  if (analysis.signals.obfuscatedScripts > 2 || analysis.signals.suspiciousScriptDomains.length > 3) return 'WEB_INJECTION';
  if (analysis.signals.trackingPixels > 5 || analysis.signals.externalDomainCount > 15) return 'WEB_TRACKING';
  return 'WEB_PHISHING'; // default for high-score pages
}

export async function dispatchThreatEvent(
  analysis: PageAnalysis, result: ThreatResult, citadelUrl: string, jwt: string
): Promise<void> {
  // Rate limit: 1 event per domain per 10 minutes
  const lastSent = recentDispatches.get(analysis.hostname);
  if (lastSent && Date.now() - lastSent < RATE_LIMIT_MS) return;

  const event = {
    eventId: `ward-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    sourceIp: analysis.hostname,
    sourcePort: 0,
    destIp: '127.0.0.1',
    destPort: 443,
    protocol: 'HTTPS',
    category: detectCategory(analysis),
    subcategory: '',
    confidence: Math.min(result.score / 100, 0.99),
    sourceComponent: 'ward',
  };

  try {
    await fetch(`${citadelUrl}/api/v1/events/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify(event),
    });
    recentDispatches.set(analysis.hostname, Date.now());
  } catch { /* fire-and-forget */ }
}

export async function fetchActiveThreatIps(citadelUrl: string, jwt: string): Promise<string[]> {
  try {
    const resp = await fetch(`${citadelUrl}/api/v1/threats/active`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (resp.ok) {
      const data = await resp.json();
      return Object.keys(data);
    }
  } catch { /* */ }
  return [];
}
