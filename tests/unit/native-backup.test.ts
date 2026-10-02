import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackup } from '../../src/shared/bookmarkBackup';
import { STORAGE_PREFIX } from '../../src/shared/constants';
import type { AxureBookmark, BookmarkBackup } from '../../src/shared/types';

type NativeModule = typeof import('../../src/background/native-backup');

const SAFARI_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15';
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const itemsKey = `${STORAGE_PREFIX}bm::items`;
const linkKey = `${STORAGE_PREFIX}bm::nativeLink`;

function bookmark(id: string): AxureBookmark {
  return { projectKey: `axshare:${id}`, url: `https://${id}.axshare.com/`, name: id, folder: '', createdAt: 1, lastVisitedAt: null, visitCount: 0 };
}

let storage: Record<string, unknown>;
let nativeFile: { backup: BookmarkBackup; savedAt: number } | null;
let nativeOverride: ((message: { type: string }) => unknown) | null;
let lastError: { message: string } | undefined;
let sendNativeMessage: ReturnType<typeof vi.fn>;
let native: NativeModule;

function writes(): number {
  return sendNativeMessage.mock.calls.filter(([, message]) => (message as { type: string }).type === 'backup.write').length;
}

function nativeKeys(): string[] {
  return nativeFile?.backup.bookmarks.map((bm) => bm.projectKey) ?? [];
}

beforeEach(async () => {
  vi.resetModules();
  storage = { [itemsKey]: { 'axshare:current': bookmark('current') } };
  nativeFile = null;
  nativeOverride = null;
  lastError = undefined;
  sendNativeMessage = vi.fn((_app: string, message: { type: string; backup?: BookmarkBackup }, callback: (response: unknown) => void) => {
    if (nativeOverride) {
      callback(nativeOverride(message));
      return;
    }
    if (message.type === 'backup.write') {
      nativeFile = { backup: structuredClone(message.backup!), savedAt: 5000 };
      callback({ ok: true, savedAt: 5000 });
      return;
    }
    callback({ ok: true, backup: nativeFile?.backup ?? null, savedAt: nativeFile?.savedAt ?? null });
  });
  vi.stubGlobal('chrome', {
    runtime: {
      get lastError() {
        return lastError;
      },
      sendNativeMessage
    },
    storage: {
      local: {
        get: (key: string, callback: (result: Record<string, unknown>) => void) => callback({ [key]: structuredClone(storage[key]) }),
        set: (items: Record<string, unknown>, callback: () => void) => {
          Object.assign(storage, structuredClone(items));
          callback();
        },
        remove: (key: string, callback: () => void) => {
          delete storage[key];
          callback();
        }
      }
    }
  });
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(SAFARI_UA);
  native = await import('../../src/background/native-backup');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Safari auto backup', () => {
  it('stays off outside Safari without touching native messaging', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(CHROME_UA);

    expect(native.isNativeBackupSupported()).toBe(false);
    expect(await native.getNativeBackupStatus()).toEqual({ available: false, lastBackupAt: null, pending: null });
    expect(await native.runNativeBackup()).toBe(false);
    expect(sendNativeMessage).not.toHaveBeenCalled();
  });

  it('asks for a rebuild when the Xcode project still has the echo template handler', async () => {
    nativeOverride = (message) => ({ echo: message });

    const status = await native.getNativeBackupStatus();

    expect(status.available).toBe(false);
    expect(status.error).toContain('需要更新 Xcode 專案的原生程式');
  });

  it('surfaces native errors and runtime.lastError', async () => {
    nativeOverride = () => ({ ok: false, error: '磁碟空間不足' });
    expect((await native.getNativeBackupStatus()).error).toBe('磁碟空間不足');

    nativeOverride = () => {
      lastError = { message: 'Native messaging host not found' };
      return undefined;
    };
    expect((await native.getNativeBackupStatus()).error).toBe('Native messaging host not found');
  });

  it('creates the first backup and links the storage on a fresh install', async () => {
    expect(await native.runNativeBackup()).toBe(true);

    expect(nativeKeys()).toEqual(['axshare:current']);
    expect(storage[linkKey]).toEqual({ linkedAt: expect.any(Number) });
    expect(await native.getNativeBackupStatus()).toEqual({ available: true, lastBackupAt: 5000, pending: null });
  });

  it('pauses instead of overwriting the backup when the storage was wiped', async () => {
    nativeFile = { backup: createBackup({ bookmarks: [bookmark('old1'), bookmark('old2')], folders: [], ignored: [] }), savedAt: 4000 };

    expect(await native.runNativeBackup()).toBe(false);

    expect(writes()).toBe(0);
    expect(nativeKeys()).toEqual(['axshare:old1', 'axshare:old2']);
    expect(storage[linkKey]).toBeUndefined();
    expect(await native.getNativeBackupStatus()).toEqual({ available: true, lastBackupAt: 4000, pending: { count: 2, savedAt: 4000 } });
  });

  it('restores missing bookmarks, keeps ones added after the wipe and resumes backups', async () => {
    nativeFile = { backup: createBackup({ bookmarks: [bookmark('old1'), bookmark('current')], folders: ['舊分組'], ignored: [] }), savedAt: 4000 };

    expect(await native.restoreNativeBackup()).toEqual({ added: 1, skipped: 1 });

    expect(Object.keys(storage[itemsKey] as object).sort()).toEqual(['axshare:current', 'axshare:old1']);
    expect(storage[linkKey]).toBeDefined();
    expect(nativeKeys().sort()).toEqual(['axshare:current', 'axshare:old1']);
    expect((await native.getNativeBackupStatus()).pending).toBeNull();
  });

  it('refuses to restore when there is no backup', async () => {
    await expect(native.restoreNativeBackup()).rejects.toThrow('找不到自動備份');
    expect(storage[linkKey]).toBeUndefined();
  });

  it('dismissing keeps the current data and resumes backups', async () => {
    nativeFile = { backup: createBackup({ bookmarks: [bookmark('old1')], folders: [], ignored: [] }), savedAt: 4000 };

    await native.dismissNativeBackup();

    expect(nativeKeys()).toEqual(['axshare:current']);
    expect(storage[linkKey]).toBeDefined();
    expect((await native.getNativeBackupStatus()).pending).toBeNull();
  });

  it('keeps writing once linked, even when the user removed every bookmark', async () => {
    await native.runNativeBackup();
    storage[itemsKey] = {};

    expect(await native.runNativeBackup()).toBe(true);
    expect(nativeKeys()).toEqual([]);
  });

  it('debounces bursts of changes into a single write', async () => {
    vi.useFakeTimers();
    native.scheduleNativeBackup();
    native.scheduleNativeBackup();
    native.scheduleNativeBackup();
    expect(writes()).toBe(0);

    await vi.runAllTimersAsync();

    expect(writes()).toBe(1);
  });
});
