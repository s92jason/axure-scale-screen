import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, ZOOM_STEP } from '../shared/constants';
import { toProjectKey } from '../shared/projectKey';
import type {
  AxureBookmark,
  ContentMessage,
  ContentResponse,
  RuntimeMessage,
  RuntimeResponse,
  ZoomLevel
} from '../shared/types';
import { toEntryUrl } from '../shared/url';
import { adjustZoom, toZoomLevel } from '../shared/zoom';

function must<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) {
    throw new Error(`找不到 Popup 必要的 UI 元件：${selector}`);
  }
  return el;
}

const status = must<HTMLParagraphElement>('#status');
const statusTxt = must<HTMLSpanElement>('#status .status-txt');
const range = must<HTMLInputElement>('#zoomRange');
const value = must<HTMLOutputElement>('#zoomValue');
const zoomIn = must<HTMLButtonElement>('#zoomIn');
const zoomOut = must<HTMLButtonElement>('#zoomOut');
const reset = must<HTMLButtonElement>('#reset');

const zoomLive = must<HTMLDivElement>('#zoomLive');
const stateCard = must<HTMLDivElement>('#stateCard');
const stateIcon = must<HTMLDivElement>('#stateIcon');
const stateTitle = must<HTMLHeadingElement>('#stateTitle');
const stateBody = must<HTMLParagraphElement>('#stateBody');
const statePrimary = must<HTMLButtonElement>('#statePrimary');

const bmAdd = must<HTMLButtonElement>('#bmAdd');
const bmSearch = must<HTMLInputElement>('#bmSearch');
const bmList = must<HTMLUListElement>('#bmList');
const bmEmpty = must<HTMLParagraphElement>('#bmEmpty');

must<HTMLButtonElement>('#bmManage').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

const STATE_ICONS = {
  refresh:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v5h-5"/></svg>',
  lock:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>',
  doc:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M12 4l2.1 4.6 5 .5-3.8 3.4 1.1 4.9L12 15.8 7.6 17.9l1.1-4.9L4.9 9.6l5-.5z"/></svg>'
} as const;

type StatusTone = '' | 'is-amber' | 'is-grey' | 'is-loading';

interface StateCardConfig {
  iconTone: '' | 'amber' | 'accent';
  icon: keyof typeof STATE_ICONS;
  title: string;
  body: string;
  statusTone: StatusTone;
  statusText: string;
  primary?: { label: string; onClick: () => void };
}

let tabId: number | null = null;
let activeFrameId: number | null = null;
let isAxurePage = false;
let currentZoom = DEFAULT_ZOOM as ZoomLevel;

let currentTabUrl: string | null = null;
let currentTabTitle = '';
let currentProjectKey: string | null = null;
let bookmarks: AxureBookmark[] = [];

function setStatus(tone: StatusTone, text: string): void {
  status.className = tone ? `status ${tone}` : 'status';
  statusTxt.textContent = text;
}

function setControlsDisabled(disabled: boolean): void {
  range.disabled = disabled;
  zoomIn.disabled = disabled;
  zoomOut.disabled = disabled;
  reset.disabled = disabled;
}

function showLive(): void {
  stateCard.hidden = true;
  zoomLive.hidden = false;
  setControlsDisabled(false);
  updateAddAvailability();
}

function showStateCard(config: StateCardConfig): void {
  zoomLive.hidden = true;
  stateCard.hidden = false;
  setControlsDisabled(true);
  bmAdd.disabled = true;

  stateIcon.className = config.iconTone ? `state-ico ${config.iconTone}` : 'state-ico';
  stateIcon.innerHTML = STATE_ICONS[config.icon];
  stateTitle.textContent = config.title;
  stateBody.textContent = config.body;
  setStatus(config.statusTone, config.statusText);

  if (config.primary) {
    statePrimary.hidden = false;
    statePrimary.textContent = config.primary.label;
    statePrimary.onclick = config.primary.onClick;
  } else {
    statePrimary.hidden = true;
    statePrimary.onclick = null;
  }
}

