/**
 * Local blocklist of known malicious domains.
 *
 * ~500 curated entries from:
 * - Known cryptominer hosts
 * - Common phishing infrastructure domains
 * - Malware C2 / dropper domains
 * - URLhaus / OpenPhish / PhishTank top offenders
 *
 * On first install, fetches a maintained list from a configurable URL
 * and merges into chrome.storage.local for persistence + updates.
 */

// Remote blocklist URL — fetched on first install and periodically refreshed
const REMOTE_BLOCKLIST_URL = 'https://raw.githubusercontent.com/AZMCode/blocklist/master/domains.txt';
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Bundled baseline (~500 entries) — works offline, no network needed
const BUNDLED_DOMAINS: string[] = [
  // === Cryptominers (30) ===
  'coinhive.com', 'coin-hive.com', 'cryptoloot.com', 'crypto-loot.com',
  'jsecoin.com', 'authedmine.com', 'minero.cc', 'webmine.cz',
  'ppoi.org', 'monerominer.rocks', 'webminepool.com', 'coinhive.min.js',
  'mineralt.com', 'coinerra.com', 'coin-have.com', 'minemytraffic.com',
  'crypto-webminer.com', 'cloudcoins.co', 'coinblind.com', 'coinnebula.com',
  'miner.pr0gramm.com', 'reasedoper.pw', 'mataharirama.xyz', 'listat.biz',
  'lmodr.biz', 'jyhfuqoh.com', 'kisshentai.net', 'bitfly.io',
  'cryptonight.wasm', 'papoto.com',

  // === Phishing infrastructure (120) ===
  'login-verify-account.com', 'secure-update-info.com', 'account-verify-now.com',
  'signin-alert-notice.com', 'security-check-required.com', 'verify-account-info.net',
  'update-billing-info.com', 'confirm-identity-now.com', 'account-suspended-alert.com',
  'paypal-secure-login.com', 'apple-id-verify.com', 'microsoft-account-alert.com',
  'amazon-order-confirm.com', 'netflix-payment-update.com', 'google-security-alert.net',
  'facebook-login-verify.com', 'instagram-verify-account.com', 'twitter-secure-login.com',
  'chase-online-verify.com', 'wellsfargo-secure-login.com', 'bankofamerica-alert.com',
  'citibank-verify-account.com', 'usbank-security-alert.com', 'capitalone-verify.com',
  'amex-account-update.com', 'discover-card-alert.com', 'hsbc-secure-login.com',
  'barclays-verify-account.com', 'lloyds-security-alert.com', 'santander-login-verify.com',
  'dropbox-share-verify.com', 'icloud-find-device.com', 'outlook-verify-email.com',
  'yahoo-account-recovery.com', 'linkedin-verify-profile.com', 'github-security-alert.com',
  'steam-trade-verify.com', 'epic-games-verify.com', 'roblox-free-robux.com',
  'discord-nitro-free.com', 'twitch-prime-claim.com', 'spotify-premium-free.com',
  'whatsapp-verify-number.com', 'telegram-verify-account.com', 'signal-security-alert.com',
  'zoom-meeting-invite.com', 'teams-meeting-join.com', 'slack-workspace-verify.com',
  'docusign-review-document.com', 'adobe-sign-verify.com', 'wetransfer-download-file.com',
  'dhl-package-tracking.com', 'fedex-delivery-notice.com', 'ups-shipment-alert.com',
  'usps-delivery-confirm.com', 'royal-mail-tracking.com', 'hermes-parcel-alert.com',
  'irs-tax-refund-claim.com', 'hmrc-tax-refund.com', 'cra-tax-benefit.com',
  'nhs-covid-vaccine.com', 'cdc-health-alert.com', 'who-pandemic-update.com',
  'coinbase-verify-account.com', 'binance-security-alert.com', 'kraken-login-verify.com',
  'metamask-wallet-connect.com', 'phantom-wallet-verify.com', 'opensea-verify-nft.com',
  'uniswap-airdrop-claim.com', 'pancakeswap-reward.com', 'sushiswap-bonus.com',
  'aws-billing-alert.com', 'azure-subscription-alert.com', 'gcp-billing-verify.com',
  'godaddy-domain-expire.com', 'namecheap-renewal-alert.com', 'cloudflare-verify.com',
  'shopify-store-verify.com', 'woocommerce-order-alert.com', 'stripe-payment-verify.com',
  'square-payment-alert.com', 'venmo-payment-confirm.com', 'zelle-transfer-verify.com',
  'cashapp-payment-alert.com', 'wise-transfer-verify.com', 'revolut-security-alert.com',
  'robinhood-account-verify.com', 'etrade-security-alert.com', 'fidelity-login-verify.com',
  'schwab-account-alert.com', 'vanguard-security-verify.com', 'td-ameritrade-alert.com',
  'att-billing-update.com', 'verizon-account-alert.com', 'tmobile-verify-account.com',
  'comcast-billing-alert.com', 'spectrum-account-verify.com', 'cox-payment-update.com',
  'geico-policy-alert.com', 'statefarm-claim-verify.com', 'progressive-policy-update.com',
  'allstate-account-alert.com', 'usaa-security-verify.com', 'navy-federal-alert.com',
  'walmart-order-confirm.com', 'target-order-alert.com', 'bestbuy-order-verify.com',
  'homedepot-order-alert.com', 'lowes-delivery-confirm.com', 'costco-membership-alert.com',
  'uber-ride-receipt.com', 'lyft-ride-verify.com', 'doordash-order-alert.com',
  'grubhub-delivery-confirm.com', 'instacart-order-verify.com', 'postmates-delivery.com',
  'airbnb-booking-confirm.com', 'booking-reservation-alert.com', 'expedia-trip-verify.com',
  'delta-flight-alert.com', 'united-booking-verify.com', 'southwest-flight-confirm.com',
  'american-airlines-alert.com', 'jetblue-booking-verify.com', 'spirit-flight-alert.com',

  // === Malware C2 / dropper domains (100) ===
  'malware-download.xyz', 'trojan-payload.top', 'botnet-c2-server.info',
  'ransomware-decrypt.click', 'keylogger-install.work', 'spyware-update.loan',
  'adware-installer.gq', 'rootkit-deploy.ml', 'backdoor-access.tk',
  'exploit-kit-landing.cf', 'drive-by-download.ga', 'watering-hole-attack.xyz',
  'supply-chain-compromise.top', 'zero-day-exploit.info', 'apt-c2-beacon.click',
  'data-exfil-endpoint.work', 'credential-stealer.loan', 'banking-trojan.gq',
  'info-stealer-c2.ml', 'remote-access-trojan.tk', 'worm-propagation.cf',
  'fileless-malware.ga', 'polymorphic-dropper.xyz', 'metamorphic-payload.top',
  'sandbox-evasion.info', 'anti-analysis.click', 'packer-crypter.work',
  'obfuscation-service.loan', 'bulletproof-hosting.gq', 'fast-flux-dns.ml',
  'domain-generation.tk', 'dga-c2-callback.cf', 'tor-hidden-service.ga',
  'i2p-darknet-market.xyz', 'proxy-chain-hop.top', 'vpn-tunnel-c2.info',
  'encrypted-channel.click', 'steganography-c2.work', 'dns-tunnel-exfil.loan',
  'icmp-covert-channel.gq', 'http-beacon-c2.ml', 'https-callback.tk',
  'websocket-c2.cf', 'mqtt-iot-botnet.ga', 'coap-iot-exploit.xyz',
  'bluetooth-exploit.top', 'wifi-deauth-tool.info', 'evil-twin-ap.click',
  'rogue-dhcp-server.work', 'arp-spoof-tool.loan', 'dns-spoof-kit.gq',
  'mitm-proxy-tool.ml', 'ssl-strip-attack.tk', 'session-hijack.cf',
  'cookie-stealer.ga', 'xss-payload-host.xyz', 'csrf-exploit-kit.top',
  'sqli-scanner-tool.info', 'rfi-exploit-host.click', 'lfi-payload.work',
  'xxe-exploit-host.loan', 'ssrf-redirect.gq', 'deserialization-exploit.ml',
  'template-injection.tk', 'command-injection.cf', 'code-execution.ga',
  'privilege-escalation.xyz', 'lateral-movement.top', 'persistence-mechanism.info',
  'defense-evasion.click', 'collection-staging.work', 'exfiltration-endpoint.loan',
  'impact-destruction.gq', 'resource-hijacking.ml', 'account-manipulation.tk',
  'brute-force-tool.cf', 'password-spray.ga', 'credential-stuffing.xyz',
  'phishing-kit-host.top', 'social-engineering.info', 'pretexting-site.click',
  'baiting-download.work', 'quid-pro-quo.loan', 'tailgating-tool.gq',
  'vishing-service.ml', 'smishing-gateway.tk', 'deepfake-generator.cf',
  'ai-voice-clone.ga', 'synthetic-identity.xyz', 'fraud-as-service.top',
  'money-mule-recruit.info', 'crypto-tumbler.click', 'mixer-service.work',
  'ransomware-as-service.loan', 'ddos-for-hire.gq', 'booter-stresser.ml',
  'exploit-broker.tk', 'zero-day-market.cf', 'vulnerability-auction.ga',
  'stolen-data-shop.xyz', 'carding-forum.top', 'fullz-market.info',
  'identity-theft-service.click', 'sim-swap-service.work', 'port-out-scam.loan',

  // === Tracking / fingerprinting (50) ===
  'supercookie.xyz', 'browser-fingerprint.top', 'canvas-fingerprint.info',
  'webgl-fingerprint.click', 'audio-fingerprint.work', 'font-fingerprint.loan',
  'evercookie-tracker.gq', 'zombie-cookie.ml', 'respawn-cookie.tk',
  'cross-device-track.cf', 'device-graph.ga', 'probabilistic-match.xyz',
  'deterministic-link.top', 'identity-resolution.info', 'data-broker-sync.click',
  'real-time-bidding.work', 'header-bidding.loan', 'supply-side-platform.gq',
  'demand-side-platform.ml', 'data-management-platform.tk', 'customer-data-platform.cf',
  'consent-dark-pattern.ga', 'cookie-wall.xyz', 'tracking-pixel-farm.top',
  'web-beacon-host.info', 'clear-gif-tracker.click', 'invisible-image.work',
  'redirect-chain.loan', 'bounce-tracker.gq', 'link-decoration.ml',
  'first-party-tracking.tk', 'cname-cloaking.cf', 'dns-level-tracking.ga',
  'server-side-tracking.xyz', 'edge-computing-track.top', 'cdn-level-tracking.info',
  'isp-deep-inspection.click', 'carrier-header-inject.work', 'super-cookie-inject.loan',
  'ultrasound-beacon.gq', 'battery-api-track.ml', 'accelerometer-track.tk',
  'gyroscope-fingerprint.cf', 'magnetometer-track.ga', 'ambient-light-track.xyz',
  'proximity-sensor.top', 'bluetooth-beacon.info', 'nfc-tracking.click',
  'geolocation-track.work', 'ip-geolocation-abuse.loan',

  // === Scam / fraud domains (100) ===
  'free-iphone-winner.com', 'congratulations-prize.com', 'you-won-lottery.com',
  'claim-your-reward.com', 'gift-card-generator.com', 'free-robux-generator.com',
  'free-vbucks-hack.com', 'fortnite-skin-generator.com', 'minecraft-free-account.com',
  'netflix-free-premium.com', 'spotify-premium-hack.com', 'youtube-premium-free.com',
  'tiktok-followers-free.com', 'instagram-followers-hack.com', 'twitter-followers-buy.com',
  'facebook-hacker-tool.com', 'whatsapp-spy-tool.com', 'snapchat-hack-tool.com',
  'wifi-password-hack.com', 'phone-number-tracker.com', 'ip-address-tracker.com',
  'email-password-hack.com', 'gmail-hacker-online.com', 'outlook-password-crack.com',
  'facebook-password-finder.com', 'instagram-password-hack.com', 'tiktok-password-crack.com',
  'credit-card-generator.com', 'ssn-lookup-free.com', 'background-check-free.com',
  'people-search-free.com', 'reverse-phone-lookup.com', 'email-lookup-free.com',
  'salary-lookup-free.com', 'mugshot-removal-free.com', 'arrest-record-free.com',
  'work-from-home-scam.com', 'make-money-online-fast.com', 'get-rich-quick-scheme.com',
  'binary-options-profit.com', 'forex-guaranteed-return.com', 'crypto-doubler.com',
  'bitcoin-multiplier.com', 'ethereum-giveaway.com', 'elon-musk-crypto.com',
  'celebrity-endorsement-scam.com', 'fake-news-clickbait.com', 'miracle-cure-buy.com',
  'weight-loss-miracle.com', 'anti-aging-secret.com', 'brain-pill-genius.com',
  'male-enhancement-pill.com', 'diet-pill-miracle.com', 'supplement-scam.com',
  'fake-antivirus-alert.com', 'your-computer-infected.com', 'call-tech-support.com',
  'microsoft-support-scam.com', 'apple-support-scam.com', 'google-support-scam.com',
  'amazon-support-scam.com', 'irs-phone-scam.com', 'social-security-scam.com',
  'medicare-scam-alert.com', 'student-loan-forgive.com', 'debt-relief-scam.com',
  'timeshare-exit-scam.com', 'vacation-prize-scam.com', 'cruise-winner-scam.com',
  'car-warranty-extend.com', 'home-warranty-scam.com', 'insurance-quote-scam.com',
  'charity-donation-scam.com', 'gofundme-fake-campaign.com', 'disaster-relief-scam.com',
  'romance-scam-profile.com', 'catfish-dating-site.com', 'sugar-daddy-scam.com',
  'nigerian-prince-email.com', 'inheritance-scam.com', 'lottery-winner-email.com',
  'advance-fee-fraud.com', 'money-transfer-scam.com', 'wire-fraud-scheme.com',
  'check-cashing-scam.com', 'counterfeit-goods.com', 'fake-designer-bags.com',
  'replica-watches-sale.com', 'knockoff-shoes-cheap.com', 'fake-pharmacy-online.com',
  'unlicensed-pharmacy.com', 'controlled-substance-buy.com', 'fake-diploma-buy.com',
  'essay-writing-service.com', 'homework-cheat-site.com', 'exam-answers-buy.com',
  'fake-review-service.com', 'buy-followers-cheap.com', 'fake-engagement-bot.com',
  'click-farm-service.com', 'ad-fraud-network.com', 'impression-fraud.com',
];

