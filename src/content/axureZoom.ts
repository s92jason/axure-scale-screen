import { DEFAULT_ZOOM, ZOOM_STEP } from '../shared/constants';
import type { ContentMessage, ContentResponse, RuntimeMessage, RuntimeResponse, ZoomLevel } from '../shared/types';
import { toUrlKey } from '../shared/url';
import { adjustZoom, toZoomLevel } from '../shared/zoom';
import { applyZoom, findAxureRoot, getShortcutDelta, isEditableTarget, isLikelyAxureDocument, resetZoom } from './engine';
import { showPromptCard } from './promptCard';

interface ContentState {
  isAxure: boolean;
  root: HTMLElement | null;
  urlKey: string;
  zoom: ZoomLevel;
}

type ShortcutMessageType = 'CONTENT_SHORTCUT_IN' | 'CONTENT_SHORTCUT_OUT' | 'CONTENT_SHORTCUT_RESET';

const state: ContentState = {
  isAxure: false,
  root: null,
  urlKey: toUrlKey(window.location.href),
  zoom: DEFAULT_ZOOM as ZoomLevel
};

function sendRuntimeMessage(message: RuntimeMessage): Promise<RuntimeResponse> {
  return new Promise((resolve) => {
    // 外掛重新載入/更新後，舊頁面殘留的 content script 會進入
    // 「Extension context invalidated」狀態(chrome.runtime.id 變 undefined)，
    // 此時呼叫 sendMessage 會同步丟例外。直接優雅失敗，避免 Uncaught (in promise)。
    if (!chrome.runtime?.id) {
      resolve({ ok: false, error: 'Extension context invalidated' });
      return;
    }

    try {
      chrome.runtime.sendMessage(message, (response: RuntimeResponse | undefined) => {
        if (chrome.runtime.lastError || !response) {
          resolve({ ok: false, error: chrome.runtime.lastError?.message ?? 'No runtime response' });
          return;
        }

        resolve(response);
      });
    } catch (error) {
      resolve({ ok: false, error: error instanceof Error ? error.message : 'sendMessage failed' });
    }
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

// 觸控板/手勢縮放專用：立即更新畫面，持久化做 debounce，
// 避免 pinch 這類高頻事件造成大量 storage 寫入。
let persistTimer: number | undefined;
function scheduleZoomPersist(): void {
  if (persistTimer !== undefined) {
    window.clearTimeout(persistTimer);
  }
  persistTimer = window.setTimeout(() => {
    void persistZoom(state.zoom);
  }, 200);
}

function applyZoomVisual(nextZoom: number): void {
  if (!state.root) {
    return;
  }
  state.zoom = applyZoom(state.root, nextZoom);
  scheduleZoomPersist();
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
  window.addEventListener(
    'keydown',
    (event) => {
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
    },
    { capture: true }
  );
}

// 觸控板雙指縮放（pinch）：
// - Chrome / Windows：呈現為 ctrlKey=true 的 wheel 事件（也涵蓋 Ctrl+滾輪縮放）。
// - Safari：WebKit 專屬的 gesturestart/gesturechange/gestureend，event.scale 為相對起點的累積倍率。
// 兩條路徑都 preventDefault 掉瀏覽器原生頁面縮放，改套用外掛縮放；僅在 Axure 文件上生效。
function handlePinchZoom(): void {
  let gestureActive = false;
  let gestureBaseZoom: ZoomLevel = DEFAULT_ZOOM as ZoomLevel;
  let wheelAccum = 0;
  const WHEEL_STEP_THRESHOLD = 40; // 每累積這麼多 px 的 ctrl+wheel delta，動一個 ZOOM_STEP

  window.addEventListener(
    'wheel',
    (event) => {
      // Safari 走 gesture 事件；手勢進行中就不重複處理 wheel。
      if (!state.isAxure || !event.ctrlKey || gestureActive) {
        return;
      }
      event.preventDefault();
      wheelAccum += event.deltaY;
      while (Math.abs(wheelAccum) >= WHEEL_STEP_THRESHOLD) {
        const delta = wheelAccum > 0 ? -ZOOM_STEP : ZOOM_STEP; // deltaY > 0（pinch in）= 縮小
        wheelAccum += wheelAccum > 0 ? -WHEEL_STEP_THRESHOLD : WHEEL_STEP_THRESHOLD;
        applyZoomVisual(adjustZoom(state.zoom, delta));
      }
    },
    { capture: true, passive: false }
  );

  // gesturestart/change/end 不在標準 WindowEventMap，用字串型別的 addEventListener overload 註冊。
  const addGesture = (type: string, handler: (event: Event) => void): void => {
    window.addEventListener(type, handler as EventListener, { passive: false });
  };

  addGesture('gesturestart', (event) => {
    if (!state.isAxure) {
      return;
    }
    event.preventDefault();
    gestureActive = true;
    gestureBaseZoom = state.zoom;
  });

  addGesture('gesturechange', (event) => {
    if (!state.isAxure) {
      return;
    }
    event.preventDefault();
    const scale = (event as unknown as { scale?: number }).scale;
    if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) {
      return;
    }
    applyZoomVisual(gestureBaseZoom * scale);
  });

  addGesture('gestureend', (event) => {
    if (!state.isAxure) {
      return;
    }
    event.preventDefault();
    gestureActive = false;
    if (persistTimer !== undefined) {
      window.clearTimeout(persistTimer);
    }
    void persistZoom(state.zoom);
  });
}

async function applyShortcutAction(type: ShortcutMessageType): Promise<ZoomLevel> {
  if (!state.isAxure || !state.root) {
    return state.zoom;
  }

  if (type === 'CONTENT_SHORTCUT_RESET') {
    return resetToDefault();
  }

  if (type === 'CONTENT_SHORTCUT_IN') {
    const next = adjustZoom(state.zoom, ZOOM_STEP);
    return setZoom(next);
  }

  const next = adjustZoom(state.zoom, -ZOOM_STEP);
  return setZoom(next);
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

    if (
      typedMessage.type === 'CONTENT_SHORTCUT_IN' ||
      typedMessage.type === 'CONTENT_SHORTCUT_OUT' ||
      typedMessage.type === 'CONTENT_SHORTCUT_RESET'
    ) {
      void applyShortcutAction(typedMessage.type)
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
          respond({ ok: false, error: error instanceof Error ? error.message : 'Failed to apply shortcut' });
        });
      return true;
    }

    if (typedMessage.type === 'CONTENT_SHOW_PROMPT') {
      // 僅頂層 frame 顯示卡片(background 已只送 frameId 0，這裡再保險一次)。
      if (window.top === window.self) {
        const { projectKey, name, url } = typedMessage;
        showPromptCard({
          name,
          onAdd: (editedName) => {
            void sendRuntimeMessage({ type: 'BOOKMARK_ADD', projectKey, name: editedName, url });
          },
          onSkip: () => {
            /* 本次略過：僅關閉卡片 */
          },
          onIgnore: () => {
            void sendRuntimeMessage({ type: 'BOOKMARK_IGNORE', projectKey });
          }
        });
      }
      respond({ ok: true, data: { isAxure: state.isAxure, urlKey: state.urlKey, zoom: state.zoom } });
      return;
    }

    respond({ ok: false, error: 'Unknown content message' });
    return;
  });
}

