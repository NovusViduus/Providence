/**
 * Computes a 0-100 threat score from PageAnalysis signals.
 */

import type { PageAnalysis, ThreatResult } from './types';

export function computeThreatScore(analysis: PageAnalysis): ThreatResult {
  let score = 0;
  const reasons: string[] = [];

  // URL signals
  if (analysis.signals.blocklisted) { score += 100; reasons.push('Domain is on blocklist'); }
  if (analysis.signals.httpWithLogin) { score += 30; reasons.push('Login form on unencrypted HTTP page'); }
  if (analysis.signals.urlObfuscation) { score += 25; reasons.push('URL contains obfuscation patterns'); }

  // Phishing signals
  const ph = analysis.phishing;
  if (ph?.domainSimilarity && ph.domainSimilarity.distance <= 2) {
    score += 40;
    reasons.push(`Domain similar to ${ph.domainSimilarity.target} (distance: ${ph.domainSimilarity.distance})`);
  }
  if (ph?.urgencyLanguage) { score += 15; reasons.push('Page contains urgency/scare language'); }
  if (ph?.credentialHarvesting) { score += 35; reasons.push('Credential harvesting: login form on suspicious domain'); }
  if (ph?.brandImpersonation) { score += 30; reasons.push('Possible brand impersonation detected'); }
  if (ph?.suspiciousTLD) { score += 10; reasons.push('Suspicious top-level domain'); }

  // Script signals
  if (analysis.signals.cryptominerPatterns.length > 0) {
    score += 50;
    reasons.push(`Cryptominer detected: ${analysis.signals.cryptominerPatterns[0]}`);
  }
  if (analysis.signals.obfuscatedScripts > 2) { score += 20; reasons.push('Multiple obfuscated scripts detected'); }
  const suspScripts = analysis.signals.suspiciousScriptDomains.length;
  if (suspScripts > 0) {
    score += Math.min(suspScripts * 5, 25);
    reasons.push(`${suspScripts} scripts from unknown domains`);
  }

  // DOM signals
  if (analysis.signals.hiddenIframes > 0) { score += 15; reasons.push(`${analysis.signals.hiddenIframes} hidden iframe(s) detected`); }
  if (analysis.signals.crossDomainForms.length > 0) {
    score += 25;
    reasons.push(`Form submits to external domain: ${analysis.signals.crossDomainForms[0]}`);
  }
  if (analysis.signals.trackingPixels > 5) { score += 10; reasons.push(`${analysis.signals.trackingPixels} tracking pixels detected`); }

  const finalScore = Math.min(score, 100);
  return {
    score: finalScore,
    level: finalScore >= 70 ? 'high' : finalScore >= 30 ? 'medium' : 'low',
    reasons,
  };
}
