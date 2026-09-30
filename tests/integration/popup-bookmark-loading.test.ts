import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_PREFIX } from '../../src/shared/constants';
import type { AxureBookmark, RuntimeMessage, RuntimeResponse } from '../../src/shared/types';

const popupHtml = readFileSync(resolve('popup.html'), 'utf8');
const itemsKey = `${STORAGE_PREFIX}bm::items`;
const savedBookmark: AxureBookmark = {
  projectKey: 'axshare:saved',
  name: '已收藏的原型',
  url: 'https://saved.axshare.com/',
  folder: '進行中',
  createdAt: 1,
  lastVisitedAt: null,
  visitCount: 0
};

function browserEvent<Args extends unknown[]>() {
  const listeners = new Set<(...args: Args) => void>();
  return {
    addListener: vi.fn((listener: (...args: Args) => void) => listeners.add(listener)),
    removeListener: vi.fn((listener: (...args: Args) => void) => listeners.delete(listener)),
    emit: (...args: Args) => listeners.forEach((listener) => listener(...args))
  };
}

let storedItems: Record<string, AxureBookmark>;
let readError: string | undefined;
let holdRead: boolean;
let pendingRead: ((result: Record<string, unknown>) => void) | undefined;
let runtime: { id: string; lastError: { message: string } | undefined; sendMessage: ReturnType<typeof vi.fn> };
let storageGet: ReturnType<typeof vi.fn>;
let onActivated: ReturnType<typeof browserEvent<[chrome.tabs.OnActivatedInfo]>>;
let onUpdated: ReturnType<typeof browserEvent<[number, chrome.tabs.OnUpdatedInfo, chrome.tabs.Tab]>>;
let onCreated: ReturnType<typeof browserEvent<[chrome.tabs.Tab]>>;
let onRemoved: ReturnType<typeof browserEvent<[number, chrome.tabs.OnRemovedInfo]>>;
let onChanged: ReturnType<typeof browserEvent<[Record<string, chrome.storage.StorageChange>, string]>>;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  document.body.innerHTML = new DOMParser().parseFromString(popupHtml, 'text/html').body.innerHTML;
  storedItems = { [savedBookmark.projectKey]: { ...savedBookmark } };
  readError = undefined;
  holdRead = false;
  pendingRead = undefined;
  runtime = {
    id: 'safari-test-extension',
    lastError: undefined,
    sendMessage: vi.fn((_message: RuntimeMessage, callback: (response: RuntimeResponse) => void) => {
      callback({ ok: false, error: '背景沒有回應' });
    })
  };
  storageGet = vi.fn((key: string, callback: (result: Record<string, unknown>) => void) => {
    if (holdRead) {
      pendingRead = callback;
      return;
    }
    runtime.lastError = readError ? { message: readError } : undefined;
    try {
      callback(readError ? {} : { [key]: storedItems });
    } finally {
      runtime.lastError = undefined;
    }
  });
  onActivated = browserEvent();
  onUpdated = browserEvent();
  onCreated = browserEvent();
  onRemoved = browserEvent();
  onChanged = browserEvent();
  vi.stubGlobal('chrome', {
    runtime,
    tabs: {
      query: vi.fn((_query: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) => callback([])),
      onActivated,
      onUpdated,
      onCreated,
      onRemoved
    },
    storage: { local: { get: storageGet }, onChanged }
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function loadPopup(): Promise<void> {
  await import('../../src/popup/main');
  await vi.dynamicImportSettled();
}

async function settle(): Promise<void> {
  await vi.dynamicImportSettled();
}

function loadStatus(): HTMLElement {
  return document.querySelector<HTMLElement>('#bmLoadStatus')!;
}

function retryButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('#bmRetry')!;
}

function emptyHint(): HTMLElement {
  return document.querySelector<HTMLElement>('#bmEmpty')!;
}

function expectSavedBookmark(): void {
  expect(document.querySelectorAll('#bmList .bm-row')).toHaveLength(1);
  expect(document.querySelector('#bmList .bm-name')!.textContent).toBe(savedBookmark.name);
  expect(emptyHint().hidden).toBe(true);
  expect(loadStatus().hidden).toBe(true);
  expect(retryButton().hidden).toBe(true);
}

describe('popup bookmark loading', () => {
  it('reads existing bookmarks directly while the background reports an error', async () => {
    await loadPopup();

    expectSavedBookmark();
    expect(storageGet).toHaveBeenCalledWith(itemsKey, expect.any(Function));
    expect(runtime.sendMessage).not.toHaveBeenCalledWith({ type: 'BOOKMARK_GET_ALL' }, expect.any(Function));
  });

  it('reads existing bookmarks without waiting for a background response', async () => {
    runtime.sendMessage.mockImplementation(() => {});

    await loadPopup();

    expectSavedBookmark();
  });

  it.each([
    ['tabs', 'onActivated'],
    ['tabs', 'onUpdated'],
    ['tabs', 'onCreated'],
    ['tabs', 'onRemoved'],
    ['storage', 'onChanged']
  ] as const)('reads bookmarks when %s.%s is unavailable', async (namespace, eventName) => {
    Reflect.deleteProperty(namespace === 'tabs' ? chrome.tabs : chrome.storage, eventName);

    await loadPopup();

    expectSavedBookmark();
  });

  it('starts the storage read before browser event registration can fail', async () => {
    onActivated.addListener.mockImplementation(() => {
      expect(storageGet).toHaveBeenCalledWith(itemsKey, expect.any(Function));
      throw new Error('無法註冊頁籤事件');
    });
    onChanged.addListener.mockImplementation(() => {
      throw new Error('無法註冊 storage 事件');
    });

    await loadPopup();

    expectSavedBookmark();
    expect(onActivated.addListener).toHaveBeenCalled();
  });

  it('reads bookmarks when a browser event getter throws', async () => {
    Object.defineProperty(chrome.tabs, 'onActivated', {
      configurable: true,
      get: () => {
        throw new Error('頁籤事件不可用');
      }
    });

    await loadPopup();

    expectSavedBookmark();
  });

  it('shows a loading status and hides the empty hint before the first successful read', async () => {
    holdRead = true;

    await loadPopup();

    expect(loadStatus().getAttribute('role')).toBe('status');
    expect(loadStatus().hidden).toBe(false);
    expect(loadStatus().textContent).toBe('正在讀取書籤…');
    expect(emptyHint().hidden).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('#bmAdd')!.disabled).toBe(true);

    pendingRead!({ [itemsKey]: storedItems });
    await settle();
    expectSavedBookmark();
  });

  it('shows a storage error and retries without treating the failed read as an empty collection', async () => {
    readError = '無法讀取書籤資料';

    await loadPopup();

    expect(loadStatus().hidden).toBe(false);
    expect(loadStatus().textContent).toContain('書籤讀取失敗：無法讀取書籤資料');
    expect(retryButton().hidden).toBe(false);
    expect(emptyHint().hidden).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('#bmAdd')!.disabled).toBe(true);
    expect(document.querySelectorAll('#bmList .bm-row')).toHaveLength(0);

    readError = undefined;
    retryButton().click();
    await settle();

    expectSavedBookmark();
    expect(storageGet).toHaveBeenCalledTimes(2);
  });

  it('shows a retryable error when storage never invokes its callback', async () => {
    holdRead = true;
    await loadPopup();

    await vi.advanceTimersByTimeAsync(5000);

    expect(loadStatus().hidden).toBe(false);
    expect(loadStatus().textContent).toContain('書籤讀取失敗：本機資料讀取逾時');
    expect(retryButton().hidden).toBe(false);
    expect(emptyHint().hidden).toBe(true);

    holdRead = false;
    retryButton().click();
    await settle();

    expectSavedBookmark();
  });

  it('keeps adding disabled on an active Axure page until the failed initial read succeeds', async () => {
    readError = '無法讀取書籤資料';
    Object.assign(chrome.tabs, {
      query: vi.fn((_query: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) => {
        callback([{ id: 9, url: 'https://new.axshare.com/', title: '新原型' } as chrome.tabs.Tab]);
      }),
      sendMessage: vi.fn((
        _tabId: number,
        _message: unknown,
        _options: unknown,
        callback: (response: unknown) => void
      ) => callback({ ok: true, data: { isAxure: true, zoom: 100, urlKey: 'https://new.axshare.com/' } }))
    });

    await loadPopup();

    expect(document.querySelector<HTMLElement>('#zoomLive')!.hidden).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('#bmAdd')!.disabled).toBe(true);
    expect(loadStatus().textContent).toContain('書籤讀取失敗');

    readError = undefined;
    retryButton().click();
    await settle();

    expectSavedBookmark();
    expect(document.querySelector<HTMLButtonElement>('#bmAdd')!.disabled).toBe(false);
  });

  it('retains the displayed bookmarks when a storage change reload fails', async () => {
    await loadPopup();
    const row = document.querySelector('#bmList .bm-row');
    readError = '暫時無法讀取';
    onChanged.emit({ [itemsKey]: { newValue: {} } }, 'local');
    await settle();

    expect(storageGet).toHaveBeenCalledTimes(2);
    expect(document.querySelector('#bmList .bm-row')).toBe(row);
    expect(document.querySelector('#bmList .bm-name')!.textContent).toBe(savedBookmark.name);
    expect(emptyHint().hidden).toBe(true);
    expect(loadStatus().hidden).toBe(false);
    expect(loadStatus().textContent).toContain('書籤讀取失敗：暫時無法讀取');
    expect(retryButton().hidden).toBe(false);
  });

  it('shows the empty hint only after a successful empty read', async () => {
    storedItems = {};

    await loadPopup();

    expect(document.querySelectorAll('#bmList .bm-row')).toHaveLength(0);
    expect(emptyHint().hidden).toBe(false);
    expect(loadStatus().hidden).toBe(true);
    expect(retryButton().hidden).toBe(true);
  });

  it('does not restore the empty hint while filtering after a failed reload', async () => {
    storedItems = {};
    await loadPopup();
    expect(emptyHint().hidden).toBe(false);
    readError = '暫時無法讀取';
    onChanged.emit({ [itemsKey]: { newValue: {} } }, 'local');
    await settle();

    const search = document.querySelector<HTMLInputElement>('#bmSearch')!;
    search.value = '原型';
    search.dispatchEvent(new Event('input'));

    expect(emptyHint().hidden).toBe(true);
    expect(loadStatus().hidden).toBe(false);
    expect(loadStatus().textContent).toContain('書籤讀取失敗：暫時無法讀取');
  });
});
