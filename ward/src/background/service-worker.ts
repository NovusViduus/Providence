/**
 * Service worker — background processing for Providence Ward.
 * Receives PageAnalysis from content scripts, computes threat scores,
 * updates badge, and optionally dispatches to Citadel.
 */

import type { PageAnalysis, ThreatResult } from '../shared/types';
import { computeThreatScore } from '../shared/threat-scorer';
import { dispatchThreatEvent, fetchActiveThreatIps } from '../shared/api-client';
import { initBlocklist } from '../shared/blocklist';

// Initialize blocklist on service worker startup
initBlocklist();

const tabResults = new Map<number, ThreatResult & { analysis: PageAnalysis }>();
let threatIps: string[] = [];

// Refresh threat IPs every 5 minutes when connected
chrome.alarms.create('refreshThreatIps', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'refreshThreatIps') return;
  const settings = await chrome.storage.local.get(['citadelUrl', 'citadelJwt', 'connected']);
  if (settings.connected && settings.citadelUrl && settings.citadelJwt) {
    threatIps = await fetchActiveThreatIps(settings.citadelUrl, settings.citadelJwt);
  }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'PAGE_ANALYSIS' || !sender.tab?.id) return;

  const analysis: PageAnalysis = msg.data;
  const result = computeThreatScore(analysis);
  const tabId = sender.tab.id;

  // Boost score if page loads resources from known threat IPs
  if (threatIps.length > 0) {
    const loadsThreatIp = analysis.signals.suspiciousScriptDomains.some(d => threatIps.includes(d));
    if (loadsThreatIp && result.score < 100) {
      result.score = Math.min(result.score + 15, 100);
      result.reasons.push('Page loads resources from a known threat IP');
      result.level = result.score >= 70 ? 'high' : result.score >= 30 ? 'medium' : 'low';
    }
  }

  tabResults.set(tabId, { ...result, analysis });
  updateBadge(tabId, result);

  // Store for popup
  chrome.storage.session.set({ [`tab_${tabId}`]: { ...result, url: analysis.url, hostname: analysis.hostname } });

  // Update history
  chrome.storage.session.get('history', (data) => {
    const history = (data.history || []).slice(0, 19);
    history.unshift({ url: analysis.url, hostname: analysis.hostname, score: result.score, level: result.level, timestamp: Date.now() });
    chrome.storage.session.set({ history });
  });

  // Warning banner for high-threat pages
  if (result.score >= 70) {
    chrome.tabs.sendMessage(tabId, { type: 'SHOW_WARNING', reasons: result.reasons });
  }

  // Connected mode: dispatch to Citadel
  chrome.storage.local.get(['citadelUrl', 'citadelJwt', 'connected'], (settings) => {
    if (settings.connected && settings.citadelUrl && settings.citadelJwt && result.score >= 30) {
      dispatchThreatEvent(analysis, result, settings.citadelUrl, settings.citadelJwt);
    }
  });
});

// Update badge on tab switch
chrome.tabs.onActivated.addListener(({ tabId }) => {
  const entry = tabResults.get(tabId);
  if (entry) updateBadge(tabId, entry);
  else clearBadge(tabId);
});

// Clean up on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  tabResults.delete(tabId);
  chrome.storage.session.remove(`tab_${tabId}`);
});

function updateBadge(tabId: number, result: ThreatResult) {
  const color = result.level === 'high' ? '#d32f2f' : result.level === 'medium' ? '#ffd600' : '#4caf50';
  const text = result.level === 'high' ? '⚠' : result.level === 'medium' ? '!' : '';
  chrome.action.setBadgeBackgroundColor({ tabId, color });
  chrome.action.setBadgeText({ tabId, text });
}

function clearBadge(tabId: number) {
  chrome.action.setBadgeText({ tabId, text: '' });
}