function reloadAndRecheck(): void {
  if (tabId === null) {
    return;
  }
  chrome.tabs.reload(tabId);
  setStatus('is-loading', '重新整理中…');
  window.setTimeout(() => {
    void refreshState();
  }, 900);
}

function updateZoomDisplay(zoom: ZoomLevel): void {
  currentZoom = zoom;
  range.value = String(zoom);
  value.value = String(zoom);
  const pct = ((zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100;
  range.style.setProperty('--zoom-pct', `${pct}%`);
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

    if (result.hasAnyContentResponse) {
      showStateCard({
        iconTone: '',
        icon: 'doc',
        title: '這不是 Axure 原型',
        body: '縮放功能只在偵測到 Axure 文件容器時生效。你仍然可以從下方書籤直接開啟已收藏的原型。',
        statusTone: 'is-grey',
        statusText: '非 Axure 頁面'
      });
      return;
    }

    if (isPermissionError(result.error)) {
      showStateCard({
        iconTone: 'amber',
        icon: 'lock',
        title: '需要存取權限',
        body: '目前沒有這個網站的存取權限。請到 Safari 外掛設定允許此網域（本機 file:// 檔案需另外允許），再重新整理頁面。',
        statusTone: 'is-amber',
        statusText: '需要網站權限',
        primary: { label: '重新整理頁面', onClick: reloadAndRecheck }
      });
      return;
    }

    showStateCard({
      iconTone: 'amber',
      icon: 'refresh',
      title: '尚未準備好',
      body: '這個分頁的內容腳本還沒回應。請重新整理頁面，安裝或更新外掛後第一次開啟通常需要 reload。',
      statusTone: 'is-amber',
      statusText: '需要重新整理',
      primary: { label: '重新整理頁面', onClick: reloadAndRecheck }
    });
    return;
  }

  activeFrameId = result.frameId;
  isAxurePage = result.response.data.isAxure;
  updateZoomDisplay(result.response.data.zoom);
  showLive();
  setStatus('', `已記住此頁 ${result.response.data.zoom}%`);
}

async function applyZoomFromInput(rawZoom: number): Promise<void> {
  if (!isAxurePage || activeFrameId === null) {
    return;
  }

  const response = await sendToContent({ type: 'CONTENT_SET_ZOOM', zoom: rawZoom }, activeFrameId);
  if (!response.ok) {
    setStatus('is-amber', '套用縮放失敗');
    return;
  }

  updateZoomDisplay(response.data.zoom);
  setStatus('', `已記住此頁 ${response.data.zoom}%`);
}

function queryActiveTab(): Promise<chrome.tabs.Tab | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0] ?? null);
    });
  });
}

function sendToBackground(message: RuntimeMessage): Promise<RuntimeResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: RuntimeResponse | undefined) => {
      if (chrome.runtime.lastError || !response) {
        resolve({ ok: false, error: chrome.runtime.lastError?.message ?? '背景沒有回應' });
        return;
      }

      resolve(response);
    });
  });
}

function isCurrentBookmarked(): boolean {
  return currentProjectKey !== null && bookmarks.some((bm) => bm.projectKey === currentProjectKey);
}

function updateAddAvailability(): void {
  const saved = isCurrentBookmarked();
  const canAdd = currentProjectKey !== null && isAxurePage && !saved;
  bmAdd.disabled = !canAdd;
  bmAdd.classList.toggle('is-saved', saved);
  if (saved) {
    bmAdd.textContent = '✓ 已收藏';
    bmAdd.title = '此 Axure 專案已在書籤中';
  } else {
    bmAdd.textContent = '＋ 收藏此頁';
    bmAdd.title = canAdd ? '收藏目前的 Axure 專案' : '目前分頁不是可收藏的 Axure 連結';
  }
}

