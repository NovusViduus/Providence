import type { SecurityEvent } from '../types/events';

/** Correct tier for display, handles stale data where BENIGN was mis-tagged */
export function displayTier(event: Pick<SecurityEvent, 'category' | 'responseTier'>): string {
  if (event.category === 'BENIGN') return 'OBSERVE';
  return event.responseTier;
}
