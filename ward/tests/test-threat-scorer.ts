import { computeThreatScore } from '../src/shared/threat-scorer';
import type { PageAnalysis } from '../src/shared/types';

function cleanAnalysis(): PageAnalysis {
  return {
    url: 'https://example.com',
    hostname: 'example.com',
    timestamp: Date.now(),
    signals: {
      blocklisted: false, httpWithLogin: false, urlObfuscation: false,
      crossDomainForms: [], hiddenIframes: 0, cryptominerPatterns: [],
      obfuscatedScripts: 0, suspiciousScriptDomains: [], externalDomainCount: 3, trackingPixels: 0,
    },
    phishing: {
      domainSimilarity: null, urgencyLanguage: false, suspiciousTLD: false,
      brandImpersonation: false, credentialHarvesting: false,
    },
  };
}

describe('computeThreatScore', () => {
  test('clean page → score 0', () => {
    const result = computeThreatScore(cleanAnalysis());
    expect(result.score).toBe(0);
    expect(result.level).toBe('low');
    expect(result.reasons).toHaveLength(0);
  });

  test('blocklisted domain → score 100', () => {
    const a = cleanAnalysis();
    a.signals.blocklisted = true;
    const result = computeThreatScore(a);
    expect(result.score).toBe(100);
    expect(result.level).toBe('high');
  });

  test('phishing signals combine', () => {
    const a = cleanAnalysis();
    a.phishing.domainSimilarity = { target: 'paypal.com', distance: 1 };
    a.phishing.urgencyLanguage = true;
    const result = computeThreatScore(a);
    expect(result.score).toBe(55); // 40 + 15
    expect(result.level).toBe('medium');
  });

  test('score capped at 100', () => {
    const a = cleanAnalysis();
    a.signals.blocklisted = true;
    a.signals.cryptominerPatterns = ['coinhive'];
    a.phishing.credentialHarvesting = true;
    const result = computeThreatScore(a);
    expect(result.score).toBe(100);
  });

  test('reasons list generated', () => {
    const a = cleanAnalysis();
    a.signals.hiddenIframes = 2;
    a.signals.crossDomainForms = ['evil.com'];
    const result = computeThreatScore(a);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons.some(r => r.includes('hidden iframe'))).toBe(true);
  });
});
