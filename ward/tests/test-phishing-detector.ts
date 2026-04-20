import { levenshtein, detectPhishing } from '../src/content/phishing-detector';

describe('levenshtein', () => {
  test('identical strings → 0', () => {
    expect(levenshtein('google', 'google')).toBe(0);
  });

  test('one substitution → 1', () => {
    expect(levenshtein('paypal', 'paypai')).toBe(1);
  });

  test('two substitutions → 2', () => {
    expect(levenshtein('amazon', 'arnazon')).toBeLessThanOrEqual(2);
  });

  test('completely different → high distance', () => {
    expect(levenshtein('google', 'facebook')).toBeGreaterThan(4);
  });
});

describe('detectPhishing', () => {
  test('paypai.com flagged as similar to paypal.com', () => {
    const result = detectPhishing('paypai.com', '');
    expect(result.domainSimilarity).not.toBeNull();
    expect(result.domainSimilarity?.target).toBe('paypal.com');
    expect(result.domainSimilarity?.distance).toBe(1);
  });

  test('google.com exact match not flagged', () => {
    const result = detectPhishing('google.com', '');
    expect(result.domainSimilarity).toBeNull();
  });

  test('urgency language detected', () => {
    const result = detectPhishing('random.xyz', 'Your account has been suspended. Verify your identity immediately.');
    expect(result.urgencyLanguage).toBe(true);
  });

  test('no urgency on normal text', () => {
    const result = detectPhishing('example.com', 'Welcome to our website. Browse our products.');
    expect(result.urgencyLanguage).toBe(false);
  });

  test('suspicious TLD detected', () => {
    const result = detectPhishing('random-site.xyz', '');
    expect(result.suspiciousTLD).toBe(true);
  });

  test('.com not suspicious', () => {
    const result = detectPhishing('example.com', '');
    expect(result.suspiciousTLD).toBe(false);
  });
});
