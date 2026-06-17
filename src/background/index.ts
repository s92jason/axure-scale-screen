import {
  addBookmark,
  addFolder,
  getAllBookmarks,
  getBookmark,
  getFolders,
  getIgnored,
  getSettings,
  ignoreBookmark,
  isIgnored,
  recordVisit,
  removeBookmark,
  removeFolder,
  renameBookmark,
  renameFolder,
  setFolder,
  setSettings,
  unignoreProject
} from '../shared/bookmarkStore';
import { toProjectKey } from '../shared/projectKey';
import { getZoomState, resetZoomState, setZoomState } from '../shared/storage';
import { planSync } from '../shared/syncPlan';
import { isRuntimeMessage } from '../shared/types';

// ── Chrome 真實書籤同步(單向 push：plugin → Chrome 書籤) ──────────
// Safari 沒有 chrome.bookmarks，全程 feature-detect；失敗不影響其他功能。
const SYNC_FOLDER_TITLE = 'Axure 書籤';
let syncing = false;

function bmGetChildren(id: string): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
  return new Promise((resolve) => {
    chrome.bookmarks.getChildren(id, (nodes) => {
      void chrome.runtime.lastError;
      resolve(nodes ?? []);
    });
  });
}

function bmCreate(arg: chrome.bookmarks.CreateDetails): Promise<chrome.bookmarks.BookmarkTreeNode | null> {
  return new Promise((resolve) => {
    chrome.bookmarks.create(arg, (node) => {
      void chrome.runtime.lastError;
      resolve(node ?? null);
    });
  });
}

function bmRemoveTree(id: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.bookmarks.removeTree(id, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

// 回傳實際寫入的書籤筆數；錯誤往外丟(由呼叫端決定要回報還是忽略)。
async function syncToChrome(): Promise<number> {
  if (typeof chrome.bookmarks === 'undefined') {
    throw new Error('此瀏覽器不支援書籤同步');
  }
  if (syncing) {
    return 0;
  }
  const settings = await getSettings();
  const parentId = settings.chromeSync.parentFolderId;
  if (!settings.chromeSync.enabled || !parentId) {
    return 0;
  }

  syncing = true;
  try {
    // 在目標資料夾下維護一個專屬「Axure 書籤」資料夾，每次重建它的內容(單向覆寫)。
    const siblings = await bmGetChildren(parentId);
    let folder = siblings.find((node) => !node.url && node.title === SYNC_FOLDER_TITLE) ?? null;
    if (folder) {
      const children = await bmGetChildren(folder.id);
      for (const child of children) {
        await bmRemoveTree(child.id);
      }
    } else {
      folder = await bmCreate({ parentId, title: SYNC_FOLDER_TITLE });
    }
    if (!folder) {
      throw new Error('無法建立同步資料夾');
    }

    const plan = planSync(await getAllBookmarks());
    let count = 0;
    for (const bm of plan.ungrouped) {
      await bmCreate({ parentId: folder.id, title: bm.name || bm.projectKey, url: bm.url });
      count += 1;
    }
    for (const group of plan.groups) {
      const sub = await bmCreate({ parentId: folder.id, title: group.name });
      if (!sub) {
        continue;
      }
      for (const bm of group.items) {
        await bmCreate({ parentId: sub.id, title: bm.name || bm.projectKey, url: bm.url });
        count += 1;
      }
    }
    return count;
  } finally {
    syncing = false;
  }
}

// 自動同步(資料異動後)：失敗就靜默忽略，不打擾使用者。
function maybeSync(): void {
  void syncToChrome().catch(() => {
    /* 自動同步失敗忽略 */
  });
}

const COMMAND_TO_MESSAGE = {
  'zoom-in': { type: 'CONTENT_SHORTCUT_IN' },
  'zoom-out': { type: 'CONTENT_SHORTCUT_OUT' },
  'zoom-reset': { type: 'CONTENT_SHORTCUT_RESET' }
} as const;

type CommandName = keyof typeof COMMAND_TO_MESSAGE;

function queryActiveTabId(): Promise<number | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0]?.id ?? null);
    });
  });
}

