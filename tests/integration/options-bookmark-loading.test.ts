import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_PREFIX } from '../../src/shared/constants';
import type { AxureBookmark, RuntimeMessage, RuntimeResponse } from '../../src/shared/types';

const optionsHtml = readFileSync(resolve('options.html'), 'utf8');
const itemsKey = `${STORAGE_PREFIX}bm::items`;
const foldersKey = `${STORAGE_PREFIX}bm::folders`;
const ignoredKey = `${STORAGE_PREFIX}bm::ignored`;
const settingsKey = `${STORAGE_PREFIX}bm::settings`;
const savedBookmark: AxureBookmark = {
  projectKey: 'axshare:retained',
  name: '原本的書籤',
  url: 'https://retained.axshare.com/',
  folder: '進行中',
  createdAt: 1,
  lastVisitedAt: null,
  visitCount: 2
};

let storedData: Record<string, unknown>;
let failedKey: string | null;
let deferredKeys: Set<string>;
let callbacks: Map<string, (data: Record<string, unknown>) => void>;
let storageListeners: Array<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>;
let sendMessage: ReturnType<typeof vi.fn<(message: RuntimeMessage, callback: (response?: RuntimeResponse) => void) => void>>;
let getStorage: ReturnType<typeof vi.fn<(key: string, callback: (data: Record<string, unknown>) => void) => void>>;
let setStorage: ReturnType<typeof vi.fn>;
let removeStorage: ReturnType<typeof vi.fn>;
let runtime: { lastError?: { message: string }; sendMessage: typeof sendMessage };

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  document.body.innerHTML = new DOMParser().parseFromString(optionsHtml, 'text/html').body.innerHTML;
  storedData = {
    [itemsKey]: { [savedBookmark.projectKey]: savedBookmark },
    [foldersKey]: ['進行中'],
    [ignoredKey]: ['axshare:ignored'],
    [settingsKey]: { promptMode: 'badge', chromeSync: { enabled: false, parentFolderId: null } }
  };
  failedKey = null;
  deferredKeys = new Set();
  callbacks = new Map();
  storageListeners = [];
  const event = () => ({ addListener: vi.fn(), removeListener: vi.fn() });
  sendMessage = vi.fn((_message, callback) => {
    runtime.lastError = { message: '背景無法啟動' };
    callback();
    runtime.lastError = undefined;
  });
  runtime = { sendMessage };
  getStorage = vi.fn((key, callback) => {
    if (deferredKeys.has(key)) {
      callbacks.set(key, callback);
      return;
    }
    runtime.lastError = key === failedKey ? { message: 'storage 暫時無法讀取' } : undefined;
    callback({ [key]: structuredClone(storedData[key]) });
    runtime.lastError = undefined;
  });
  setStorage = vi.fn();
  removeStorage = vi.fn();
  vi.stubGlobal('chrome', {
    runtime,
    tabs: { onCreated: event(), onRemoved: event(), onUpdated: event() },
    storage: {
      local: { get: getStorage, set: setStorage, remove: removeStorage },
      onChanged: {
        addListener: vi.fn((listener) => { storageListeners.push(listener); }),
        removeListener: vi.fn()
      }
    }
  });
  vi.spyOn(navigator, 'vendor', 'get').mockReturnValue('Apple Computer, Inc.');
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function loadOptions(): Promise<void> {
  await import('../../src/options/main');
  await vi.dynamicImportSettled();
}

function status(): HTMLParagraphElement {
  return document.querySelector<HTMLParagraphElement>('#bookmarkLoadStatus')!;
}

function retry(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('#bookmarkRetry')!;
}

function empty(): HTMLParagraphElement {
  return document.querySelector<HTMLParagraphElement>('#empty')!;
}

