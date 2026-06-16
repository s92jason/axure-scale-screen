import { describe, expect, it } from 'vitest';
import { toProjectKey } from '../../src/shared/projectKey';

describe('toProjectKey', () => {
  it('maps axshare subdomain to a project key', () => {
    expect(toProjectKey('https://abc123.axshare.com/')).toBe('axshare:abc123');
  });

  it('ignores page hash and query on axshare', () => {
    expect(toProjectKey('https://abc123.axshare.com/start.html?foo=1#p=home')).toBe('axshare:abc123');
  });

  it('returns null for axshare root without subdomain', () => {
    expect(toProjectKey('https://axshare.com/')).toBeNull();
  });

  it('ignores non-project labels like www', () => {
    expect(toProjectKey('https://www.axshare.com/')).toBeNull();
  });

  it('maps axure.cloud /app/project/{id} path', () => {
    expect(toProjectKey('https://app.axure.cloud/app/project/xy9z/overview')).toBe('axurecloud:xy9z');
  });

  it('falls back to axure.cloud subdomain when no project path', () => {
    expect(toProjectKey('https://demo7.axure.cloud/home.html')).toBe('axurecloud:demo7');
  });

  it('collapses index.html and start.html to the same file root', () => {
    const a = toProjectKey('file:///Users/jc/proto/index.html');
    const b = toProjectKey('file:///Users/jc/proto/start.html');
    expect(a).toBe('file:/Users/jc/proto');
    expect(b).toBe(a);
  });

  it('decodes percent-encoded file paths', () => {
    expect(toProjectKey('file:///Users/jc/My%20Proto/index.html')).toBe('file:/Users/jc/My Proto');
  });

  it('handles a file folder URL with trailing slash', () => {
    expect(toProjectKey('file:///Users/jc/proto/')).toBe('file:/Users/jc/proto');
  });

  it('returns null for unrelated hosts and invalid input', () => {
    expect(toProjectKey('https://example.com/page')).toBeNull();
    expect(toProjectKey('not-a-url')).toBeNull();
  });
});