function discoverFrameIds(tabId: number): Promise<number[]> {
  return new Promise((resolve) => {
    if (!chrome.scripting?.executeScript) {
      resolve([0]);
      return;
    }

    chrome.scripting.executeScript(
      {
        target: { tabId, allFrames: true },
        func: () => window.location.href
      },
      (results) => {
        if (chrome.runtime.lastError || !results) {
          resolve([0]);
          return;
        }

        const frameIds = [
          ...new Set(results.map((item) => item.frameId).filter((id): id is number => typeof id === 'number'))
        ].sort((a, b) => a - b);

        resolve(frameIds.length > 0 ? frameIds : [0]);
      }
    );
  });
}

function sendMessageToFrame(tabId: number, frameId: number, message: { type: string }): Promise<void> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, { frameId }, () => {
      resolve();
    });
  });
}

async function dispatchShortcutCommand(command: string): Promise<void> {
  if (!(command in COMMAND_TO_MESSAGE)) {
    return;
  }

  const typedCommand = command as CommandName;
  const tabId = await queryActiveTabId();
  if (tabId === null) {
    return;
  }

  const frameIds = await discoverFrameIds(tabId);
  await Promise.all(frameIds.map((frameId) => sendMessageToFrame(tabId, frameId, COMMAND_TO_MESSAGE[typedCommand])));
}

// 同一分頁同專案在短時間內的重複偵測去重(多 frame 會各觸發一次)。
const recentPrompts = new Map<string, number>();
const PROMPT_DEDUP_MS = 5000;

// 讀取 Axure 專案名稱：$axure.document.configuration.projectName 在頁面 main world，
// content script(isolated world)讀不到，改由 background 用 world:'MAIN' 注入讀取。
// Safari 16.4+ 支援 world:'MAIN'，但回傳值與 Chrome 不同(直接給值，非 InjectionResult)，兩種都處理。
async function readProjectName(tabId: number): Promise<string | null> {
  if (!chrome.scripting?.executeScript) {
    return null;
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: () => {
        try {
          const runtime = window as unknown as {
            $axure?: { document?: { configuration?: { projectName?: unknown } } };
          };
          const projectName = runtime.$axure?.document?.configuration?.projectName;
          return typeof projectName === 'string' ? projectName : null;
        } catch {
          return null;
        }
      }
    });

    for (const item of results as unknown[]) {
      const value =
        typeof item === 'object' && item !== null && 'result' in item
          ? (item as { result: unknown }).result
          : item;
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
  } catch {
    // world:'MAIN' 不被支援或注入失敗時，回退到下方命名邏輯。
  }

  return null;
}

// 偵測到 Axure 頁時，以 sender.tab 的「頂層分頁 URL」算 projectKey，
// 去重/ignore 後，把提示卡片轉發給頂層 frame(frameId 0)顯示。
async function handleDetected(sender: chrome.runtime.MessageSender): Promise<void> {
  const tab = sender.tab;
  const tabUrl = tab?.url;
  const tabId = tab?.id;
  if (!tabUrl || typeof tabId !== 'number') {
    return;
  }

  const projectKey = toProjectKey(tabUrl);
  if (!projectKey) {
    return;
  }

  const [existing, ignored] = await Promise.all([getBookmark(projectKey), isIgnored(projectKey)]);
  if (existing || ignored) {
    return;
  }

  // 去重：同一分頁同專案在短時間內可能由多個 frame 各觸發一次偵測，只彈一次卡片。
  const guardKey = `${tabId}:${projectKey}`;
  const now = Date.now();
  const last = recentPrompts.get(guardKey);
  if (last !== undefined && now - last < PROMPT_DEDUP_MS) {
    return;
  }
  recentPrompts.set(guardKey, now);

  // badge 模式：不彈卡片，只在工具列圖示顯示「＋」提示有可收藏的專案。
  const settings = await getSettings();
  if (settings.promptMode === 'badge') {
    chrome.action.setBadgeText({ tabId, text: '＋' });
    void chrome.action.setBadgeBackgroundColor?.({ tabId, color: '#0a84ff' });
    return;
  }

  // 命名優先序：Axure 專案名 → 分頁標題(排除 Untitled) → host。
  let name = (await readProjectName(tabId)) ?? '';
  if (!name) {
    const title = tab?.title?.trim() ?? '';
    if (title && !/^untitled\b/i.test(title)) {
      name = title;
    }
  }
  if (!name) {
    try {
      name = new URL(tabUrl).hostname;
    } catch {
      name = projectKey;
    }
  }

  chrome.tabs.sendMessage(
    tabId,
    { type: 'CONTENT_SHOW_PROMPT', projectKey, name, url: tabUrl },
    { frameId: 0 },
    () => {
      void chrome.runtime.lastError; // 頂層 frame 沒有 content script 時忽略
    }
  );
}

