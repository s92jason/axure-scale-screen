import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, ZOOM_STEP } from '../shared/constants';
import type { ContentMessage, ContentResponse, ZoomLevel } from '../shared/types';
import { adjustZoom, toZoomLevel } from '../shared/zoom';

const statusEl = document.querySelector<HTMLParagraphElement>('#status');
const siteMetaEl = document.querySelector<HTMLParagraphElement>('#siteMeta');
const rangeEl = document.querySelector<HTMLInputElement>('#zoomRange');
const valueEl = document.querySelector<HTMLOutputElement>('#zoomValue');
const zoomInEl = document.querySelector<HTMLButtonElement>('#zoomIn');
const zoomOutEl = document.querySelector<HTMLButtonElement>('#zoomOut');
const resetEl = document.querySelector<HTMLButtonElement>('#reset');

if (!statusEl || !siteMetaEl || !rangeEl || !valueEl || !zoomInEl || !zoomOutEl || !resetEl) {
  throw new Error('找不到 Popup 必要的 UI 元件');
}

const status = statusEl;
const siteMeta = siteMetaEl;
const range = rangeEl;
const value = valueEl;
const zoomIn = zoomInEl;
const zoomOut = zoomOutEl;
const reset = resetEl;

let tabId: number | null = null;
let activeFrameId: number | null = null;
let isAxurePage = false;
let currentZoom = DEFAULT_ZOOM as ZoomLevel;

function shortenText(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }

  return `${input.slice(0, maxLength - 1)}…`;
}

function toDisplayUrl(urlKey: string): string {
  try {
    const parsed = new URL(urlKey);
    return shortenText(`${parsed.hostname}${parsed.pathname}`, 44);
  } catch {
    return shortenText(urlKey, 44);
  }
}

function updateSavedStateText(urlKey: string): void {
  status.textContent = '已儲存此頁倍率';
  siteMeta.textContent = toDisplayUrl(urlKey);
}

function clearSiteMeta(): void {
  siteMeta.textContent = '';
}

function setControlsDisabled(disabled: boolean): void {
  range.disabled = disabled;
  zoomIn.disabled = disabled;
  zoomOut.disabled = disabled;
  reset.disabled = disabled;
}

function updateZoomDisplay(zoom: ZoomLevel): void {
  currentZoom = zoom;
  range.value = String(zoom);
  value.value = String(zoom);
  const pct = ((zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100;
  range.style.setProperty('--zoom-pct', `${pct}%`);
}

function queryActiveTabId(): Promise<number | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0]?.id ?? null);
    });
  });
}

function sendToContent(message: ContentMessage, frameId?: number): Promise<ContentResponse> {
  return new Promise((resolve) => {
    if (tabId === null) {
      resolve({ ok: false, error: '找不到目前啟用的分頁' });
      return;
    }

    const callback = (response: ContentResponse | undefined): void => {
      if (chrome.runtime.lastError || !response) {
        resolve({ ok: false, error: chrome.runtime.lastError?.message ?? '內容腳本沒有回應' });
        return;
      }

      resolve(response);
    };

    if (frameId === undefined) {
      chrome.tabs.sendMessage(tabId, message, callback);
      return;
    }

    chrome.tabs.sendMessage(tabId, message, { frameId }, callback);
  });
}

function shouldRetryByInjection(errorText: string): boolean {
  const normalized = errorText.toLowerCase();
  return (
    normalized.includes('receiving end does not exist') ||
    normalized.includes('could not establish connection') ||
    normalized.includes('no content response') ||
    normalized.includes('內容腳本沒有回應')
  );
}

function isPermissionError(errorText: string): boolean {
  const normalized = errorText.toLowerCase();
  return (
    normalized.includes('cannot access') ||
    normalized.includes('not allowed') ||
    normalized.includes('permission') ||
    normalized.includes('access to the specified host is not allowed')
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function uniqueFrameIds(frameIds: number[]): number[] {
  return [...new Set(frameIds)].sort((a, b) => a - b);
}

function discoverFrameIds(): Promise<number[]> {
  return new Promise((resolve) => {
    if (tabId === null || !chrome.scripting?.executeScript) {
      resolve([]);
      return;
    }

    chrome.scripting.executeScript(
      {
        target: { tabId, allFrames: true },
        func: () => {
          return window.location.href;
        }
      },
      (results) => {
        if (chrome.runtime.lastError || !results) {
          resolve([]);
          return;
        }

        const frameIds = results
          .filter((item) => typeof item.frameId === 'number')
          .map((item) => item.frameId)
          .filter((value): value is number => typeof value === 'number');

        resolve(uniqueFrameIds(frameIds));
      }
    );
  });
}

function injectContentScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (tabId === null || !chrome.scripting?.executeScript) {
      resolve(false);
      return;
    }

    chrome.scripting.executeScript(
      {
        target: { tabId, allFrames: true },
        files: ['content.js']
      },
      () => {
        if (chrome.runtime.lastError) {
          resolve(false);
          return;
        }

        resolve(true);
      }
    );
  });
}

