export const ZOOM_LEVELS = [
  50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240,
  250, 260, 270, 280, 290, 300, 310, 320, 330, 340, 350, 360, 370, 380, 390, 400
] as const;

export type ZoomLevel = (typeof ZOOM_LEVELS)[number];

export interface ZoomState {
  urlKey: string;
  zoom: ZoomLevel;
  updatedAt: number;
}

// 書籤資料型別集中於此(避免 storage.ts ↔ bookmarkStore.ts 的循環匯入)。
export interface AxureBookmark {
  projectKey: string; // 身份 + 去重 key，見 projectKey.ts
  url: string; // 開啟目標(專案首頁)
  name: string;
  folder: string;
  createdAt: number;
  lastVisitedAt: number | null;
  visitCount: number;
}

export interface Settings {
  promptMode: 'card' | 'badge';
  // parentFolderId 現在語意為「直接同步進此資料夾」的目標資料夾 id
  // (沿用歷史名稱以相容既有設定；已不再是「父層」)。
  chromeSync: { enabled: boolean; parentFolderId: string | null };
}

export type RuntimeMessage =
  | { type: 'GET_ZOOM'; urlKey: string }
  | { type: 'SET_ZOOM'; urlKey: string; zoom: ZoomLevel }
  | { type: 'RESET_ZOOM'; urlKey: string }
  | { type: 'BOOKMARK_GET_ALL' }
  | { type: 'BOOKMARK_ADD'; projectKey: string; name: string; url: string; folder?: string }
  | { type: 'BOOKMARK_REMOVE'; projectKey: string }
  | { type: 'BOOKMARK_RECORD_VISIT'; projectKey: string }
  | { type: 'BOOKMARK_DETECTED' } // 由 content 送出，background 以 sender.tab 算 projectKey
  | { type: 'BOOKMARK_IGNORE'; projectKey: string }
  | { type: 'BOOKMARK_RENAME'; projectKey: string; name: string }
  | { type: 'BOOKMARK_SET_FOLDER'; projectKey: string; folder: string }
  | { type: 'BOOKMARK_GET_IGNORED' }
  | { type: 'BOOKMARK_UNIGNORE'; projectKey: string }
  | { type: 'BOOKMARK_GET_FOLDERS' }
  | { type: 'BOOKMARK_ADD_FOLDER'; name: string }
  | { type: 'BOOKMARK_RENAME_FOLDER'; name: string; newName: string }
  | { type: 'BOOKMARK_REMOVE_FOLDER'; name: string }
  | { type: 'SETTINGS_GET' }
  | { type: 'SETTINGS_SET'; settings: Settings }
  | { type: 'SYNC_NOW' };

export type RuntimeResponse =
  | {
      ok: true;
      state?: ZoomState | null;
      bookmarks?: AxureBookmark[];
      bookmark?: AxureBookmark | null;
      ignored?: string[];
      folders?: string[];
      settings?: Settings;
      syncedCount?: number;
    }
  | { ok: false; error: string };

export type ContentMessage =
  | { type: 'CONTENT_GET_STATE' }
  | { type: 'CONTENT_SET_ZOOM'; zoom: number }
  | { type: 'CONTENT_RESET_ZOOM' }
  | { type: 'CONTENT_SHORTCUT_IN' }
  | { type: 'CONTENT_SHORTCUT_OUT' }
  | { type: 'CONTENT_SHORTCUT_RESET' }
  | { type: 'CONTENT_SHOW_PROMPT'; projectKey: string; name: string; url: string };

export type ContentResponse =
  | {
      ok: true;
      data: {
        isAxure: boolean;
        urlKey: string;
        zoom: ZoomLevel;
      };
    }
  | { ok: false; error: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<RuntimeMessage> & { type?: string };

  if (candidate.type === 'GET_ZOOM' || candidate.type === 'RESET_ZOOM') {
    return isNonEmptyString(candidate.urlKey);
  }

  if (candidate.type === 'SET_ZOOM') {
    return isNonEmptyString(candidate.urlKey) && typeof candidate.zoom === 'number';
  }

  if (
    candidate.type === 'BOOKMARK_GET_ALL' ||
    candidate.type === 'BOOKMARK_DETECTED' ||
    candidate.type === 'BOOKMARK_GET_IGNORED' ||
    candidate.type === 'BOOKMARK_GET_FOLDERS' ||
    candidate.type === 'SETTINGS_GET' ||
    candidate.type === 'SYNC_NOW'
  ) {
    return true;
  }

  if (candidate.type === 'SETTINGS_SET') {
    return typeof candidate.settings === 'object' && candidate.settings !== null;
  }

  if (candidate.type === 'BOOKMARK_ADD') {
    return isNonEmptyString(candidate.projectKey) && isNonEmptyString(candidate.name) && isNonEmptyString(candidate.url);
  }

  if (candidate.type === 'BOOKMARK_ADD_FOLDER' || candidate.type === 'BOOKMARK_REMOVE_FOLDER') {
    return isNonEmptyString(candidate.name);
  }

  if (candidate.type === 'BOOKMARK_RENAME_FOLDER') {
    return isNonEmptyString(candidate.name) && isNonEmptyString(candidate.newName);
  }

  if (candidate.type === 'BOOKMARK_RENAME') {
    return isNonEmptyString(candidate.projectKey) && isNonEmptyString(candidate.name);
  }

  if (candidate.type === 'BOOKMARK_SET_FOLDER') {
    return isNonEmptyString(candidate.projectKey) && typeof candidate.folder === 'string';
  }

  if (
    candidate.type === 'BOOKMARK_REMOVE' ||
    candidate.type === 'BOOKMARK_RECORD_VISIT' ||
    candidate.type === 'BOOKMARK_IGNORE' ||
    candidate.type === 'BOOKMARK_UNIGNORE'
  ) {
    return isNonEmptyString(candidate.projectKey);
  }

  return false;
}
