import { describe, expect, it } from 'vitest';
import { toUrlKey } from '../../src/shared/url';

describe('toUrlKey', () => {
  it('removes query and hash', () => {
    expect(toUrlKey('https://example.com/proto/page.html?a=1#section')).toBe(
      'https://example.com/proto/page.html'
    );
  });

  it('returns raw value for invalid URLs', () => {
    expect(toUrlKey('not-a-valid-url')).toBe('not-a-valid-url');
  });
});
