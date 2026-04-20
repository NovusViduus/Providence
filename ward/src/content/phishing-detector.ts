/**
 * Phishing detection heuristics.
 */

import type { PhishingSignals } from '../shared/types';

const HIGH_VALUE_TARGETS = [
  'google.com', 'facebook.com', 'amazon.com', 'paypal.com', 'microsoft.com',
  'apple.com', 'bankofamerica.com', 'chase.com', 'wellsfargo.com',
  'netflix.com', 'instagram.com', 'twitter.com', 'linkedin.com',
  'dropbox.com', 'github.com', 'outlook.com', 'yahoo.com',
];

const URGENCY_PATTERNS = [
  /your account has been (suspended|locked|compromised)/i,
  /verify your (identity|account|email) (immediately|now)/i,
  /act now/i, /your payment was declined/i,
  /unusual activity detected/i, /unauthorized (access|login)/i,
  /confirm your (password|credentials)/i, /account will be (closed|terminated)/i,
];

const SUSPICIOUS_TLDS = new Set(['.xyz', '.top', '.info', '.click', '.loan', '.work', '.gq', '.ml', '.tk', '.cf', '.ga']);

export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

export function detectPhishing(hostname: string, pageText: string): PhishingSignals {
  // Domain similarity
  let closest: { target: string; distance: number } | null = null;
  const baseDomain = hostname.replace(/^www\./, '');
  for (const target of HIGH_VALUE_TARGETS) {
    if (baseDomain === target) { closest = null; break; } // exact match = safe
    const dist = levenshtein(baseDomain, target);
    if (dist <= 2 && (!closest || dist < closest.distance)) {
      closest = { target, distance: dist };
    }
  }

  // Urgency language
  const urgency = URGENCY_PATTERNS.some(p => p.test(pageText));

  // Suspicious TLD
  const tld = '.' + hostname.split('.').pop();
  const suspiciousTLD = SUSPICIOUS_TLDS.has(tld);

  // Brand impersonation: page mentions a high-value brand but hostname doesn't match
  const textLower = pageText.toLowerCase();
  const brand = HIGH_VALUE_TARGETS.some(t => {
    const name = t.split('.')[0];
    return textLower.includes(name) && !hostname.includes(name);
  });

  // Credential harvesting: login form on non-matching domain
  const hasForms = typeof document !== 'undefined' && document.querySelectorAll('input[type="password"]').length > 0;
  const credentialHarvesting = hasForms && (closest !== null || suspiciousTLD);

  return {
    domainSimilarity: closest,
    urgencyLanguage: urgency,
    suspiciousTLD,
    brandImpersonation: brand,
    credentialHarvesting,
  };
}
