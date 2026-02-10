import { DEFAULT_ZOOM } from '../shared/constants';
import type { ContentMessage, ContentResponse, RuntimeMessage, RuntimeResponse, ZoomLevel } from '../shared/types';
import { toUrlKey } from '../shared/url';
import { adjustZoom, toZoomLevel } from '../shared/zoom';
import { applyZoom, findAxureRoot, getShortcutDelta, isEditableTarget, resetZoom } from './engine';

interface ContentState {
  isAxure: boolean;
  root: HTMLElement | null;
  urlKey: string;
  zoom: ZoomLevel;
}

const state: ContentState = {
  isAxure: false,
  root: null,
  urlKey: toUrlKey(window.location.href),
  zoom: DEFAULT_ZOOM as ZoomLevel
};

function sendRuntimeMessage(message: RuntimeMessage): Promise<RuntimeResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: RuntimeResponse | undefined) => {
      if (chrome.runtime.lastError || !response) {
        resolve({ ok: false, error: chrome.runtime.lastError?.message ?? 'No runtime response' });
        return;
      }

      resolve(response);
    });
  });
}

async function persistZoom(zoom: ZoomLevel): Promise<void> {
  await sendRuntimeMessage({ type: 'SET_ZOOM', urlKey: state.urlKey, zoom });
}

async function initializeFromStorage(): Promise<void> {
  const response = await sendRuntimeMessage({ type: 'GET_ZOOM', urlKey: state.urlKey });
  if (response.ok && response.state) {
    state.zoom = toZoomLevel(response.state.zoom);
  }
}

function applyCurrentZoom(): void {
  if (!state.root) {
    return;
  }

  state.zoom = applyZoom(state.root, state.zoom);
}

async function setZoom(nextZoom: number): Promise<ZoomLevel> {
  if (!state.root) {
    return state.zoom;
  }

  state.zoom = applyZoom(state.root, nextZoom);
  await persistZoom(state.zoom);
  return state.zoom;
}

async function resetToDefault(): Promise<ZoomLevel> {
  if (!state.root) {
    return state.zoom;
  }

  state.zoom = resetZoom(state.root);
  await sendRuntimeMessage({ type: 'RESET_ZOOM', urlKey: state.urlKey });
  return state.zoom;
}

function handleShortcuts(): void {
  document.addEventListener('keydown', (event) => {
    if (!state.isAxure || isEditableTarget(event.target)) {
      return;
    }

    const deltaOrReset = getShortcutDelta(event);
    if (deltaOrReset === null) {
      return;
    }

    event.preventDefault();

    if (deltaOrReset === 0) {
      void resetToDefault();
      return;
    }

    const next = adjustZoom(state.zoom, deltaOrReset);
    void setZoom(next);
  });
}

function handlePopupMessages(): void {
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (typeof message !== 'object' || message === null || !('type' in message)) {
      return;
    }

    const typedMessage = message as ContentMessage;
    if (!typedMessage.type.startsWith('CONTENT_')) {
      return;
    }

    const respond = (response: ContentResponse): void => {
      sendResponse(response);
    };

    if (typedMessage.type === 'CONTENT_GET_STATE') {
      respond({
        ok: true,
        data: {
          isAxure: state.isAxure,
          urlKey: state.urlKey,
          zoom: state.zoom
        }
      });
      return;
    }

    if (typedMessage.type === 'CONTENT_SET_ZOOM') {
      void setZoom(typedMessage.zoom)
        .then((zoom) => {
          respond({
            ok: true,
            data: {
              isAxure: state.isAxure,
              urlKey: state.urlKey,
              zoom
            }
          });
        })
        .catch((error) => {
          respond({ ok: false, error: error instanceof Error ? error.message : 'Failed to set zoom' });
        });
      return true;
    }

    if (typedMessage.type === 'CONTENT_RESET_ZOOM') {
      void resetToDefault()
        .then((zoom) => {
          respond({
            ok: true,
            data: {
              isAxure: state.isAxure,
              urlKey: state.urlKey,
              zoom
            }
          });
        })
        .catch((error) => {
          respond({ ok: false, error: error instanceof Error ? error.message : 'Failed to reset zoom' });
        });
      return true;
    }

    respond({ ok: false, error: 'Unknown content message' });
    return;
  });
}

async function bootstrap(): Promise<void> {
  handlePopupMessages();
  handleShortcuts();

  state.root = findAxureRoot();
  state.isAxure = Boolean(state.root);

  if (state.root) {
    await initializeFromStorage();
    applyCurrentZoom();
  }

  window.addEventListener('resize', () => {
    if (!state.root || !state.isAxure) {
      return;
    }

    state.zoom = applyZoom(state.root, state.zoom);
  });
}

void bootstrap();
