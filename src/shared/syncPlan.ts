import type { AxureBookmark } from './types';

// 把書籤依分組整理成「未分組 + 各分組」的結構，給 Chrome 書籤同步重建子樹用。
// 純函式、與 chrome.bookmarks 解耦，方便測試。

export interface SyncGroup {
  name: string;
  items: AxureBookmark[];
}

export interface SyncPlan {
  ungrouped: AxureBookmark[];
  groups: SyncGroup[];
}

export function planSync(bookmarks: AxureBookmark[]): SyncPlan {
  const ungrouped: AxureBookmark[] = [];
  const grouped = new Map<string, AxureBookmark[]>();

  for (const bm of bookmarks) {
    if (bm.folder) {
      const items = grouped.get(bm.folder) ?? [];
      items.push(bm);
      grouped.set(bm.folder, items);
    } else {
      ungrouped.push(bm);
    }
  }

  return {
    ungrouped,
    groups: [...grouped.entries()].map(([name, items]) => ({ name, items }))
  };
}
