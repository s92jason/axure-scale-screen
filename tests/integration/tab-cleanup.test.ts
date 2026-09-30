import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeCompletedTabs, getCompletedTabs } from '../../src/background/tab-cleanup';
import { addBookmark, setFolder } from '../../src/shared/bookmarkStore';
import { COMPLETED_FOLDER } from '../../src/shared/constants';
import type { AxureTabCandidate } from '../../src/shared/tab-cleanup';

interface TestTab extends AxureTabCandidate {
  windowId?: number;
}

function installBrowser(tabs: TestTab[] = []) {
  const data: Record<string, unknown> = {};
  const state = { tabs };
  const runtime: { lastError: { message: string } | undefined } = { lastError: undefined };
  const query = vi.fn((_info: chrome.tabs.QueryInfo, callback: (tabs: TestTab[]) => void) => callback([...state.tabs]));
  const remove = vi.fn((id: number, callback: () => void) => {
    state.tabs = state.tabs.filter((tab) => tab.id !== id);
    callback();
  });
  vi.stubGlobal('chrome', {
    runtime,
    tabs: { query, remove },
    storage: {
      local: {
        get: (key: string, callback: (result: Record<string, unknown>) => void) => callback({ [key]: data[key] }),
        set: (items: Record<string, unknown>, callback: () => void) => {
          Object.assign(data, items);
          callback();
        }
      }
    }
  });
  return { state, runtime, query, remove };
}

async function saveCompletedProject(id = 'done'): Promise<void> {
  await addBookmark({
    projectKey: `axshare:${id}`,
    name: `專案 ${id}`,
    url: `https://${id}.axshare.com/`,
    folder: COMPLETED_FOLDER
  });
}

