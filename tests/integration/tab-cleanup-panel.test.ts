import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_PREFIX } from '../../src/shared/constants';
import type { CompletedAxureTab, RuntimeMessage, RuntimeResponse } from '../../src/shared/types';
import { mountTabCleanup } from '../../src/tab-cleanup/panel';

function chromeEvent<Args extends unknown[]>() {
  const listeners = new Set<(...args: Args) => void>();
  return {
    addListener: vi.fn((listener: (...args: Args) => void) => listeners.add(listener)),
    removeListener: vi.fn((listener: (...args: Args) => void) => listeners.delete(listener)),
    emit: (...args: Args) => listeners.forEach((listener) => listener(...args)),
    listeners
  };
}

const firstTab: CompletedAxureTab = {
  tabId: 12,
  projectKey: 'axshare:finished',
  name: '完成的原型',
  title: '登入頁',
  url: 'https://finished.axshare.com/login.html#p=login'
};
const secondTab: CompletedAxureTab = {
  tabId: 27,
  projectKey: 'axshare:finished',
  name: '完成的原型',
  title: '帳戶頁',
  url: 'https://finished.axshare.com/account.html'
};

let root: HTMLElement;
let dispose: (() => void) | undefined;
let scanResponse: RuntimeResponse;
let closeResponse: RuntimeResponse;
let holdClose: boolean;
let pendingClose: ((response: RuntimeResponse) => void) | undefined;
let onCreated: ReturnType<typeof chromeEvent<[chrome.tabs.Tab]>>;
let onRemoved: ReturnType<typeof chromeEvent<[number, chrome.tabs.OnRemovedInfo]>>;
let onUpdated: ReturnType<typeof chromeEvent<[number, chrome.tabs.OnUpdatedInfo, chrome.tabs.Tab]>>;
let onChanged: ReturnType<typeof chromeEvent<[Record<string, chrome.storage.StorageChange>, string]>>;
let sendMessage: ReturnType<typeof vi.fn<(message: RuntimeMessage, callback: (response: RuntimeResponse) => void) => void>>;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<section id="cleanup"></section>';
  root = document.getElementById('cleanup')!;
  scanResponse = { ok: true, completedTabs: [firstTab, secondTab] };
  closeResponse = { ok: true, closedCount: 2, completedTabs: [] };
  holdClose = false;
  pendingClose = undefined;
  onCreated = chromeEvent();
  onRemoved = chromeEvent();
  onUpdated = chromeEvent();
  onChanged = chromeEvent();
  sendMessage = vi.fn((message, callback) => {
    if (message.type === 'AXURE_CLOSE_COMPLETED_TABS') {
      if (holdClose) {
        pendingClose = callback;
      } else {
        callback(closeResponse);
      }
    } else {
      callback(scanResponse);
    }
  });
  vi.stubGlobal('chrome', {
    runtime: { sendMessage },
    tabs: { onCreated, onRemoved, onUpdated },
    storage: { onChanged }
  });
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

async function mount(): Promise<void> {
  dispose = mountTabCleanup(root);
  await Promise.resolve();
}

function closeButton(): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>('.tab-cleanup-close')!;
}

function status(): string {
  return root.querySelector('.tab-cleanup-status')!.textContent!;
}