describe('options stored bookmark loading', () => {
  it('shows existing local bookmarks, groups, ignored projects and settings when background messaging fails', async () => {
    await loadOptions();

    expect(document.querySelector('#rows .link')!.textContent).toBe(savedBookmark.name);
    expect(empty().hidden).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('#export')!.disabled).toBe(false);
    expect(document.querySelector<HTMLDivElement>('#bookmarkLoadFeedback')!.hidden).toBe(true);
    expect([...document.querySelectorAll('#folderList .folder-name')].map((element) => element.textContent))
      .toEqual(['進行中（1）', '已完成（0）']);
    expect(document.querySelector('#ignoredList span')!.textContent).toBe('axshare:ignored');
    expect(document.querySelector<HTMLSelectElement>('#promptMode')!.value).toBe('badge');
    expect(sendMessage.mock.calls.map(([message]) => message.type)).not.toContain('BOOKMARK_GET_ALL');
    expect(setStorage).not.toHaveBeenCalled();
    expect(removeStorage).not.toHaveBeenCalled();
  });

  it('shows bookmarks before unrelated storage reads resolve even when the background never replies', async () => {
    sendMessage.mockImplementation(() => {});
    deferredKeys = new Set([foldersKey, ignoredKey, settingsKey]);

    await loadOptions();

    expect(document.querySelector('#rows .link')!.textContent).toBe(savedBookmark.name);
    expect(document.querySelector<HTMLButtonElement>('#export')!.disabled).toBe(false);
    expect(empty().hidden).toBe(true);
    expect(callbacks.size).toBe(3);
    for (const [key, callback] of callbacks) {
      callback({ [key]: structuredClone(storedData[key]) });
    }
    await vi.dynamicImportSettled();
  });

  it('continues loading when optional event APIs are absent or throw during registration', async () => {
    vi.stubGlobal('chrome', {
      runtime,
      tabs: {},
      storage: {
        local: { get: getStorage, set: setStorage, remove: removeStorage },
        onChanged: { addListener: () => { throw new Error('event unavailable'); } }
      }
    });

    await loadOptions();

    expect(document.querySelector('#rows .link')!.textContent).toBe(savedBookmark.name);
    expect(empty().hidden).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('#export')!.disabled).toBe(false);
  });

  it('distinguishes a storage read failure from a successful empty list and retries without writing storage', async () => {
    failedKey = itemsKey;

    await loadOptions();

    expect(status().textContent).toContain('書籤讀取失敗');
    expect(retry().hidden).toBe(false);
    expect(empty().hidden).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('#export')!.disabled).toBe(true);
    failedKey = null;
    retry().click();
    await vi.dynamicImportSettled();
    expect(document.querySelector('#rows .link')!.textContent).toBe(savedBookmark.name);
    expect(retry().hidden).toBe(true);
    expect(setStorage).not.toHaveBeenCalled();
    expect(removeStorage).not.toHaveBeenCalled();
  });

  it('retains displayed bookmarks after a failed refresh instead of replacing them with an empty list', async () => {
    await loadOptions();
    failedKey = itemsKey;

    for (const listener of storageListeners) {
      listener({ [itemsKey]: {} }, 'local');
    }
    await vi.advanceTimersByTimeAsync(150);

    expect(document.querySelector('#rows .link')!.textContent).toBe(savedBookmark.name);
    expect(status().textContent).toContain('書籤讀取失敗');
    expect(empty().hidden).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('#export')!.disabled).toBe(false);
  });

  it('keeps the empty state hidden after an empty read is followed by a failed refresh and a filter change', async () => {
    storedData[itemsKey] = {};
    await loadOptions();
    expect(empty().hidden).toBe(false);
    failedKey = itemsKey;
    for (const listener of storageListeners) {
      listener({ [itemsKey]: {} }, 'local');
    }
    await vi.advanceTimersByTimeAsync(150);

    const search = document.querySelector<HTMLInputElement>('#search')!;
    search.value = '測試';
    search.dispatchEvent(new Event('input'));
    document.querySelector<HTMLSelectElement>('#sort')!.dispatchEvent(new Event('change'));

    expect(status().textContent).toContain('書籤讀取失敗');
    expect(empty().hidden).toBe(true);
  });

  it('shows the empty state only after local storage successfully returns an empty collection', async () => {
    storedData[itemsKey] = {};
    deferredKeys.add(itemsKey);
    await loadOptions();
    expect(empty().hidden).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('#export')!.disabled).toBe(true);

    callbacks.get(itemsKey)!({ [itemsKey]: {} });
    await vi.dynamicImportSettled();

    expect(empty().hidden).toBe(false);
    expect(document.querySelector<HTMLDivElement>('#bookmarkLoadFeedback')!.hidden).toBe(true);
    expect(retry().hidden).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('#export')!.disabled).toBe(false);
  });
});