describe('completed Axure tab cleanup', () => {
  beforeEach(() => {
    installBrowser();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('previews completed project tabs across all windows without closing any', async () => {
    const browser = installBrowser([
      { id: 1, windowId: 1, url: 'https://done.axshare.com/start.html#p=首頁' },
      { id: 2, windowId: 2, url: 'https://done.axshare.com/detail.html?x=1' },
      { id: 3, windowId: 2, url: 'https://active.axshare.com/' }
    ]);
    await saveCompletedProject();
    expect((await getCompletedTabs()).map((tab) => tab.tabId)).toEqual([1, 2]);
    expect(browser.query).toHaveBeenCalledWith({}, expect.any(Function));
    expect(browser.remove).not.toHaveBeenCalled();
  });

  it('closes only requested completed tabs and deduplicates IDs', async () => {
    const browser = installBrowser([
      { id: 1, url: 'https://done.axshare.com/' },
      { id: 2, url: 'https://done.axshare.com/other.html' },
      { id: 3, url: 'https://example.com/' }
    ]);
    await saveCompletedProject();
    const response = await closeCompletedTabs([1, 1, 3, 999]);
    expect(response).toMatchObject({ ok: true, closedCount: 1 });
    expect(response.completedTabs?.map((tab) => tab.tabId)).toEqual([2]);
    expect(browser.remove.mock.calls.map(([id]) => id)).toEqual([1]);
    expect(browser.state.tabs.map((tab) => tab.id)).toEqual([2, 3]);
  });

  it('closes every duplicate of a project when all preview IDs are requested', async () => {
    const browser = installBrowser([
      { id: 1, url: 'https://done.axshare.com/' },
      { id: 2, url: 'https://done.axshare.com/other.html' }
    ]);
    await saveCompletedProject();
    expect(await closeCompletedTabs([1, 2])).toEqual({ ok: true, closedCount: 2, completedTabs: [] });
    expect(browser.state.tabs).toEqual([]);
  });

  it('keeps tabs that navigated or whose project left completed after preview', async () => {
    const browser = installBrowser([
      { id: 1, url: 'https://done.axshare.com/' },
      { id: 2, url: 'https://other.axshare.com/' }
    ]);
    await saveCompletedProject();
    await saveCompletedProject('other');
    const preview = await getCompletedTabs();
    browser.state.tabs[0].pendingUrl = 'https://active.axshare.com/';
    await setFolder('axshare:other', '進行中');
    expect(await closeCompletedTabs(preview.map((tab) => tab.tabId))).toEqual({ ok: true, closedCount: 0, completedTabs: [] });
    expect(browser.remove).not.toHaveBeenCalled();
  });

  it('revalidates remaining tabs when navigation happens during cleanup', async () => {
    const browser = installBrowser([
      { id: 1, url: 'https://done.axshare.com/' },
      { id: 2, url: 'https://done.axshare.com/other.html' }
    ]);
    await saveCompletedProject();
    browser.remove.mockImplementation((id, callback) => {
      browser.state.tabs = browser.state.tabs.filter((tab) => tab.id !== id);
      browser.state.tabs[0].url = 'https://active.axshare.com/';
      callback();
    });
    expect(await closeCompletedTabs([1, 2])).toEqual({ ok: true, closedCount: 1, completedTabs: [] });
    expect(browser.remove.mock.calls.map(([id]) => id)).toEqual([1]);
    expect(browser.state.tabs.map((tab) => tab.id)).toEqual([2]);
  });

  it('keeps later tabs when their project leaves completed while the first tab closes', async () => {
    const browser = installBrowser([
      { id: 1, url: 'https://done.axshare.com/' },
      { id: 2, url: 'https://other.axshare.com/' }
    ]);
    await saveCompletedProject();
    await saveCompletedProject('other');
    browser.remove.mockImplementation(async (id, callback) => {
      browser.state.tabs = browser.state.tabs.filter((tab) => tab.id !== id);
      await setFolder('axshare:other', '進行中');
      callback();
    });
    expect(await closeCompletedTabs([1, 2])).toEqual({ ok: true, closedCount: 1, completedTabs: [] });
    expect(browser.remove.mock.calls.map(([id]) => id)).toEqual([1]);
    expect(browser.state.tabs.map((tab) => tab.id)).toEqual([2]);
  });

  it('keeps matching tabs opened after preview until their IDs are explicitly requested', async () => {
    const browser = installBrowser([{ id: 1, url: 'https://done.axshare.com/' }]);
    await saveCompletedProject();
    const preview = await getCompletedTabs();
    browser.state.tabs.push({ id: 2, url: 'https://done.axshare.com/new.html' });

    const response = await closeCompletedTabs(preview.map((tab) => tab.tabId));
    expect(response).toMatchObject({ ok: true, closedCount: 1 });
    expect(response.completedTabs?.map((tab) => tab.tabId)).toEqual([2]);
    expect(browser.remove.mock.calls.map(([id]) => id)).toEqual([1]);
    expect(browser.state.tabs.map((tab) => tab.id)).toEqual([2]);

    expect(await closeCompletedTabs([2])).toEqual({ ok: true, closedCount: 1, completedTabs: [] });
    expect(browser.remove.mock.calls.map(([id]) => id)).toEqual([1, 2]);
  });

  it('reports partial close failures with the refreshed list and actual successful count', async () => {
    const browser = installBrowser([
      { id: 1, url: 'https://done.axshare.com/' },
      { id: 2, url: 'https://done.axshare.com/other.html' }
    ]);
    await saveCompletedProject();
    browser.remove.mockImplementation((id, callback) => {
      if (id === 2) {
        browser.runtime.lastError = { message: 'Tabs cannot be edited right now' };
        callback();
        browser.runtime.lastError = undefined;
        return;
      }
      browser.state.tabs = browser.state.tabs.filter((tab) => tab.id !== id);
      callback();
    });
    const response = await closeCompletedTabs([1, 2]);
    expect(response).toMatchObject({ ok: false, closedCount: 1 });
    expect(response.completedTabs?.map((tab) => tab.tabId)).toEqual([2]);
    if (!response.ok) {
      expect(response.error).toContain('Tabs cannot be edited right now');
    }
  });

  it('handles a tab independently closed during removal without counting it as our success', async () => {
    const browser = installBrowser([{ id: 1, url: 'https://done.axshare.com/' }]);
    await saveCompletedProject();
    browser.remove.mockImplementation((id, callback) => {
      browser.state.tabs = [];
      browser.runtime.lastError = { message: `No tab with id: ${id}` };
      callback();
      browser.runtime.lastError = undefined;
    });
    expect(await closeCompletedTabs([1])).toEqual({ ok: true, closedCount: 0, completedTabs: [] });
  });

  it('does not claim success if a remove callback succeeds but the tab is still open', async () => {
    const browser = installBrowser([{ id: 1, url: 'https://done.axshare.com/' }]);
    await saveCompletedProject();
    browser.remove.mockImplementation((_id, callback) => callback());
    expect(await closeCompletedTabs([1])).toMatchObject({ ok: false, closedCount: 0 });
  });

  it('reports query failures and never attempts to close unknown tabs', async () => {
    const browser = installBrowser([{ id: 1, url: 'https://done.axshare.com/' }]);
    await saveCompletedProject();
    browser.query.mockImplementation((_info, callback) => {
      browser.runtime.lastError = { message: 'Access denied' };
      callback([]);
      browser.runtime.lastError = undefined;
    });
    await expect(getCompletedTabs()).rejects.toThrow('Access denied');
    expect(await closeCompletedTabs([1])).toMatchObject({ ok: false, closedCount: 0 });
    expect(browser.remove).not.toHaveBeenCalled();
  });

  it('returns an error when refresh fails after successful removals', async () => {
    const browser = installBrowser([{ id: 1, url: 'https://done.axshare.com/' }]);
    await saveCompletedProject();
    browser.query.mockImplementationOnce((_info, callback) => callback([...browser.state.tabs]));
    browser.query.mockImplementationOnce((_info, callback) => {
      browser.runtime.lastError = { message: 'Refresh failed' };
      callback([]);
      browser.runtime.lastError = undefined;
    });
    expect(await closeCompletedTabs([1])).toMatchObject({ ok: false, closedCount: 1, error: expect.stringContaining('Refresh failed') });
  });

  it('reports unsupported APIs and rejects invalid IDs', async () => {
    vi.stubGlobal('chrome', { runtime: { lastError: undefined } });
    await expect(getCompletedTabs()).rejects.toThrow('不支援頁籤清理');
    await expect(closeCompletedTabs([1])).rejects.toThrow('不支援關閉頁籤');
    await expect(closeCompletedTabs([-1])).rejects.toThrow('格式不正確');
  });
});
