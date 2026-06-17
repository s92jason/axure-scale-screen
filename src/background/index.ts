import {
  addBookmark,
  addFolder,
  getAllBookmarks,
  getBookmark,
  getFolders,
  getIgnored,
  ignoreBookmark,
  isIgnored,
  recordVisit,
  removeBookmark,
  removeFolder,
  renameBookmark,
  renameFolder,
  setFolder,
  unignoreProject
} from '../shared/bookmarkStore';
import { toProjectKey } from '../shared/projectKey';
import { getZoomState, resetZoomState, setZoomState } from '../shared/storage';
import { isRuntimeMessage } from '../shared/types';

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
          return;
        }
        case 'BOOKMARK_REMOVE': {
          await removeBookmark(message.projectKey);
          sendResponse({ ok: true });
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
          return;
        }
        case 'BOOKMARK_RENAME': {
          await renameBookmark(message.projectKey, message.name);
          sendResponse({ ok: true });
          return;
        }
        case 'BOOKMARK_SET_FOLDER': {
          await setFolder(message.projectKey, message.folder);
          sendResponse({ ok: true });
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
          return;
        }
        case 'BOOKMARK_REMOVE_FOLDER': {
          await removeFolder(message.name);
          sendResponse({ ok: true, folders: await getFolders() });
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
