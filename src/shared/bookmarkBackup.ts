import { COMPLETED_FOLDER } from './constants';
import type { AxureBookmark, BookmarkBackup } from './types';

// 完整 JSON 備份：書籤(含造訪次數)、分組與忽略清單。
// Safari 把外掛當成重新安裝時會清掉整個 storage，這份檔案是唯一能完整還原的來源。
// 不含設定：chromeSync.parentFolderId 是各瀏覽器自己的書籤 id，跨瀏覽器還原沒有意義。

export const BACKUP_FORMAT = 'axure-scale-screen-backup' as const;
export const BACKUP_VERSION = 1 as const;

const STALE_BACKUP_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface BackupData {
  bookmarks: AxureBookmark[];
  folders: string[];
  ignored: string[];
}

export interface BackupMergeInput {
  items: Record<string, AxureBookmark>;
  folders: string[];
  ignored: string[];
}

export interface BackupMergeResult extends BackupMergeInput {
  added: number;
  skipped: number;
}

export interface BackupReminder {
  text: string;
  stale: boolean;
}

export function createBackup(data: BackupData, now = Date.now()): BookmarkBackup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date(now).toISOString(),
    bookmarks: data.bookmarks,
    folders: data.folders,
    ignored: data.ignored
  };
}

export function backupFileName(now = Date.now()): string {
  const date = new Date(now);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `axure-bookmarks-backup-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function toStringList(value: unknown, label: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`備份檔格式錯誤：${label}必須是文字清單。`);
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

// 與 manifest host_permissions 一致；書籤網址會直接交給 tabs.create，不收 javascript: 等其他協定。
const ALLOWED_URL = /^(https?|file):/i;

function toBookmark(value: unknown, index: number, now: number): AxureBookmark {
  if (!isRecord(value) || typeof value.projectKey !== 'string' || !value.projectKey || typeof value.url !== 'string' || !value.url) {
    throw new Error(`備份檔格式錯誤：第 ${index + 1} 筆書籤缺少 projectKey 或 url。`);
  }
  if (!ALLOWED_URL.test(value.url)) {
    throw new Error(`備份檔格式錯誤：第 ${index + 1} 筆書籤的網址不是 http、https 或 file。`);
  }

  // 缺少的選填欄位補預設值，讓手動編修過的備份檔也能匯入。
  return {
    projectKey: value.projectKey,
    url: value.url,
    name: typeof value.name === 'string' && value.name.trim() ? value.name : value.projectKey,
    folder: typeof value.folder === 'string' ? value.folder : '',
    createdAt: isFiniteNumber(value.createdAt) ? value.createdAt : now,
    lastVisitedAt: isFiniteNumber(value.lastVisitedAt) ? value.lastVisitedAt : null,
    visitCount: isFiniteNumber(value.visitCount) && value.visitCount > 0 ? Math.floor(value.visitCount) : 0
  };
}

// 背景收到匯入訊息時也會再跑一次，不信任來自頁面的物件。
export function normalizeBackup(value: unknown, now = Date.now()): BookmarkBackup {
  if (!isRecord(value) || value.format !== BACKUP_FORMAT) {
    throw new Error('這不是 Axure Scale Screen 的備份檔。');
  }
  if (value.version !== BACKUP_VERSION) {
    throw new Error(`不支援的備份檔版本：${String(value.version)}。`);
  }
  if (!Array.isArray(value.bookmarks)) {
    throw new Error('備份檔格式錯誤：缺少書籤清單。');
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : '',
    bookmarks: value.bookmarks.map((bookmark, index) => toBookmark(bookmark, index, now)),
    folders: toStringList(value.folders, '分組'),
    ignored: toStringList(value.ignored, '忽略清單')
  };
}

export function parseBackup(text: string, now = Date.now()): BookmarkBackup {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('備份檔不是有效的 JSON。');
  }
  return normalizeBackup(value, now);
}

// 只補上目前沒有的書籤；既有書籤(名稱、分組、造訪次數)一律不動，重複匯入同一份備份沒有副作用。
export function mergeBackup(current: BackupMergeInput, backup: BookmarkBackup): BackupMergeResult {
  const items = { ...current.items };
  const folders = [...current.folders];
  const addFolder = (folder: string): void => {
    if (folder && !folders.includes(folder)) {
      folders.push(folder);
    }
  };

  let added = 0;
  let skipped = 0;
  for (const bookmark of backup.bookmarks) {
    if (items[bookmark.projectKey]) {
      skipped += 1;
      continue;
    }
    items[bookmark.projectKey] = { ...bookmark };
    addFolder(bookmark.folder);
    added += 1;
  }

  backup.folders.forEach(addFolder);
  addFolder(COMPLETED_FOLDER);

  return {
    items,
    folders,
    ignored: [...new Set([...current.ignored, ...backup.ignored])],
    added,
    skipped
  };
}

export function describeBackupAge(lastExportedAt: number | null, bookmarkCount: number, now = Date.now()): BackupReminder {
  if (lastExportedAt === null) {
    return {
      text: '尚未備份。建議匯出一份 JSON 備份，外掛資料被清除時才能還原。',
      stale: bookmarkCount > 0
    };
  }

  const days = Math.max(0, Math.floor((now - lastExportedAt) / DAY_MS));
  const age = days === 0 ? '今天' : `${days} 天前`;
  const stale = bookmarkCount > 0 && days >= STALE_BACKUP_DAYS;
  return { text: stale ? `上次備份：${age}，建議重新匯出。` : `上次備份：${age}。`, stale };
}
