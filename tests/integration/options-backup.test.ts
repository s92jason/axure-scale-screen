import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { BACKUP_FORMAT, BACKUP_VERSION, createBackup } from '../../src/shared/bookmarkBackup';
import { STORAGE_PREFIX } from '../../src/shared/constants';
import type { AxureBookmark, NativeBackupStatus, RuntimeMessage, RuntimeResponse } from '../../src/shared/types';

const optionsHtml = readFileSync(resolve('options.html'), 'utf8');
const itemsKey = `${STORAGE_PREFIX}bm::items`;
const foldersKey = `${STORAGE_PREFIX}bm::folders`;
const ignoredKey = `${STORAGE_PREFIX}bm::ignored`;
const backupKey = `${STORAGE_PREFIX}bm::backup`;
const savedBookmark: AxureBookmark = {
  projectKey: 'axshare:saved',
  name: '現有書籤',
  url: 'https://saved.axshare.com/',
  folder: '進行中',
  createdAt: 1,
  lastVisitedAt: 2,
  visitCount: 4
};

let storedData: Record<string, unknown>;
let sendMessage: ReturnType<typeof vi.fn<(message: RuntimeMessage, callback: (response?: RuntimeResponse) => void) => void>>;
let downloads: Array<{ fileName: string; blob: Blob }>;
let nativeStatus: NativeBackupStatus | undefined;
let confirmSpy: MockInstance<typeof window.confirm>;

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = new DOMParser().parseFromString(optionsHtml, 'text/html').body.innerHTML;
  storedData = {
    [itemsKey]: { [savedBookmark.projectKey]: savedBookmark },
    [foldersKey]: ['進行中', '已完成'],
    [ignoredKey]: ['axshare:ignored']
  };
  const event = () => ({ addListener: vi.fn(), removeListener: vi.fn() });
  nativeStatus = undefined;
  sendMessage = vi.fn((message, callback) => {
    switch (message.type) {
      case 'BOOKMARK_IMPORT':
        callback({ ok: true, imported: { added: 1, skipped: 1 } });
        return;
      case 'NATIVE_BACKUP_STATUS':
        callback({ ok: true, nativeBackup: nativeStatus });
        return;
      case 'NATIVE_BACKUP_RESTORE':
        nativeStatus = { available: true, lastBackupAt: 9000, pending: null };
        callback({ ok: true, imported: { added: 17, skipped: 1 } });
        return;
      case 'NATIVE_BACKUP_DISMISS':
        nativeStatus = { available: true, lastBackupAt: 9000, pending: null };
        callback({ ok: true });
        return;
      default:
        callback({ ok: true, completedTabs: [] });
    }
  });
  vi.stubGlobal('chrome', {
    runtime: { sendMessage },
    tabs: { onCreated: event(), onRemoved: event(), onUpdated: event() },
    storage: {
      local: {
        get: (key: string, callback: (data: Record<string, unknown>) => void) => callback({ [key]: structuredClone(storedData[key]) }),
        set: (items: Record<string, unknown>, callback: () => void) => {
          Object.assign(storedData, structuredClone(items));
          callback();
        },
        remove: vi.fn()
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() }
    }
  });
  vi.spyOn(navigator, 'vendor', 'get').mockReturnValue('Apple Computer, Inc.');

  downloads = [];
  const blobs = new Map<string, Blob>();
  // jsdom 沒有 createObjectURL；每個測試檔各自獨立環境，直接覆寫即可。
  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:test/${blobs.size}`;
    blobs.set(url, blob);
    return url;
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ fileName: this.download, blob: blobs.get(this.href)! });
  });
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function loadOptions(): Promise<void> {
  await import('../../src/options/main');
  await vi.waitFor(() => expect(el<HTMLButtonElement>('#backupExport').disabled).toBe(false));
}

function el<T extends HTMLElement>(selector: string): T {
  return document.querySelector<T>(selector)!;
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolveText) => {
    const reader = new FileReader();
    reader.onload = () => resolveText(String(reader.result));
    reader.readAsText(blob);
  });
}

function chooseFile(text: string, name = 'backup.json'): void {
  const input = el<HTMLInputElement>('#backupFile');
  Object.defineProperty(input, 'files', { configurable: true, value: [{ name, text: async () => text }] });
  input.dispatchEvent(new Event('change'));
}

function importMessages(): RuntimeMessage[] {
  return sendMessage.mock.calls.map(([message]) => message).filter((message) => message.type === 'BOOKMARK_IMPORT');
}

describe('options JSON backup', () => {
  it('flags a missing backup as soon as bookmarks are shown', async () => {
    await loadOptions();

    expect(el('#backupStatus').textContent).toContain('尚未備份');
    expect(el('#backupStatus').classList.contains('is-stale')).toBe(true);
  });

  it('exports bookmarks, folders and ignored projects re-read from storage and records the export time', async () => {
    await loadOptions();

    el<HTMLButtonElement>('#backupExport').click();
    await vi.waitFor(() => expect(storedData[backupKey]).toBeDefined());

    expect(downloads).toHaveLength(1);
    expect(downloads[0].fileName).toMatch(/^axure-bookmarks-backup-\d{8}\.json$/);
    const exported = JSON.parse(await readBlob(downloads[0].blob));
    expect(exported).toMatchObject({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      bookmarks: [savedBookmark],
      folders: ['進行中', '已完成'],
      ignored: ['axshare:ignored']
    });
    expect((storedData[backupKey] as { lastExportedAt: unknown }).lastExportedAt).toBeTypeOf('number');
    expect(el('#backupStatus').textContent).toBe('上次備份：今天。');
    expect(el('#backupStatus').classList.contains('is-stale')).toBe(false);
    expect(el('#backupNote').textContent).toContain('已匯出 1 筆書籤');
    expect(storedData[itemsKey]).toEqual({ [savedBookmark.projectKey]: savedBookmark });
  });

  it('imports a backup through the background after confirmation and reports what was added', async () => {
    await loadOptions();
    const backup = createBackup({
      bookmarks: [savedBookmark, { ...savedBookmark, projectKey: 'axshare:lost', url: 'https://lost.axshare.com/' }],
      folders: [],
      ignored: []
    });

    chooseFile(JSON.stringify(backup));
    await vi.waitFor(() => expect(el('#backupNote').textContent).toBe('已加入 1 筆書籤，略過 1 筆已存在的書籤。'));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('備份檔含 2 筆書籤'));
    expect(importMessages()).toEqual([{ type: 'BOOKMARK_IMPORT', backup }]);
    expect(el('#backupNote').classList.contains('is-error')).toBe(false);
  });

  it('rejects an invalid file without asking or contacting the background', async () => {
    await loadOptions();

    chooseFile('<!DOCTYPE NETSCAPE-Bookmark-file-1>', 'axure-bookmarks.html');
    await vi.waitFor(() => expect(el<HTMLParagraphElement>('#backupNote').hidden).toBe(false));

    expect(el('#backupNote').textContent).toBe('無法匯入「axure-bookmarks.html」：備份檔不是有效的 JSON。');
    expect(el('#backupNote').classList.contains('is-error')).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(importMessages()).toEqual([]);
  });

  it('does nothing when the user cancels the confirmation', async () => {
    await loadOptions();
    confirmSpy.mockReturnValue(false);

    chooseFile(JSON.stringify(createBackup({ bookmarks: [], folders: [], ignored: [] })));
    await vi.waitFor(() => expect(confirmSpy).toHaveBeenCalled());

    expect(importMessages()).toEqual([]);
    expect(el<HTMLParagraphElement>('#backupNote').hidden).toBe(true);
  });

  it('shows the background error when the import fails', async () => {
    sendMessage.mockImplementation((message, callback) => {
      callback(message.type === 'BOOKMARK_IMPORT' ? { ok: false, error: '背景沒有回應' } : { ok: true, completedTabs: [] });
    });
    await loadOptions();

    chooseFile(JSON.stringify(createBackup({ bookmarks: [], folders: [], ignored: [] })));
    await vi.waitFor(() => expect(el('#backupNote').textContent).toBe('匯入失敗：背景沒有回應'));

    expect(el('#backupNote').classList.contains('is-error')).toBe(true);
    expect(el<HTMLButtonElement>('#backupImport').disabled).toBe(false);
  });
});

describe('options Safari auto backup', () => {
  function sentTypes(): string[] {
    return sendMessage.mock.calls.map(([message]) => message.type);
  }

  it('hides the auto backup row and banner where it is not supported (Chrome)', async () => {
    nativeStatus = { available: false, lastBackupAt: null, pending: null };
    await loadOptions();
    await vi.waitFor(() => expect(sentTypes()).toContain('NATIVE_BACKUP_STATUS'));

    expect(el<HTMLDivElement>('#nativeBackupRow').hidden).toBe(true);
    expect(el<HTMLDivElement>('#nativeRestore').hidden).toBe(true);
  });

  it('shows when the last auto backup ran', async () => {
    nativeStatus = { available: true, lastBackupAt: Date.UTC(2026, 9, 2, 2, 30), pending: null };
    await loadOptions();

    await vi.waitFor(() => expect(el<HTMLDivElement>('#nativeBackupRow').hidden).toBe(false));
    expect(el('#nativeBackupStatus').textContent).toMatch(/^已開啟。上次自動備份：/);
    expect(el('#nativeBackupStatus').classList.contains('is-error')).toBe(false);
    expect(el<HTMLDivElement>('#nativeRestore').hidden).toBe(true);
  });

  it('tells the user to rebuild in Xcode when the native handler is outdated', async () => {
    nativeStatus = { available: false, error: '需要更新 Xcode 專案的原生程式：執行 npm run build 後在 Xcode 按 Run。', lastBackupAt: null, pending: null };
    await loadOptions();

    await vi.waitFor(() => expect(el<HTMLDivElement>('#nativeBackupRow').hidden).toBe(false));
    expect(el('#nativeBackupStatus').textContent).toBe('無法使用：需要更新 Xcode 專案的原生程式：執行 npm run build 後在 Xcode 按 Run。');
    expect(el('#nativeBackupStatus').classList.contains('is-error')).toBe(true);
  });

  it('offers to restore after the storage was wiped and reports the result in the banner', async () => {
    nativeStatus = { available: true, lastBackupAt: 4000, pending: { count: 18, savedAt: 4000 } };
    await loadOptions();

    await vi.waitFor(() => expect(el<HTMLDivElement>('#nativeRestore').hidden).toBe(false));
    expect(el('#nativeRestoreText').textContent).toContain('找到 18 筆書籤的自動備份');
    expect(el('#nativeBackupStatus').textContent).toBe('已暫停：等待你決定是否還原（見頁面上方）。');

    el<HTMLButtonElement>('#nativeRestoreApply').click();
    await vi.waitFor(() =>
      expect(el('#nativeRestoreText').textContent).toBe('已從自動備份還原 17 筆書籤，略過 1 筆已存在的書籤。自動備份已恢復。')
    );

    expect(sentTypes()).toContain('NATIVE_BACKUP_RESTORE');
    expect(el('#nativeRestore').classList.contains('is-done')).toBe(true);
    expect(el<HTMLButtonElement>('#nativeRestoreApply').hidden).toBe(true);
    expect(el('#nativeBackupStatus').textContent).toMatch(/^已開啟。上次自動備份：/);
  });

  it('asks before dismissing and resumes backups with the current data', async () => {
    nativeStatus = { available: true, lastBackupAt: 4000, pending: { count: 18, savedAt: 4000 } };
    await loadOptions();
    await vi.waitFor(() => expect(el<HTMLDivElement>('#nativeRestore').hidden).toBe(false));

    confirmSpy.mockReturnValueOnce(false);
    el<HTMLButtonElement>('#nativeRestoreDismiss').click();
    expect(sentTypes()).not.toContain('NATIVE_BACKUP_DISMISS');

    el<HTMLButtonElement>('#nativeRestoreDismiss').click();
    await vi.waitFor(() => expect(el<HTMLDivElement>('#nativeRestore').hidden).toBe(true));
    expect(confirmSpy).toHaveBeenLastCalledWith(expect.stringContaining('30 天'));
    expect(sentTypes()).toContain('NATIVE_BACKUP_DISMISS');
  });
});
