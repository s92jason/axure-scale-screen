import { createBackup, normalizeBackup } from '../shared/bookmarkBackup';
import { getBackupData, getNativeBackupLinkedAt, importBackup, linkNativeBackup } from '../shared/bookmarkStore';
import type { BookmarkBackup, NativeBackupStatus } from '../shared/types';

// ── Safari 自動備份 ─────────────────────────────────────────────
// 書籤有變動就透過 native messaging 交給 SafariWebExtensionHandler.swift，
// 寫進 App Extension 自己的沙盒容器。Safari 把外掛當成重新安裝時只會清掉外掛的 storage，
// 不會動這個容器，所以還原時有東西可用。
//
// 最重要的規則：storage 裡沒有連結標記(= 全新安裝或剛被清除)而原生備份還有書籤時，
// 一律暫停寫入，等使用者在管理頁決定還原或放棄，避免用空資料蓋掉唯一的備份。

const NATIVE_APP_ID = 'application.id'; // Safari 會忽略這個參數，訊息一律送到所屬 App 的 extension handler
const NATIVE_TIMEOUT_MS = 5000;
const BACKUP_DEBOUNCE_MS = 1500;
const OUTDATED_HANDLER = '需要更新 Xcode 專案的原生程式：執行 npm run build 後在 Xcode 按 Run。';

interface NativeReply {
  ok?: unknown;
  error?: unknown;
  backup?: unknown;
  savedAt?: unknown;
}

interface NativeBackupSnapshot {
  backup: BookmarkBackup | null;
  savedAt: number | null;
}

let backupTimer: ReturnType<typeof setTimeout> | null = null;

// Chrome 也有 sendNativeMessage，但沒有對應的 native host；只在 Safari 使用。
// 背景是 service worker，沒有 navigator.vendor，改用 userAgent 判斷。
export function isNativeBackupSupported(): boolean {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return (
    typeof chrome.runtime?.sendNativeMessage === 'function' &&
    /Safari\//.test(ua) &&
    !/(Chrome|Chromium|Edg)\//.test(ua)
  );
}

function sendNative(message: Record<string, unknown>): Promise<NativeReply> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('原生程式沒有回應。')), NATIVE_TIMEOUT_MS);
    try {
      chrome.runtime.sendNativeMessage(NATIVE_APP_ID, message, (response: unknown) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        // 舊的範本 handler 只會回 { echo }，沒有 ok 欄位。
        if (typeof response !== 'object' || response === null || typeof (response as NativeReply).ok !== 'boolean') {
          reject(new Error(OUTDATED_HANDLER));
          return;
        }
        const reply = response as NativeReply;
        if (reply.ok !== true) {
          reject(new Error(typeof reply.error === 'string' ? reply.error : '原生程式回報錯誤。'));
          return;
        }
        resolve(reply);
      });
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

async function readNativeBackup(): Promise<NativeBackupSnapshot> {
  const reply = await sendNative({ type: 'backup.read' });
  return {
    backup: reply.backup ? normalizeBackup(reply.backup) : null,
    savedAt: typeof reply.savedAt === 'number' ? reply.savedAt : null
  };
}

async function writeNativeBackup(): Promise<void> {
  await sendNative({ type: 'backup.write', backup: createBackup(await getBackupData()) });
}

// 回傳是否真的寫入；暫停中(等待還原)回傳 false。
export async function runNativeBackup(): Promise<boolean> {
  if (!isNativeBackupSupported()) {
    return false;
  }
  if ((await getNativeBackupLinkedAt()) === null) {
    const native = await readNativeBackup();
    if (native.backup && native.backup.bookmarks.length > 0) {
      return false;
    }
    await writeNativeBackup();
    await linkNativeBackup();
    return true;
  }
  await writeNativeBackup();
  return true;
}

export function scheduleNativeBackup(): void {
  if (!isNativeBackupSupported()) {
    return;
  }
  if (backupTimer !== null) {
    clearTimeout(backupTimer);
  }
  backupTimer = setTimeout(() => {
    backupTimer = null;
    void runNativeBackup().catch((error: unknown) => {
      console.warn('[axure-scale] 自動備份失敗', error);
    });
  }, BACKUP_DEBOUNCE_MS);
}

export async function getNativeBackupStatus(): Promise<NativeBackupStatus> {
  if (!isNativeBackupSupported()) {
    return { available: false, lastBackupAt: null, pending: null };
  }
  try {
    const [native, linkedAt] = await Promise.all([readNativeBackup(), getNativeBackupLinkedAt()]);
    const count = native.backup?.bookmarks.length ?? 0;
    return {
      available: true,
      lastBackupAt: native.savedAt,
      pending: linkedAt === null && count > 0 ? { count, savedAt: native.savedAt } : null
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : '原生程式無法使用。',
      lastBackupAt: null,
      pending: null
    };
  }
}

// 只補上目前沒有的書籤(同 JSON 匯入)，接著恢復自動備份並立即寫入合併後的結果。
export async function restoreNativeBackup(): Promise<{ added: number; skipped: number }> {
  const native = await readNativeBackup();
  if (!native.backup) {
    throw new Error('找不到自動備份。');
  }
  const imported = await importBackup(native.backup);
  await linkNativeBackup();
  await writeNativeBackup();
  return imported;
}

// 不還原：以目前的資料為準恢復自動備份。原生端仍保留最近 30 天的每日備份。
export async function dismissNativeBackup(): Promise<void> {
  await linkNativeBackup();
  await writeNativeBackup();
}