describe('completed Axure tab cleanup panel', () => {
  it('previews the completed projects and their pages before offering to close them', async () => {
    await mount();

    expect(sendMessage).toHaveBeenCalledWith({ type: 'AXURE_GET_COMPLETED_TABS' }, expect.any(Function));
    expect(status()).toContain('2 個已完成頁籤');
    expect(root.querySelectorAll('li')).toHaveLength(2);
    expect(root.querySelector('li')!.textContent).toContain('完成的原型登入頁');
    expect(root.querySelector('li')!.textContent).toContain('finished.axshare.com/login.html');
    expect(closeButton().textContent).toBe('一鍵關閉 2 個頁籤');
    expect(closeButton().disabled).toBe(false);
  });

  it('requests only the tab IDs shown in the preview and uses the actual closed count', async () => {
    closeResponse = { ok: true, closedCount: 1, completedTabs: [secondTab] };
    await mount();

    closeButton().click();
    await Promise.resolve();

    expect(sendMessage).toHaveBeenLastCalledWith(
      { type: 'AXURE_CLOSE_COMPLETED_TABS', tabIds: [12, 27] },
      expect.any(Function)
    );
    expect(status()).toContain('已關閉 1 個頁籤');
    expect(status()).toContain('1 個已完成頁籤');
    expect(root.querySelectorAll('li')).toHaveLength(1);
    expect(root.querySelector('li')!.dataset.tabId).toBe('27');
  });

  it('disables closing when no completed tabs are open', async () => {
    scanResponse = { ok: true, completedTabs: [] };
    await mount();

    expect(status()).toContain('目前沒有建議關閉');
    expect(root.querySelector<HTMLUListElement>('ul')!.hidden).toBe(true);
    expect(closeButton().disabled).toBe(true);
    closeButton().click();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('waits for the close result and prevents duplicate requests while closing', async () => {
    holdClose = true;
    await mount();

    closeButton().click();
    closeButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(closeButton().disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('.tab-cleanup-refresh')!.disabled).toBe(true);
    expect(status()).toBe('正在關閉已完成頁籤…');
    expect(root.querySelectorAll('li')).toHaveLength(2);
    expect(sendMessage).toHaveBeenCalledTimes(2);

    pendingClose!({ ok: true, closedCount: 2, completedTabs: [] });
    await Promise.resolve();

    expect(status()).toContain('已關閉 2 個頁籤');
    expect(root.querySelectorAll('li')).toHaveLength(0);
    expect(closeButton().disabled).toBe(true);
  });

  it('reports a failed close and retains the remaining tabs instead of showing optimistic success', async () => {
    closeResponse = { ok: false, error: '沒有關閉頁籤的權限', closedCount: 0, completedTabs: [firstTab, secondTab] };
    await mount();

    closeButton().click();
    await Promise.resolve();

    expect(status()).toContain('關閉失敗：沒有關閉頁籤的權限');
    expect(status()).not.toContain('已關閉');
    expect(root.querySelectorAll('li')).toHaveLength(2);
    expect(closeButton().disabled).toBe(false);
  });

  it('shows partial completion with the failure and offers only the remaining tabs', async () => {
    closeResponse = { ok: false, error: '第二個頁籤無法關閉', closedCount: 1, completedTabs: [secondTab] };
    await mount();

    closeButton().click();
    await Promise.resolve();

    expect(status()).toContain('已關閉 1 個頁籤');
    expect(status()).toContain('關閉失敗：第二個頁籤無法關閉');
    closeButton().click();
    expect(sendMessage).toHaveBeenLastCalledWith(
      { type: 'AXURE_CLOSE_COMPLETED_TABS', tabIds: [27] },
      expect.any(Function)
    );
  });

  it('clears stale recommendations after a failed scan', async () => {
    await mount();
    scanResponse = { ok: false, error: '讀取頁籤失敗' };

    root.querySelector<HTMLButtonElement>('.tab-cleanup-refresh')!.click();
    await Promise.resolve();

    expect(status()).toContain('檢查失敗：讀取頁籤失敗');
    expect(root.querySelectorAll('li')).toHaveLength(0);
    expect(closeButton().disabled).toBe(true);
  });

  it('debounces relevant tab and bookmark changes and ignores unrelated changes', async () => {
    await mount();
    onUpdated.emit(12, { title: '只變更標題' }, { id: 12 } as chrome.tabs.Tab);
    onChanged.emit({ unrelated: { newValue: 'value' } }, 'local');
    onChanged.emit({ [`${STORAGE_PREFIX}bm::folders`]: { newValue: [] } }, 'sync');
    await vi.advanceTimersByTimeAsync(200);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    onCreated.emit({ id: 30 } as chrome.tabs.Tab);
    onRemoved.emit(12, { windowId: 1, isWindowClosing: false });
    onUpdated.emit(27, { url: 'https://finished.axshare.com/new.html' }, { id: 27 } as chrome.tabs.Tab);
    onChanged.emit({ [`${STORAGE_PREFIX}bm::folders`]: { newValue: ['已完成'] } }, 'local');
    await vi.advanceTimersByTimeAsync(149);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    scanResponse = { ok: true, completedTabs: [secondTab] };
    await vi.advanceTimersByTimeAsync(1);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(root.querySelectorAll('li')).toHaveLength(1);
  });

  it('queues a refresh when a tab changes during a close request', async () => {
    holdClose = true;
    await mount();
    closeButton().click();
    onRemoved.emit(12, { windowId: 1, isWindowClosing: false });
    await vi.advanceTimersByTimeAsync(200);
    expect(sendMessage).toHaveBeenCalledTimes(2);

    scanResponse = { ok: true, completedTabs: [] };
    pendingClose!({ ok: true, closedCount: 2, completedTabs: [] });
    await vi.advanceTimersByTimeAsync(150);

    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(status()).toContain('已關閉 2 個頁籤');
    expect(status()).toContain('目前沒有建議關閉');
  });

  it('removes browser listeners and cancels queued refreshes when disposed', async () => {
    await mount();
    onCreated.emit({ id: 30 } as chrome.tabs.Tab);

    dispose!();
    onCreated.emit({ id: 31 } as chrome.tabs.Tab);
    await vi.advanceTimersByTimeAsync(200);

    expect(onCreated.listeners.size).toBe(0);
    expect(onRemoved.listeners.size).toBe(0);
    expect(onUpdated.listeners.size).toBe(0);
    expect(onChanged.listeners.size).toBe(0);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('renders project names and titles as text', async () => {
    const name = '<img src=x onerror=alert(1)>';
    const title = '<script>alert(2)</script>';
    scanResponse = { ok: true, completedTabs: [{ ...firstTab, name, title }] };
    await mount();

    expect(root.querySelector('strong')!.textContent).toBe(name);
    expect(root.querySelector('li span')!.textContent).toBe(title);
    expect(root.querySelector('img, script')).toBeNull();
  });
});
