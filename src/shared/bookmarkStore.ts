import { STORAGE_PREFIX } from './constants';
import { getStorageValue, setStorageValue } from './storage';
import type { AxureBookmark, Settings } from './types';

// 單層書籤 schema(plan 附錄 B.5.1，2026-06-16 簡化)。
// axshare 的子網域本身就是穩定身份，url 不會變，所以 projectKey 同時當「身份」與「去重 key」。
// 身份/位置分離(Project+Location)只有 file:// 搬移情境才需要，屆時再補。
// 型別(AxureBookmark / Settings)定義於 ./types，避免循環匯入。

export type { AxureBookmark, Settings } from './types';

export interface AddBookmarkInput {
  projectKey: string;
  name: string;
  url: string;
  folder?: string;
}

const BM_PREFIX = `${STORAGE_PREFIX}bm::`;
const ITEMS_KEY = `${BM_PREFIX}items`;
const IGNORED_KEY = `${BM_PREFIX}ignored`;
const SETTINGS_KEY = `${BM_PREFIX}settings`;
const FOLDERS_KEY = `${BM_PREFIX}folders`;

const DEFAULT_SETTINGS: Settings = {
  promptMode: 'card',
  chromeSync: { enabled: false, parentFolderId: null }
};

// 首次使用時種入的預設分組(之後使用者可自由新增/改名/刪除)。
export const DEFAULT_FOLDERS = ['進行中', '待確認', '已完成', '參考'];

async function readItems(): Promise<Record<string, AxureBookmark>> {
  return (await getStorageValue<Record<string, AxureBookmark>>(ITEMS_KEY)) ?? {};
}

async function writeItems(items: Record<string, AxureBookmark>): Promise<void> {
  await setStorageValue(ITEMS_KEY, items);
}

export async function getAllBookmarks(): Promise<AxureBookmark[]> {
  const items = await readItems();
  return Object.values(items).sort(
    (a, b) => (b.lastVisitedAt ?? b.createdAt) - (a.lastVisitedAt ?? a.createdAt)
  );
}

export async function getBookmark(projectKey: string): Promise<AxureBookmark | null> {
  const items = await readItems();
  return items[projectKey] ?? null;
}

export async function addBookmark(input: AddBookmarkInput): Promise<AxureBookmark> {
  const items = await readItems();
  const existing = items[input.projectKey];

  if (existing) {
    // 已存在：只更新最後已知位置，不重設名稱/分組/造訪數。
    existing.url = input.url;
    items[input.projectKey] = existing;
    await writeItems(items);
    return existing;
  }

  const bookmark: AxureBookmark = {
    projectKey: input.projectKey,
    url: input.url,
    name: input.name,
    folder: input.folder ?? '',
    createdAt: Date.now(),
    lastVisitedAt: null,
    visitCount: 0
  };
  items[input.projectKey] = bookmark;
  await writeItems(items);
  return bookmark;
}

export async function recordVisit(projectKey: string): Promise<void> {
  const items = await readItems();
  const bookmark = items[projectKey];
  if (!bookmark) {
    return;
  }

  bookmark.lastVisitedAt = Date.now();
  bookmark.visitCount += 1;
  await writeItems(items);
}

export async function renameBookmark(projectKey: string, name: string): Promise<void> {
  const items = await readItems();
  if (!items[projectKey]) {
    return;
  }

  items[projectKey].name = name;
  await writeItems(items);
}

export async function setFolder(projectKey: string, folder: string): Promise<void> {
  const items = await readItems();
  if (!items[projectKey]) {
    return;
  }

  items[projectKey].folder = folder;
  await writeItems(items);
}

export async function removeBookmark(projectKey: string): Promise<void> {
  const items = await readItems();
  delete items[projectKey];
  await writeItems(items);
}

export async function getIgnored(): Promise<string[]> {
  return (await getStorageValue<string[]>(IGNORED_KEY)) ?? [];
}

export async function isIgnored(projectKey: string): Promise<boolean> {
  return (await getIgnored()).includes(projectKey);
}

export async function ignoreProject(projectKey: string): Promise<void> {
  const ignored = await getIgnored();
  if (!ignored.includes(projectKey)) {
    ignored.push(projectKey);
    await setStorageValue(IGNORED_KEY, ignored);
  }
}

export async function unignoreProject(projectKey: string): Promise<void> {
  const ignored = await getIgnored();
  await setStorageValue(
    IGNORED_KEY,
    ignored.filter((key) => key !== projectKey)
  );
}

// 「忽略」既有書籤：移除書籤 + 加入 ignore 清單(之後不再提示)。
// 偵測卡片的「不再提醒」也走這支：當下尚未收藏，移除是無害的 no-op。
export async function ignoreBookmark(projectKey: string): Promise<void> {
  await removeBookmark(projectKey);
  await ignoreProject(projectKey);
}

// ── 受管分組清單 ──────────────────────────────────────────────
// 分組是一等公民：清單獨立儲存，首次取用時種入預設分組。
export async function getFolders(): Promise<string[]> {
  const stored = await getStorageValue<string[]>(FOLDERS_KEY);
  if (stored === undefined) {
    await setStorageValue(FOLDERS_KEY, DEFAULT_FOLDERS);
    return [...DEFAULT_FOLDERS];
  }
  return stored;
}

export async function addFolder(name: string): Promise<string[]> {
  const trimmed = name.trim();
  const folders = await getFolders();
  if (trimmed && !folders.includes(trimmed)) {
    folders.push(trimmed);
    await setStorageValue(FOLDERS_KEY, folders);
  }
  return folders;
}

export async function renameFolder(oldName: string, newName: string): Promise<void> {
  const trimmed = newName.trim();
  if (!trimmed || trimmed === oldName) {
    return;
  }

  const folders = await getFolders();
  const index = folders.indexOf(oldName);
  if (index === -1) {
    return;
  }

  // 若新名稱已存在則視為合併(移除舊項)，否則就地改名。
  if (folders.includes(trimmed)) {
    folders.splice(index, 1);
  } else {
    folders[index] = trimmed;
  }
  await setStorageValue(FOLDERS_KEY, folders);

  const items = await readItems();
  let changed = false;
  for (const key of Object.keys(items)) {
    if (items[key].folder === oldName) {
      items[key].folder = trimmed;
      changed = true;
    }
  }
  if (changed) {
    await writeItems(items);
  }
}

export async function removeFolder(name: string): Promise<void> {
  const folders = await getFolders();
  const next = folders.filter((folder) => folder !== name);
  if (next.length !== folders.length) {
    await setStorageValue(FOLDERS_KEY, next);
  }

  // 該分組底下的書籤退回未分組(空字串)，不刪書籤。
  const items = await readItems();
  let changed = false;
  for (const key of Object.keys(items)) {
    if (items[key].folder === name) {
      items[key].folder = '';
      changed = true;
    }
  }
  if (changed) {
    await writeItems(items);
  }
}

export async function getSettings(): Promise<Settings> {
  const stored = await getStorageValue<Partial<Settings>>(SETTINGS_KEY);
  return {
    promptMode: stored?.promptMode ?? DEFAULT_SETTINGS.promptMode,
    chromeSync: {
      enabled: stored?.chromeSync?.enabled ?? DEFAULT_SETTINGS.chromeSync.enabled,
      parentFolderId: stored?.chromeSync?.parentFolderId ?? DEFAULT_SETTINGS.chromeSync.parentFolderId
    }
  };
}

export async function setSettings(settings: Settings): Promise<void> {
  await setStorageValue(SETTINGS_KEY, settings);
}