function renderBookmarks(): void {
  const keyword = bmSearch.value.trim().toLowerCase();
  const filtered = keyword
    ? bookmarks.filter(
        (bm) => bm.name.toLowerCase().includes(keyword) || bm.folder.toLowerCase().includes(keyword)
      )
    : bookmarks;

  bmSearch.hidden = bookmarks.length <= 4;
  bmEmpty.hidden = bookmarks.length > 0;
  bmList.replaceChildren();

  for (const bm of filtered) {
    const row = document.createElement('li');
    row.className = 'bm-row';

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'bm-open';
    open.title = bm.url;

    const fav = document.createElement('span');
    fav.className = 'bm-fav';
    fav.innerHTML = STATE_ICONS.star;
    open.appendChild(fav);

    const name = document.createElement('span');
    name.className = 'bm-name';
    name.textContent = bm.name || bm.projectKey;
    open.appendChild(name);

    if (bm.folder) {
      const pill = document.createElement('span');
      pill.className = 'bm-folder';
      pill.textContent = bm.folder;
      open.appendChild(pill);
    }

    open.addEventListener('click', () => {
      void openBookmark(bm);
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'bm-del';
    del.title = '刪除書籤';
    del.textContent = '×';
    del.addEventListener('click', () => {
      void removeBookmarkRow(bm.projectKey);
    });

    row.append(open, del);
    bmList.appendChild(row);
  }
}

async function loadBookmarks(): Promise<void> {
  const response = await sendToBackground({ type: 'BOOKMARK_GET_ALL' });
  bookmarks = response.ok && response.bookmarks ? response.bookmarks : [];
  renderBookmarks();
  updateAddAvailability();
}

async function openBookmark(bm: AxureBookmark): Promise<void> {
  chrome.tabs.create({ url: toEntryUrl(bm.url) });
  await sendToBackground({ type: 'BOOKMARK_RECORD_VISIT', projectKey: bm.projectKey });
  window.close();
}

async function removeBookmarkRow(projectKey: string): Promise<void> {
  await sendToBackground({ type: 'BOOKMARK_REMOVE', projectKey });
  await loadBookmarks();
}

async function addCurrentTab(): Promise<void> {
  if (!currentTabUrl || !currentProjectKey || isCurrentBookmarked()) {
    return;
  }

  const name = currentTabTitle.trim() || currentProjectKey;
  const response = await sendToBackground({
    type: 'BOOKMARK_ADD',
    projectKey: currentProjectKey,
    name,
    url: toEntryUrl(currentTabUrl)
  });

  if (response.ok) {
    if (tabId !== null) {
      chrome.action.setBadgeText({ tabId, text: '' }); // badge 模式收藏後清除「＋」
    }
    await loadBookmarks();
  }
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
        setStatus('is-amber', '重置失敗');
        return;
      }

      updateZoomDisplay(response.data.zoom);
      setStatus('', `已記住此頁 ${response.data.zoom}%`);
    });
  });

  bmAdd.addEventListener('click', () => {
    void addCurrentTab();
  });

  bmSearch.addEventListener('input', () => {
    renderBookmarks();
  });
}

async function bootstrap(): Promise<void> {
  setControlsDisabled(true);
  bindEvents();

  const tab = await queryActiveTab();
  tabId = tab?.id ?? null;
  currentTabUrl = tab?.url ?? null;
  currentTabTitle = tab?.title ?? '';
  currentProjectKey = currentTabUrl ? toProjectKey(currentTabUrl) : null;

  void loadBookmarks();

  if (tabId === null) {
    showStateCard({
      iconTone: '',
      icon: 'doc',
      title: '找不到分頁',
      body: '找不到目前啟用的分頁。請切換到要縮放的 Axure 頁面後再開啟。',
      statusTone: 'is-grey',
      statusText: '無作用中分頁'
    });
    return;
  }

  setStatus('is-loading', '正在讀取目前分頁…');
  await refreshState();
}

void bootstrap();
