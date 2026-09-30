import { STORAGE_PREFIX } from '../shared/constants';
import type { CompletedAxureTab, RuntimeMessage, RuntimeResponse } from '../shared/types';
import './style.css';

function send(message: RuntimeMessage): Promise<RuntimeResponse> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response: RuntimeResponse | undefined) => {
        const error = chrome.runtime.lastError;
        resolve(error || !response
          ? { ok: false, error: error?.message ?? '背景沒有回應' }
          : response);
      });
    } catch (error) {
      resolve({ ok: false, error: error instanceof Error ? error.message : '背景沒有回應' });
    }
  });
}

function locationLabel(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'file:' ? url.pathname : `${url.hostname}${url.pathname}`;
  } catch {
    return '';
  }
}

// popup、側欄與管理頁共用的清理介面；關閉範圍固定為使用者看到的清單。
export function mountTabCleanup(
  root: HTMLElement,
  options: { compact?: boolean; onCandidatesChange?: (count: number) => void } = {}
): () => void {
  root.classList.add('tab-cleanup');
  root.innerHTML = `
    <div class="tab-cleanup-head">
      <h2>清理 Axure 頁籤</h2>
      <button type="button" class="tab-cleanup-refresh">重新檢查</button>
    </div>
    <p class="tab-cleanup-description">${options.compact ? '所有視窗・「已完成」專案' : '檢查所有視窗中屬於「已完成」專案的頁籤。'}</p>
    <p class="tab-cleanup-status" role="status" aria-live="polite">正在檢查頁籤…</p>
    <ul class="tab-cleanup-list" aria-label="建議關閉的已完成頁籤" hidden></ul>
    <button type="button" class="tab-cleanup-close" disabled>一鍵關閉全部</button>
  `;
  const refresh = root.querySelector<HTMLButtonElement>('.tab-cleanup-refresh')!;
  const close = root.querySelector<HTMLButtonElement>('.tab-cleanup-close')!;
  const status = root.querySelector<HTMLParagraphElement>('.tab-cleanup-status')!;
  const list = root.querySelector<HTMLUListElement>('.tab-cleanup-list')!;
  let candidates: CompletedAxureTab[] = [];
  let busy = false;
  let disposed = false;
  let reloadPending = false;
  let timer: number | undefined;
  let notice = '';

  function updateStatus(text: string): void {
    status.textContent = text;
    status.title = text;
  }

  function render(): void {
    list.replaceChildren();
    list.hidden = candidates.length === 0;
    for (const tab of candidates) {
      const row = document.createElement('li');
      row.dataset.tabId = String(tab.tabId);
      const name = document.createElement('strong');
      name.textContent = tab.name;
      const detail = document.createElement('span');
      detail.textContent = tab.title || locationLabel(tab.url);
      const location = document.createElement('small');
      location.textContent = locationLabel(tab.url);
      row.append(name, detail, location);
      list.appendChild(row);
    }
    close.textContent = candidates.length > 0
      ? `一鍵關閉 ${candidates.length} 個頁籤`
      : '一鍵關閉全部';
    close.disabled = busy || candidates.length === 0;
    refresh.disabled = busy;
    root.setAttribute('aria-busy', String(busy));
    options.onCandidatesChange?.(candidates.length);
  }

  function summary(): string {
    return candidates.length > 0
      ? `有 ${candidates.length} 個已完成頁籤，建議關閉。`
      : '目前沒有建議關閉的已完成頁籤。';
  }

  function finish(): void {
    busy = false;
    render();
    if (reloadPending) {
      reloadPending = false;
      scheduleRefresh();
    }
  }

  async function scan(preserveNotice = false): Promise<void> {
    if (busy || disposed) {
      return;
    }
    if (!preserveNotice) {
      notice = '';
    }
    busy = true;
    render();
    updateStatus('正在檢查頁籤…');
    const response = await send({ type: 'AXURE_GET_COMPLETED_TABS' });
    if (disposed) {
      return;
    }
    if (response.ok) {
      candidates = response.completedTabs ?? [];
      updateStatus(`${notice}${summary()}`);
    } else {
      candidates = [];
      updateStatus(`${notice}檢查失敗：${response.error}`);
    }
    finish();
  }

  async function closeAll(): Promise<void> {
    if (busy || candidates.length === 0 || disposed) {
      return;
    }
    const tabIds = candidates.map((tab) => tab.tabId);
    busy = true;
    notice = '';
    window.clearTimeout(timer);
    render();
    updateStatus('正在關閉已完成頁籤…');
    const response = await send({ type: 'AXURE_CLOSE_COMPLETED_TABS', tabIds });
    if (disposed) {
      return;
    }
    candidates = response.completedTabs ?? [];
    notice = response.ok
      ? `已關閉 ${response.closedCount ?? 0} 個頁籤。`
      : `${response.closedCount ? `已關閉 ${response.closedCount} 個頁籤。` : ''}關閉失敗：${response.error}。`;
    updateStatus(`${notice}${response.completedTabs ? summary() : ''}`);
    finish();
    if (!response.completedTabs) {
      void scan(true);
    }
  }

  function scheduleRefresh(): void {
    if (disposed) {
      return;
    }
    if (busy) {
      reloadPending = true;
      return;
    }
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void scan(true), 150);
  }

  function onUpdated(_tabId: number, info: chrome.tabs.OnUpdatedInfo): void {
    if (typeof info.url === 'string' || info.status) {
      scheduleRefresh();
    }
  }

  function onStorageChanged(changes: Record<string, chrome.storage.StorageChange>, area: string): void {
    if (area === 'local' && Object.keys(changes).some((key) => key.startsWith(`${STORAGE_PREFIX}bm::`))) {
      scheduleRefresh();
    }
  }

  refresh.addEventListener('click', () => void scan());
  close.addEventListener('click', () => void closeAll());
  chrome.tabs.onCreated.addListener(scheduleRefresh);
  chrome.tabs.onRemoved.addListener(scheduleRefresh);
  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.storage.onChanged.addListener(onStorageChanged);
  void scan();

  return () => {
    disposed = true;
    window.clearTimeout(timer);
    chrome.tabs.onCreated.removeListener(scheduleRefresh);
    chrome.tabs.onRemoved.removeListener(scheduleRefresh);
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.storage.onChanged.removeListener(onStorageChanged);
  };
}