// badge 模式：頁面開始導航時清掉舊的「＋」，新頁若仍可收藏會由偵測重新設定。
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    chrome.action.setBadgeText({ tabId, text: '' });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isRuntimeMessage(message)) {
    return;
  }

  void (async () => {
    try {
      switch (message.type) {
        case 'GET_ZOOM': {
          sendResponse({ ok: true, state: await getZoomState(message.urlKey) });
          return;
        }
        case 'SET_ZOOM': {
          sendResponse({ ok: true, state: await setZoomState(message.urlKey, message.zoom) });
          return;
        }
        case 'RESET_ZOOM': {
          sendResponse({ ok: true, state: await resetZoomState(message.urlKey) });
          return;
        }
        case 'BOOKMARK_GET_ALL': {
          sendResponse({ ok: true, bookmarks: await getAllBookmarks() });
          return;
        }
        case 'BOOKMARK_ADD': {
          const bookmark = await addBookmark({
            projectKey: message.projectKey,
            name: message.name,
            url: message.url,
            folder: message.folder
          });
          sendResponse({ ok: true, bookmark });
          maybeSync();
          return;
        }
        case 'BOOKMARK_REMOVE': {
          await removeBookmark(message.projectKey);
          sendResponse({ ok: true });
          maybeSync();
          return;
        }
        case 'BOOKMARK_RECORD_VISIT': {
          await recordVisit(message.projectKey);
          sendResponse({ ok: true });
          return;
        }
        case 'BOOKMARK_DETECTED': {
          await handleDetected(sender);
          sendResponse({ ok: true });
          return;
        }
        case 'BOOKMARK_IGNORE': {
          await ignoreBookmark(message.projectKey);
          sendResponse({ ok: true });
          maybeSync();
          return;
        }
        case 'BOOKMARK_RENAME': {
          await renameBookmark(message.projectKey, message.name);
          sendResponse({ ok: true });
          maybeSync();
          return;
        }
        case 'BOOKMARK_SET_FOLDER': {
          await setFolder(message.projectKey, message.folder);
          sendResponse({ ok: true });
          maybeSync();
          return;
        }
        case 'BOOKMARK_GET_IGNORED': {
          sendResponse({ ok: true, ignored: await getIgnored() });
          return;
        }
        case 'BOOKMARK_UNIGNORE': {
          await unignoreProject(message.projectKey);
          sendResponse({ ok: true });
          return;
        }
        case 'BOOKMARK_GET_FOLDERS': {
          sendResponse({ ok: true, folders: await getFolders() });
          return;
        }
        case 'BOOKMARK_ADD_FOLDER': {
          sendResponse({ ok: true, folders: await addFolder(message.name) });
          return;
        }
        case 'BOOKMARK_RENAME_FOLDER': {
          await renameFolder(message.name, message.newName);
          sendResponse({ ok: true, folders: await getFolders() });
          maybeSync();
          return;
        }
        case 'BOOKMARK_REMOVE_FOLDER': {
          await removeFolder(message.name);
          sendResponse({ ok: true, folders: await getFolders() });
          maybeSync();
          return;
        }
        case 'SETTINGS_GET': {
          sendResponse({ ok: true, settings: await getSettings() });
          return;
        }
        case 'SETTINGS_SET': {
          await setSettings(message.settings);
          sendResponse({ ok: true });
          maybeSync();
          return;
        }
        case 'SYNC_NOW': {
          sendResponse({ ok: true, syncedCount: await syncToChrome() });
          return;
        }
        default: {
          sendResponse({ ok: false, error: 'Unknown runtime message' });
        }
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Unexpected background error';
      sendResponse({ ok: false, error: messageText });
    }
  })();

  return true;
});

chrome.commands.onCommand.addListener((command) => {
  void dispatchShortcutCommand(command);
});
