import { mergeBackup, type BackupData } from './bookmarkBackup';
import { COMPLETED_FOLDER, STORAGE_PREFIX } from './constants';
import { getStorageValue, setStorageValue } from './storage';
import type { AxureBookmark, BookmarkBackup, Settings } from './types';

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
const BACKUP_META_KEY = `${BM_PREFIX}backup`;
const NATIVE_LINK_KEY = `${BM_PREFIX}nativeLink`;

const DEFAULT_SETTINGS: Settings = {
  promptMode: 'card',
  chromeSync: { enabled: false, parentFolderId: null }
};

// 首次使用時種入的預設分組；只有「已完成」固定保留，其餘可自由改名或刪除。
export const DEFAULT_FOLDERS = ['進行中', '待確認', COMPLETED_FOLDER, '參考'];

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
// 管理頁直接讀取同一份資料；顯示預設／固定分組不需要寫入或喚醒背景程式。
export async function getStoredFolders(): Promise<string[]> {
  const stored = await getStorageValue<string[]>(FOLDERS_KEY);
  if (stored === undefined) {
    return [...DEFAULT_FOLDERS];
  }
  return stored.includes(COMPLETED_FOLDER) ? stored : [...stored, COMPLETED_FOLDER];
}

export async function getFolders(): Promise<string[]> {
  const stored = await getStorageValue<string[]>(FOLDERS_KEY);
  if (stored === undefined) {
    await setStorageValue(FOLDERS_KEY, DEFAULT_FOLDERS);
    return [...DEFAULT_FOLDERS];
  }
  if (!stored.includes(COMPLETED_FOLDER)) {
    const folders = [...stored, COMPLETED_FOLDER];
    await setStorageValue(FOLDERS_KEY, folders);
    return folders;
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
  if (oldName === COMPLETED_FOLDER) {
    throw new Error('「已完成」是固定分組，不能改名。');
  }
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
  if (name === COMPLETED_FOLDER) {
    throw new Error('「已完成」是固定分組，不能刪除。');
  }
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

// ── JSON 備份 ────────────────────────────────────────────────
// 匯出只讀不寫(分組用 getStoredFolders，不會順手種入預設分組)。
export async function getBackupData(): Promise<BackupData> {
  const [bookmarks, folders, ignored] = await Promise.all([getAllBookmarks(), getStoredFolders(), getIgnored()]);
  return { bookmarks, folders, ignored };
}

export async function importBackup(backup: BookmarkBackup): Promise<{ added: number; skipped: number }> {
  const [items, folders, ignored] = await Promise.all([readItems(), getFolders(), getIgnored()]);
  const merged = mergeBackup({ items, folders, ignored }, backup);

  if (merged.added > 0) {
    await writeItems(merged.items);
  }
  if (merged.folders.length !== folders.length) {
    await setStorageValue(FOLDERS_KEY, merged.folders);
  }
  if (merged.ignored.length !== ignored.length) {
    await setStorageValue(IGNORED_KEY, merged.ignored);
  }
  return { added: merged.added, skipped: merged.skipped };
}

export async function getLastBackupAt(): Promise<number | null> {
  const meta = await getStorageValue<{ lastExportedAt?: unknown }>(BACKUP_META_KEY);
  return typeof meta?.lastExportedAt === 'number' ? meta.lastExportedAt : null;
}

export async function markBackupExported(at = Date.now()): Promise<void> {
  await setStorageValue(BACKUP_META_KEY, { lastExportedAt: at });
}

// 自動備份的連結標記：和書籤存在同一個 storage，Safari 清掉 storage 時會一起消失，
// 背景藉此分辨「全新安裝」與「資料被清除」，後者不能拿空資料覆蓋原生備份。
export async function getNativeBackupLinkedAt(): Promise<number | null> {
  const link = await getStorageValue<{ linkedAt?: unknown }>(NATIVE_LINK_KEY);
  return typeof link?.linkedAt === 'number' ? link.linkedAt : null;
}

export async function linkNativeBackup(at = Date.now()): Promise<void> {
  await setStorageValue(NATIVE_LINK_KEY, { linkedAt: at });
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
