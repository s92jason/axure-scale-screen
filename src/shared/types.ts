export const ZOOM_LEVELS = [
  50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200
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
  | { type: 'BOOKMARK_IGNORE'; projectKey: string };

export type RuntimeResponse =
  | { ok: true; state?: ZoomState | null; bookmarks?: AxureBookmark[]; bookmark?: AxureBookmark | null }
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

  if (candidate.type === 'BOOKMARK_GET_ALL' || candidate.type === 'BOOKMARK_DETECTED') {
    return true;
  }

  if (candidate.type === 'BOOKMARK_ADD') {
    return isNonEmptyString(candidate.projectKey) && isNonEmptyString(candidate.name) && isNonEmptyString(candidate.url);
  }

  if (
    candidate.type === 'BOOKMARK_REMOVE' ||
    candidate.type === 'BOOKMARK_RECORD_VISIT' ||
    candidate.type === 'BOOKMARK_IGNORE'
  ) {
    return isNonEmptyString(candidate.projectKey);
  }

  return false;
}
