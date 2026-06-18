import { describe, expect, it } from 'vitest';
import { toEntryUrl, toUrlKey } from '../../src/shared/url';

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

describe('toEntryUrl', () => {
  it('drops the volatile Axure page hash, keeping the project entry', () => {
    expect(toEntryUrl('https://abc123.axshare.com/#id=xyz&p=home&g=1')).toBe('https://abc123.axshare.com/');
  });

  it('drops the hash on a start.html entry', () => {
    expect(toEntryUrl('https://abc123.axshare.com/start.html#p=checkout')).toBe(
      'https://abc123.axshare.com/start.html'
    );
  });

  it('keeps the query string (may carry an access code)', () => {
    expect(toEntryUrl('https://abc123.axshare.com/?code=secret#p=home')).toBe(
      'https://abc123.axshare.com/?code=secret'
    );
  });

  it('handles file:// exports without breaking the path', () => {
    expect(toEntryUrl('file:///Users/jc/proto/start.html#p=home')).toBe('file:///Users/jc/proto/start.html');
  });

  it('returns raw value for invalid URLs', () => {
    expect(toEntryUrl('not-a-valid-url')).toBe('not-a-valid-url');
  });
});