async function bootstrap(): Promise<void> {
  handlePopupMessages();
  handleShortcuts();
  handlePinchZoom();

  const foundRoot = findAxureRoot();
  const isAxure = isLikelyAxureDocument(foundRoot);

  // 只有「確認是 Axure 文件」時才保留 root 並套用縮放。
  // 否則 root 維持 null —— 避免在任何含通用 selector(#base / #main_container 等)的
  // 非 Axure 頁面上 reparent DOM：ensureScaleWrapper 會插入 position:relative 的
  // 包裹層，改變 containing block 而破壞無關網站的版面。content script 跑在
  // all_frames + <all_urls>，故此 gate 是必要的防線(原本誤用 if (state.root))。
  state.isAxure = isAxure;
  state.root = isAxure ? foundRoot : null;

  if (state.isAxure) {
    await initializeFromStorage();
    applyCurrentZoom();
  }

  // F1：偵測到 Axure 即通知 background，由它去重後決定是否在頂層 frame 顯示提示卡片。
  if (state.isAxure) {
    void sendRuntimeMessage({ type: 'BOOKMARK_DETECTED' });
  }

  window.addEventListener('resize', () => {
    if (!state.root || !state.isAxure) {
      return;
    }

    state.zoom = applyZoom(state.root, state.zoom);
  });
}

void bootstrap();
