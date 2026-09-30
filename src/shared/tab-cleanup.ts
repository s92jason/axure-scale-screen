import { COMPLETED_FOLDER } from './constants';
import { toProjectKey } from './projectKey';
import { isValidTabId, type AxureBookmark, type CompletedAxureTab } from './types';

export interface AxureTabCandidate {
  id?: number;
  url?: string;
  pendingUrl?: string;
  title?: string;
}

export function findCompletedAxureTabs(
  tabs: AxureTabCandidate[],
  bookmarks: AxureBookmark[]
): CompletedAxureTab[] {
  const completed = new Map(
    bookmarks.filter((bookmark) => bookmark.folder === COMPLETED_FOLDER).map((bookmark) => [bookmark.projectKey, bookmark])
  );
  const matches: CompletedAxureTab[] = [];

  for (const tab of tabs) {
    if (!isValidTabId(tab.id)) {
      continue;
    }

    // 頁籤若正在導航，依目的地比對，避免關閉即將離開已完成專案的頁籤。
    const url = tab.pendingUrl ?? tab.url;
    if (!url) {
      continue;
    }

    let projectKey: string | null;
    try {
      projectKey = toProjectKey(url);
    } catch {
      // 略過含不合法編碼的 file URL，不讓一個異常頁籤阻止整份清單。
      continue;
    }

    const bookmark = projectKey ? completed.get(projectKey) : undefined;
    if (!bookmark) {
      continue;
    }

    matches.push({
      tabId: tab.id,
      projectKey: bookmark.projectKey,
      name: bookmark.name,
      url,
      title: tab.title ?? ''
    });
  }

  return matches;
}
