import { describe, expect, it } from 'vitest';
import { COMPLETED_FOLDER } from '../../src/shared/constants';
import { findCompletedAxureTabs } from '../../src/shared/tab-cleanup';
import type { AxureBookmark } from '../../src/shared/types';

function bookmark(projectKey: string, folder = COMPLETED_FOLDER): AxureBookmark {
  return {
    projectKey,
    folder,
    name: `專案 ${projectKey}`,
    url: 'https://demo.axshare.com/',
    createdAt: 1,
    lastVisitedAt: null,
    visitCount: 0
  };
}

describe('findCompletedAxureTabs', () => {
  it('matches AxShare projects across pages, query strings, hashes and protocol', () => {
    const tabs = [
      { id: 1, url: 'https://DEMO.axshare.com/start.html?token=a#p=首頁', title: '首頁' },
      { id: 2, url: 'http://demo.axshare.com/details.html#p=其他頁' }
    ];
    const matches = findCompletedAxureTabs(tabs, [bookmark('axshare:demo')]);
    expect(matches).toEqual([
      {
        tabId: 1,
        projectKey: 'axshare:demo',
        name: '專案 axshare:demo',
        url: tabs[0].url,
        title: '首頁'
      },
      {
        tabId: 2,
        projectKey: 'axshare:demo',
        name: '專案 axshare:demo',
        url: tabs[1].url,
        title: ''
      }
    ]);
  });

  it('matches Axure Cloud project routes and local project folders', () => {
    const tabs = [
      { id: 1, url: 'https://app.axure.cloud/app/project/cloud-id/page/7?access=code#p=首頁' },
      { id: 2, url: 'file:///Users/me/Axure%20Demo/detail.html#p=頁面' },
      { id: 3, url: 'file:///Users/me/Other/detail.html' }
    ];
    const matches = findCompletedAxureTabs(tabs, [bookmark('axurecloud:cloud-id'), bookmark('file:/Users/me/Axure Demo')]);
    expect(matches.map((tab) => tab.tabId)).toEqual([1, 2]);
  });

  it('only suggests bookmarks in the fixed completed group', () => {
    const tabs = [
      { id: 1, url: 'https://done.axshare.com/' },
      { id: 2, url: 'https://active.axshare.com/' },
      { id: 3, url: 'https://ungrouped.axshare.com/' },
      { id: 4, url: 'https://unknown.axshare.com/' },
      { id: 5, url: 'https://example.com/' }
    ];
    const matches = findCompletedAxureTabs(tabs, [
      bookmark('axshare:done'),
      bookmark('axshare:active', '進行中'),
      bookmark('axshare:ungrouped', '')
    ]);
    expect(matches.map((tab) => tab.tabId)).toEqual([1]);
  });

  it('includes every duplicate tab for the same completed project', () => {
    const matches = findCompletedAxureTabs(
      [{ id: 7, url: 'https://demo.axshare.com/' }, { id: 8, url: 'https://demo.axshare.com/' }],
      [bookmark('axshare:demo')]
    );
    expect(matches.map((tab) => tab.tabId)).toEqual([7, 8]);
  });

  it('uses pending navigation to avoid suggesting a tab leaving a completed project', () => {
    const tabs = [
      { id: 1, url: 'https://done.axshare.com/', pendingUrl: 'https://active.axshare.com/' },
      { id: 2, url: 'https://active.axshare.com/', pendingUrl: 'https://done.axshare.com/other.html' }
    ];
    const matches = findCompletedAxureTabs(tabs, [bookmark('axshare:done')]);
    expect(matches.map((tab) => tab.tabId)).toEqual([2]);
    expect(matches[0].url).toBe(tabs[1].pendingUrl);
  });

  it('skips unavailable URLs, missing IDs and malformed URLs without interrupting valid matches', () => {
    const tabs = [
      { id: 1 },
      { url: 'https://demo.axshare.com/' },
      { id: -1, url: 'https://demo.axshare.com/' },
      { id: 1.5, url: 'https://demo.axshare.com/' },
      { id: 3, url: 'not a URL' },
      { id: 4, url: 'file:///Users/me/%E0%A4%A/index.html' },
      { id: 5, url: 'https://demo.axshare.com/' }
    ];
    expect(findCompletedAxureTabs(tabs, [bookmark('axshare:demo')]).map((tab) => tab.tabId)).toEqual([5]);
  });
});
