import { describe, expect, it } from 'vitest';
import { toNetscapeBookmarks } from '../../src/shared/netscape';
import type { AxureBookmark } from '../../src/shared/types';

function bm(partial: Partial<AxureBookmark>): AxureBookmark {
  return {
    projectKey: 'axshare:a',
    url: 'https://a.axshare.com/',
    name: 'Demo',
    folder: '',
    createdAt: 1_700_000_000_000,
    lastVisitedAt: null,
    visitCount: 0,
    ...partial
  };
}

describe('toNetscapeBookmarks', () => {
  it('emits a valid Netscape header and closing list', () => {
    const out = toNetscapeBookmarks([]);
    expect(out.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>')).toBe(true);
    expect(out).toContain('<DL><p>');
    expect(out.trimEnd().endsWith('</DL><p>')).toBe(true);
  });

  it('renders an anchor with href, name and ADD_DATE in seconds', () => {
    const out = toNetscapeBookmarks([bm({ name: 'Hello', url: 'https://x.axshare.com/' })]);
    expect(out).toContain('<A HREF="https://x.axshare.com/" ADD_DATE="1700000000">Hello</A>');
  });

  it('groups by folder under H3 and keeps ungrouped at top level', () => {
    const out = toNetscapeBookmarks([
      bm({ name: 'Top', folder: '' }),
      bm({ name: 'Inside', folder: 'WIP' })
    ]);
    expect(out).toContain('<H3>WIP</H3>');
    const topIndex = out.indexOf('Top');
    const h3Index = out.indexOf('<H3>WIP</H3>');
    expect(topIndex).toBeLessThan(h3Index); // 未分組在前
  });

  it('escapes HTML in names and urls', () => {
    const out = toNetscapeBookmarks([bm({ name: 'A & <b>', url: 'https://x/?q="1"&y=2' })]);
    expect(out).toContain('A &amp; &lt;b&gt;');
    expect(out).toContain('&quot;1&quot;&amp;y=2');
    expect(out).not.toContain('<b>');
  });
});
