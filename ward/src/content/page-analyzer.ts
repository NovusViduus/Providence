/**
 * Content script — runs on every page at document_idle.
 * Analyzes URL, DOM, scripts, and resources for threat signals.
 */

import type { PageAnalysis } from '../shared/types';
import { isBlocklisted, isKnownCDN } from '../shared/blocklist';
import { detectPhishing } from './phishing-detector';

const CRYPTOMINER_HOSTS = ['coinhive.com', 'coin-hive.com', 'cryptoloot.com', 'authedmine.com', 'jsecoin.com', 'minero.cc'];

function analyzePage(): PageAnalysis {
  const hostname = location.hostname;
  const isHTTP = location.protocol === 'http:';

  // URL obfuscation
  const urlObfuscation = /\d+\.\d+\.\d+\.\d+/.test(hostname) ||
    hostname.split('.').length > 4 ||
    /%[0-9a-f]{2}/i.test(location.href);

  // Forms
  const forms = document.querySelectorAll('form');
  const crossDomainForms: string[] = [];
  forms.forEach(f => {
    const action = f.getAttribute('action');
    if (action) {
      try {
        const actionHost = new URL(action, location.href).hostname;
        if (actionHost !== hostname) crossDomainForms.push(actionHost);
      } catch { /* invalid URL */ }
    }
  });

  const hasLoginForm = document.querySelectorAll('input[type="password"]').length > 0;

  // Hidden iframes
  let hiddenIframes = 0;
  document.querySelectorAll('iframe').forEach(iframe => {
    const style = getComputedStyle(iframe);
    if (style.display === 'none' || style.visibility === 'hidden' ||
        style.opacity === '0' || iframe.width === '0' || iframe.height === '0') {
      hiddenIframes++;
    }
  });

  // Script analysis
  const cryptominerPatterns: string[] = [];
  const suspiciousScriptDomains: string[] = [];
  let obfuscatedScripts = 0;

  document.querySelectorAll('script').forEach(script => {
    const src = script.getAttribute('src');
    if (src) {
      try {
        const scriptHost = new URL(src, location.href).hostname;
        if (CRYPTOMINER_HOSTS.some(h => scriptHost.includes(h))) {
          cryptominerPatterns.push(`Cryptominer host: ${scriptHost}`);
        }
        if (scriptHost !== hostname && !isKnownCDN(scriptHost)) {
          suspiciousScriptDomains.push(scriptHost);
        }
      } catch { /* invalid URL */ }
    }

    const content = script.textContent || '';
    if (content.length > 100) {
      const evalCount = (content.match(/\beval\s*\(/g) || []).length;
      const fromCharCode = (content.match(/String\.fromCharCode/g) || []).length;
      if (evalCount > 2 || fromCharCode > 3) obfuscatedScripts++;
    }
  });

  // External domains
  const externalDomains = new Set<string>();
  document.querySelectorAll('script[src], img[src], iframe[src], link[href]').forEach(el => {
    const attr = el.getAttribute('src') || el.getAttribute('href');
    if (attr) {
      try {
        const host = new URL(attr, location.href).hostname;
        if (host !== hostname) externalDomains.add(host);
      } catch { /* */ }
    }
  });

  // Tracking pixels
  let trackingPixels = 0;
  document.querySelectorAll('img').forEach(img => {
    if ((img.naturalWidth <= 1 && img.naturalHeight <= 1) || img.width <= 1 || img.height <= 1) {
      try {
        const imgHost = new URL(img.src, location.href).hostname;
        if (imgHost !== hostname) trackingPixels++;
      } catch { /* */ }
    }
  });

  // Phishing detection
  const pageText = document.body?.innerText || '';
  const phishing = detectPhishing(hostname, pageText);

  const analysis: PageAnalysis = {
    url: location.href,
    hostname,
    timestamp: Date.now(),
    signals: {
      blocklisted: isBlocklisted(hostname),
      httpWithLogin: isHTTP && hasLoginForm,
      urlObfuscation,
      crossDomainForms,
      hiddenIframes,
      cryptominerPatterns,
      obfuscatedScripts,
      suspiciousScriptDomains,
      externalDomainCount: externalDomains.size,
      trackingPixels,
    },
    phishing,
  };

  // Send to service worker
  try {
    chrome.runtime.sendMessage({ type: 'PAGE_ANALYSIS', data: analysis });
  } catch { /* extension context invalidated */ }

  // Listen for warning banner injection
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SHOW_WARNING') {
      injectWarningBanner(msg.reasons);
    }
  });

  return analysis;
}

function injectWarningBanner(reasons: string[]) {
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      .ward-banner { position:fixed; top:0; left:0; right:0; z-index:2147483647;
        background:#d32f2f; color:white; padding:12px 20px; font:14px/1.4 -apple-system,sans-serif;
        display:flex; align-items:center; justify-content:space-between; }
      .ward-banner button { background:rgba(255,255,255,0.2); border:none; color:white;
        padding:4px 12px; border-radius:4px; cursor:pointer; font-size:13px; }
    </style>
    <div class="ward-banner">
      <span>⚠ Providence Ward: This page may be dangerous — ${reasons[0] || 'Multiple threat signals detected'}</span>
      <button id="ward-dismiss">Dismiss</button>
    </div>
  `;
  document.body.prepend(host);
  shadow.getElementById('ward-dismiss')?.addEventListener('click', () => host.remove());
}

// Run analysis
analyzePage();
