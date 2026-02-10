import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, ZOOM_STEP } from '@shared/constants';
import type { ContentMessage, ContentResponse, ZoomLevel } from '@shared/types';
import { adjustZoom, toZoomLevel } from '@shared/zoom';

const statusEl = document.querySelector<HTMLParagraphElement>('#status');
const rangeEl = document.querySelector<HTMLInputElement>('#zoomRange');
const valueEl = document.querySelector<HTMLOutputElement>('#zoomValue');
const zoomInEl = document.querySelector<HTMLButtonElement>('#zoomIn');
const zoomOutEl = document.querySelector<HTMLButtonElement>('#zoomOut');
const resetEl = document.querySelector<HTMLButtonElement>('#reset');

if (!statusEl || !rangeEl || !valueEl || !zoomInEl || !zoomOutEl || !resetEl) {
  throw new Error('Popup UI elements are missing');
}

let tabId: number | null = null;
let isAxurePage = false;
let currentZoom = DEFAULT_ZOOM as ZoomLevel;

function setControlsDisabled(disabled: boolean): void {
  rangeEl.disabled = disabled;
  zoomInEl.disabled = disabled;
  zoomOutEl.disabled = disabled;
  resetEl.disabled = disabled;
}

function updateZoomDisplay(zoom: ZoomLevel): void {
  currentZoom = zoom;
  rangeEl.value = String(zoom);
  valueEl.value = `${zoom}%`;
}

function queryActiveTabId(): Promise<number | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0]?.id ?? null);
    });
  });
}

function sendToContent(message: ContentMessage): Promise<ContentResponse> {
  return new Promise((resolve) => {
    if (tabId === null) {
      resolve({ ok: false, error: 'No active tab found' });
      return;
    }

    chrome.tabs.sendMessage(tabId, message, (response: ContentResponse | undefined) => {
      if (chrome.runtime.lastError || !response) {
        resolve({ ok: false, error: chrome.runtime.lastError?.message ?? 'No content response' });
        return;
      }

      resolve(response);
    });
  });
}

async function refreshState(): Promise<void> {
  const response = await sendToContent({ type: 'CONTENT_GET_STATE' });
  if (!response.ok) {
    statusEl.textContent = 'This tab is not ready for Axure scaling.';
    setControlsDisabled(true);
    return;
  }

  isAxurePage = response.data.isAxure;
  updateZoomDisplay(response.data.zoom);

  if (!isAxurePage) {
    statusEl.textContent = 'No Axure container detected on this page.';
    setControlsDisabled(true);
    return;
  }

  statusEl.textContent = `Saved per page: ${response.data.urlKey}`;
  setControlsDisabled(false);
}

async function applyZoomFromInput(rawZoom: number): Promise<void> {
  if (!isAxurePage) {
    return;
  }

  const response = await sendToContent({ type: 'CONTENT_SET_ZOOM', zoom: rawZoom });
  if (!response.ok) {
    statusEl.textContent = `Failed: ${response.error}`;
    return;
  }

  updateZoomDisplay(response.data.zoom);
  statusEl.textContent = `Saved per page: ${response.data.urlKey}`;
}

function bindEvents(): void {
  rangeEl.min = String(MIN_ZOOM);
  rangeEl.max = String(MAX_ZOOM);
  rangeEl.step = String(ZOOM_STEP);

  rangeEl.addEventListener('input', () => {
    const zoom = toZoomLevel(Number(rangeEl.value));
    updateZoomDisplay(zoom);
  });

  rangeEl.addEventListener('change', () => {
    void applyZoomFromInput(Number(rangeEl.value));
  });

  zoomOutEl.addEventListener('click', () => {
    const next = adjustZoom(currentZoom, -ZOOM_STEP);
    void applyZoomFromInput(next);
  });

  zoomInEl.addEventListener('click', () => {
    const next = adjustZoom(currentZoom, ZOOM_STEP);
    void applyZoomFromInput(next);
  });

  resetEl.addEventListener('click', () => {
    void sendToContent({ type: 'CONTENT_RESET_ZOOM' }).then((response) => {
      if (!response.ok) {
        statusEl.textContent = `Failed: ${response.error}`;
        return;
      }

      updateZoomDisplay(response.data.zoom);
      statusEl.textContent = `Saved per page: ${response.data.urlKey}`;
    });
  });
}

async function bootstrap(): Promise<void> {
  setControlsDisabled(true);
  bindEvents();
  tabId = await queryActiveTabId();

  if (tabId === null) {
    statusEl.textContent = 'No active tab.';
    return;
  }

  await refreshState();
}

void bootstrap();
