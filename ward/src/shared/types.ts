export interface PhishingSignals {
  domainSimilarity: { target: string; distance: number } | null;
  urgencyLanguage: boolean;
  suspiciousTLD: boolean;
  brandImpersonation: boolean;
  credentialHarvesting: boolean;
}

export interface PageAnalysis {
  url: string;
  hostname: string;
  timestamp: number;
  signals: {
    blocklisted: boolean;
    httpWithLogin: boolean;
    urlObfuscation: boolean;
    crossDomainForms: string[];
    hiddenIframes: number;
    cryptominerPatterns: string[];
    obfuscatedScripts: number;
    suspiciousScriptDomains: string[];
    externalDomainCount: number;
    trackingPixels: number;
  };
  phishing: PhishingSignals;
}

export interface ThreatResult {
  score: number;
  level: 'low' | 'medium' | 'high';
  reasons: string[];
}