async function collectFrameStates(frameIds: number[]): Promise<Array<{ frameId: number; response: ContentResponse }>> {
  const targetFrames = uniqueFrameIds(frameIds.length > 0 ? frameIds : [0]);

  return Promise.all(
    targetFrames.map(async (frameId) => ({
      frameId,
      response: await sendToContent({ type: 'CONTENT_GET_STATE' }, frameId)
    }))
  );
}

async function loadAxureState(): Promise<
  | { ok: true; frameId: number; response: Extract<ContentResponse, { ok: true }> }
  | { ok: false; error: string; hasAnyContentResponse: boolean }
> {
  let candidates = await discoverFrameIds();
  if (candidates.length === 0) {
    candidates = [0];
  }

  let states = await collectFrameStates(candidates);
  let matched = states.find((item) => item.response.ok && item.response.data.isAxure);

  if (!matched) {
    const firstErrorItem = states.find(
      (item): item is { frameId: number; response: Extract<ContentResponse, { ok: false }> } => !item.response.ok
    );
    if (firstErrorItem && shouldRetryByInjection(firstErrorItem.response.error)) {
      const injected = await injectContentScript();
      if (injected) {
        await wait(120);
        candidates = await discoverFrameIds();
        if (candidates.length === 0) {
          candidates = [0];
        }
        states = await collectFrameStates(candidates);
        matched = states.find((item) => item.response.ok && item.response.data.isAxure);

        if (!matched) {
          await wait(180);
          states = await collectFrameStates(candidates);
          matched = states.find((item) => item.response.ok && item.response.data.isAxure);
        }
      }
    }
  }

  if (matched && matched.response.ok) {
    return { ok: true, frameId: matched.frameId, response: matched.response };
  }

  const firstErrorItem = states.find(
    (item): item is { frameId: number; response: Extract<ContentResponse, { ok: false }> } => !item.response.ok
  );
  const firstError = firstErrorItem?.response.error ?? '內容腳本沒有回應';
  const hasAnyContentResponse = states.some((item) => item.response.ok);
  return { ok: false, error: firstError, hasAnyContentResponse };
}

async function refreshState(): Promise<void> {
  const result = await loadAxureState();

  if (!result.ok) {
    activeFrameId = null;
    isAxurePage = false;
    clearSiteMeta();

    if (result.hasAnyContentResponse) {
      status.textContent = '此頁面未偵測到 Axure 容器。';
      setControlsDisabled(true);
      return;
    }

    if (isPermissionError(result.error)) {
      status.textContent = '目前沒有此網站存取權限，請到 Safari 外掛設定允許此網站後重試。';
      setControlsDisabled(true);
      return;
    }

    status.textContent = `此分頁尚未準備好 Axure 縮放功能（${result.error}）。請先重新整理頁面，並確認已允許此網站權限。`;
    setControlsDisabled(true);
    return;
  }

  activeFrameId = result.frameId;
  isAxurePage = result.response.data.isAxure;
  updateZoomDisplay(result.response.data.zoom);
  updateSavedStateText(result.response.data.urlKey);
  setControlsDisabled(false);
}

async function applyZoomFromInput(rawZoom: number): Promise<void> {
  if (!isAxurePage || activeFrameId === null) {
    return;
  }

  const response = await sendToContent({ type: 'CONTENT_SET_ZOOM', zoom: rawZoom }, activeFrameId);
  if (!response.ok) {
    status.textContent = `失敗：${response.error}`;
    clearSiteMeta();
    return;
  }

  updateZoomDisplay(response.data.zoom);
  updateSavedStateText(response.data.urlKey);
}

function bindEvents(): void {
  range.min = String(MIN_ZOOM);
  range.max = String(MAX_ZOOM);
  range.step = String(ZOOM_STEP);

  range.addEventListener('input', () => {
    const zoom = toZoomLevel(Number(range.value));
    updateZoomDisplay(zoom);
  });

  range.addEventListener('change', () => {
    void applyZoomFromInput(Number(range.value));
  });

  zoomOut.addEventListener('click', () => {
    const next = adjustZoom(currentZoom, -ZOOM_STEP);
    void applyZoomFromInput(next);
  });

  zoomIn.addEventListener('click', () => {
    const next = adjustZoom(currentZoom, ZOOM_STEP);
    void applyZoomFromInput(next);
  });

  reset.addEventListener('click', () => {
    if (activeFrameId === null) {
      return;
    }

    void sendToContent({ type: 'CONTENT_RESET_ZOOM' }, activeFrameId).then((response) => {
      if (!response.ok) {
        status.textContent = `失敗：${response.error}`;
        clearSiteMeta();
        return;
      }

      updateZoomDisplay(response.data.zoom);
      updateSavedStateText(response.data.urlKey);
    });
  });
}

async function bootstrap(): Promise<void> {
  setControlsDisabled(true);
  bindEvents();
  tabId = await queryActiveTabId();

  if (tabId === null) {
    status.textContent = '找不到目前啟用分頁。';
    clearSiteMeta();
    return;
  }

  await refreshState();
}

void bootstrap();