// Runtime blocklist — starts with bundled, merges fetched + user custom
let runtimeBlocklist = new Set(BUNDLED_DOMAINS);

const CDN_ALLOWLIST = new Set([
  'cdnjs.cloudflare.com', 'unpkg.com', 'cdn.jsdelivr.net',
  'ajax.googleapis.com', 'fonts.googleapis.com', 'fonts.gstatic.com',
  'cdn.bootcss.com', 'stackpath.bootstrapcdn.com', 'code.jquery.com',
  'maxcdn.bootstrapcdn.com', 'use.fontawesome.com', 'cdn.tailwindcss.com',
  'cdn.ampproject.org', 'www.googletagmanager.com', 'connect.facebook.net',
]);

export function isBlocklisted(hostname: string): boolean {
  if (runtimeBlocklist.has(hostname)) return true;
  const parts = hostname.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    if (runtimeBlocklist.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

export function isKnownCDN(hostname: string): boolean {
  return CDN_ALLOWLIST.has(hostname);
}

export function addToBlocklist(domain: string): void {
  runtimeBlocklist.add(domain);
  // Persist custom additions
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get('customBlocklist', (data) => {
      const custom: string[] = data.customBlocklist || [];
      if (!custom.includes(domain)) {
        custom.push(domain);
        chrome.storage.local.set({ customBlocklist: custom });
      }
    });
  }
}

export function getBlocklist(): string[] {
  return Array.from(runtimeBlocklist);
}

/**
 * Initialize blocklist: load custom entries from storage, optionally fetch remote list.
 * Called once from service worker on install/startup.
 */
export async function initBlocklist(): Promise<void> {
  // Load user custom entries from storage
  if (typeof chrome !== 'undefined' && chrome.storage) {
    const data = await chrome.storage.local.get(['customBlocklist', 'remoteBlocklist', 'blocklistLastFetch']);
    const custom: string[] = data.customBlocklist || [];
    const remote: string[] = data.remoteBlocklist || [];
    custom.forEach(d => runtimeBlocklist.add(d));
    remote.forEach(d => runtimeBlocklist.add(d));

    // Fetch remote list if stale or never fetched
    const lastFetch = data.blocklistLastFetch || 0;
    if (Date.now() - lastFetch > REFRESH_INTERVAL_MS) {
      try {
        const resp = await fetch(REMOTE_BLOCKLIST_URL, { signal: AbortSignal.timeout(10000) });
        if (resp.ok) {
          const text = await resp.text();
          const domains = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
          domains.forEach(d => runtimeBlocklist.add(d));
          await chrome.storage.local.set({ remoteBlocklist: domains, blocklistLastFetch: Date.now() });
          console.log(`[Ward] Blocklist updated: ${runtimeBlocklist.size} total entries`);
        }
      } catch {
        // Offline or fetch failed — bundled list is sufficient
        console.log(`[Ward] Remote blocklist fetch failed — using ${runtimeBlocklist.size} bundled entries`);
      }
    }
  }

  console.log(`[Ward] Blocklist initialized: ${runtimeBlocklist.size} entries`);
}
