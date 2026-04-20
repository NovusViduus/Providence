import type { GeoThreat } from '../types/events';

// Category color mapping: desaturated, instrument-reading palette
export const CATEGORY_COLORS: Record<string, number> = {
  DOS: 0xD64045,
  BRUTE_FORCE: 0xB85C2F,
  PROBE: 0xCC8B17,
  INJECTION: 0x4A7AB5,
  EXFILTRATION: 0x8DB600,
  AI_AGENT: 0x0A9396,
  BENIGN: 0x3A9D68,
  IAM_ESCALATION: 0xCC8B17,
  RESOURCE_ABUSE: 0xC73E1D,
  DATA_EXPOSURE: 0x7B4F9D,
  WEB_PHISHING: 0xB85C2F,
  WEB_CRYPTOMINER: 0xC73E1D,
  WEB_INJECTION: 0x4A7AB5,
  WEB_TRACKING: 0x4D5B6A,
};

export function getCategoryColor(category: string): number {
  return CATEGORY_COLORS[category] ?? 0x4D5B6A;
}

export function getCategoryHex(category: string): string {
  return '#' + (CATEGORY_COLORS[category] ?? 0x4D5B6A).toString(16).padStart(6, '0');
}
