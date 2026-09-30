import { getAllBookmarks } from '../shared/bookmarkStore';
import { findCompletedAxureTabs } from '../shared/tab-cleanup';
import { isValidTabId, type CompletedAxureTab, type RuntimeResponse } from '../shared/types';

function queryAllTabs(): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve, reject) => {
    if (!chrome.tabs?.query) {
      reject(new Error('此瀏覽器不支援頁籤清理'));
      return;
    }

    chrome.tabs.query({}, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(`無法讀取頁籤：${error.message ?? '未知錯誤'}`));
        return;
      }
      if (!Array.isArray(tabs)) {
        reject(new Error('無法讀取頁籤清單'));
        return;
      }
      resolve(tabs);
    });
  });
}

function removeTab(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.tabs.remove(tabId, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message ?? '無法關閉頁籤'));
        return;
      }
      resolve();
    });
  });
}

async function readSnapshot(): Promise<{ tabs: chrome.tabs.Tab[]; completedTabs: CompletedAxureTab[] }> {
  const [tabs, bookmarks] = await Promise.all([queryAllTabs(), getAllBookmarks()]);
  return { tabs, completedTabs: findCompletedAxureTabs(tabs, bookmarks) };
}

export async function getCompletedTabs(): Promise<CompletedAxureTab[]> {
  return (await readSnapshot()).completedTabs;
}

export async function closeCompletedTabs(tabIds: number[]): Promise<RuntimeResponse> {
  if (!Array.isArray(tabIds) || !tabIds.every(isValidTabId)) {
    throw new Error('頁籤清單格式不正確');
  }
  if (!chrome.tabs?.remove) {
    throw new Error('此瀏覽器不支援關閉頁籤');
  }

  const requestedIds = new Set(tabIds);
  const removedIds: number[] = [];
  const failures = new Map<number, string>();

  try {
    const initial = await readSnapshot();
    const candidates = initial.completedTabs.filter((tab) => requestedIds.has(tab.tabId));

    for (const [index, candidate] of candidates.entries()) {
      // 清單顯示後或前一個頁籤關閉期間，專案可能已改分組或頁籤已導航。
      const current = index === 0 ? initial : await readSnapshot();
      if (!current.completedTabs.some((tab) => tab.tabId === candidate.tabId)) {
        continue;
      }
      try {
        await removeTab(candidate.tabId);
        removedIds.push(candidate.tabId);
      } catch (error) {
        failures.set(candidate.tabId, error instanceof Error ? error.message : '未知錯誤');
      }
    }

    const refreshed = await readSnapshot();
    const openIds = new Set(refreshed.tabs.map((tab) => tab.id));
    const closedCount = removedIds.filter((id) => !openIds.has(id)).length;
    // 被其他操作先關閉的頁籤可略過；仍存在的失敗頁籤不可回報成功。
    const failedIds = [...failures.keys(), ...removedIds].filter((id) => openIds.has(id));
    if (failedIds.length > 0) {
      const detail = failures.get(failedIds[0]) ?? '頁籤仍然開啟';
      return {
        ok: false,
        error: `有 ${failedIds.length} 個頁籤無法關閉：${detail}`,
        closedCount,
        completedTabs: refreshed.completedTabs
      };
    }

    return { ok: true, closedCount, completedTabs: refreshed.completedTabs };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '清理頁籤時發生錯誤',
      closedCount: removedIds.length
    };
  }
}
