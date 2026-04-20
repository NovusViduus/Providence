import { isBlocklisted, isKnownCDN } from '../src/shared/blocklist';

describe('blocklist', () => {
  test('known cryptominer domain blocked', () => {
    expect(isBlocklisted('coinhive.com')).toBe(true);
  });

  test('subdomain of blocked domain blocked', () => {
    expect(isBlocklisted('ws.coinhive.com')).toBe(true);
  });

  test('clean domain not blocked', () => {
    expect(isBlocklisted('example.com')).toBe(false);
  });

  test('google.com not blocked', () => {
    expect(isBlocklisted('google.com')).toBe(false);
  });
});

describe('CDN allowlist', () => {
  test('known CDN allowed', () => {
    expect(isKnownCDN('cdnjs.cloudflare.com')).toBe(true);
    expect(isKnownCDN('cdn.jsdelivr.net')).toBe(true);
  });

  test('unknown domain not on CDN list', () => {
    expect(isKnownCDN('evil-scripts.com')).toBe(false);
  });
});
